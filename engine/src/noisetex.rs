//! Tileable noise texture (RGBA8) used by the sky (clouds) and water shaders.
//!
//! R: 5-octave gradient fbm, G: fbm at double frequency, B: inverted Worley (billows),
//! A: independent fbm (water ripples). All channels tile seamlessly.

use crate::noise::hash2;

fn grad(seed: u32, ix: i32, iy: i32, period: i32) -> (f32, f32) {
    let h = hash2(seed, ix.rem_euclid(period), iy.rem_euclid(period));
    let a = (h >> 8) as f32 * (std::f32::consts::TAU / 16_777_216.0);
    (a.cos(), a.sin())
}

fn perlin(seed: u32, x: f32, y: f32, period: i32) -> f32 {
    let ix = x.floor() as i32;
    let iy = y.floor() as i32;
    let fx = x - ix as f32;
    let fy = y - iy as f32;
    let fade = |t: f32| t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
    let dotg = |gx: i32, gy: i32| {
        let (a, b) = grad(seed, ix + gx, iy + gy, period);
        a * (fx - gx as f32) + b * (fy - gy as f32)
    };
    let u = fade(fx);
    let v = fade(fy);
    let n0 = dotg(0, 0) + (dotg(1, 0) - dotg(0, 0)) * u;
    let n1 = dotg(0, 1) + (dotg(1, 1) - dotg(0, 1)) * u;
    (n0 + (n1 - n0) * v) * 1.414
}

fn fbm(seed: u32, x: f32, y: f32, base_period: i32, octaves: u32) -> f32 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut period = base_period;
    let mut norm = 0.0;
    for o in 0..octaves {
        let s = x * period as f32;
        let t = y * period as f32;
        sum += perlin(seed.wrapping_add(o * 7919), s, t, period) * amp;
        norm += amp;
        amp *= 0.5;
        period *= 2;
    }
    sum / norm
}

fn worley(seed: u32, x: f32, y: f32, period: i32) -> f32 {
    let px = x * period as f32;
    let py = y * period as f32;
    let ix = px.floor() as i32;
    let iy = py.floor() as i32;
    let mut best = 9.0f32;
    for dy in -1..=1 {
        for dx in -1..=1 {
            let cx = ix + dx;
            let cy = iy + dy;
            let h = hash2(seed, cx.rem_euclid(period), cy.rem_euclid(period));
            let ox = (h & 0xffff) as f32 / 65535.0;
            let oy = (h >> 16) as f32 / 65535.0;
            let ddx = cx as f32 + ox - px;
            let ddy = cy as f32 + oy - py;
            best = best.min(ddx * ddx + ddy * ddy);
        }
    }
    best.sqrt()
}

pub fn generate(size: usize) -> Vec<u8> {
    let mut out = vec![0u8; size * size * 4];
    let to8 = |v: f32| ((v * 0.5 + 0.5).clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    for y in 0..size {
        for x in 0..size {
            let u = x as f32 / size as f32;
            let v = y as f32 / size as f32;
            let r = fbm(11, u, v, 4, 5);
            let g = fbm(23, u, v, 8, 4);
            let w = 1.0 - worley(37, u, v, 8) * 1.2 + (1.0 - worley(41, u, v, 16)) * 0.35;
            let a = fbm(53, u, v, 8, 4);
            let o = (y * size + x) * 4;
            out[o] = to8(r * 1.3);
            out[o + 1] = to8(g * 1.3);
            out[o + 2] = (w.clamp(0.0, 1.0) * 255.0) as u8;
            out[o + 3] = to8(a * 1.3);
        }
    }
    out
}
