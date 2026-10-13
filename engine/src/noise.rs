//! Seeded simplex noise (2D / 3D), fractal helpers, integer hashing and a small PRNG.

#[inline(always)]
pub fn hash32(mut x: u32) -> u32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    x
}

#[inline(always)]
pub fn hash2(seed: u32, x: i32, z: i32) -> u32 {
    hash32(seed ^ hash32((x as u32).wrapping_mul(0x9e37_79b1) ^ hash32(z as u32).wrapping_add(0x632b_e5ab)))
}

#[inline(always)]
pub fn hash3(seed: u32, x: i32, y: i32, z: i32) -> u32 {
    hash32(hash2(seed, x, z) ^ (y as u32).wrapping_mul(0x85eb_ca77))
}

/// Uniform float in [0, 1) from a hash.
#[inline(always)]
pub fn unit(h: u32) -> f32 {
    (h >> 8) as f32 * (1.0 / 16_777_216.0)
}

/// PCG32 random number generator.
#[derive(Clone)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        let mut r = Rng { state: 0 };
        r.next();
        r.state = r.state.wrapping_add(seed ^ 0x853c_49e6_748f_ea9b);
        r.next();
        r
    }

    #[inline]
    pub fn next(&mut self) -> u32 {
        let old = self.state;
        self.state = old.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        let xorshifted = (((old >> 18) ^ old) >> 27) as u32;
        let rot = (old >> 59) as u32;
        xorshifted.rotate_right(rot)
    }

    /// Uniform in [0, 1).
    #[inline]
    pub fn f(&mut self) -> f32 {
        unit(self.next())
    }

    /// Uniform integer in [lo, hi] (inclusive).
    #[inline]
    pub fn range(&mut self, lo: i32, hi: i32) -> i32 {
        if hi <= lo {
            return lo;
        }
        lo + (self.next() % ((hi - lo + 1) as u32)) as i32
    }

    #[inline]
    pub fn chance(&mut self, p: f32) -> bool {
        self.f() < p
    }
}

const GRAD3: [[f32; 3]; 12] = [
    [1.0, 1.0, 0.0],
    [-1.0, 1.0, 0.0],
    [1.0, -1.0, 0.0],
    [-1.0, -1.0, 0.0],
    [1.0, 0.0, 1.0],
    [-1.0, 0.0, 1.0],
    [1.0, 0.0, -1.0],
    [-1.0, 0.0, -1.0],
    [0.0, 1.0, 1.0],
    [0.0, -1.0, 1.0],
    [0.0, 1.0, -1.0],
    [0.0, -1.0, -1.0],
];

const GRAD2: [[f32; 2]; 8] = [
    [1.0, 0.0],
    [-1.0, 0.0],
    [0.0, 1.0],
    [0.0, -1.0],
    [0.70710678, 0.70710678],
    [-0.70710678, 0.70710678],
    [0.70710678, -0.70710678],
    [-0.70710678, -0.70710678],
];

/// Simplex noise with its own permutation table.
#[derive(Clone)]
pub struct Noise {
    perm: [u8; 512],
    pmod12: [u8; 512],
}

#[inline(always)]
fn fastfloor(x: f32) -> i32 {
    let i = x as i32;
    if (i as f32) > x {
        i - 1
    } else {
        i
    }
}

impl Noise {
    pub fn new(seed: u32) -> Self {
        let mut p = [0u8; 256];
        for (i, v) in p.iter_mut().enumerate() {
            *v = i as u8;
        }
        let mut rng = Rng::new(seed as u64 ^ 0xa076_1d64_78bd_642f);
        for i in (1..256).rev() {
            let j = (rng.next() % (i as u32 + 1)) as usize;
            p.swap(i, j);
        }
        let mut perm = [0u8; 512];
        let mut pmod12 = [0u8; 512];
        for i in 0..512 {
            perm[i] = p[i & 255];
            pmod12[i] = perm[i] % 12;
        }
        Noise { perm, pmod12 }
    }

    /// 2D simplex noise, roughly in [-1, 1].
    pub fn n2(&self, xin: f32, yin: f32) -> f32 {
        const F2: f32 = 0.366_025_42;
        const G2: f32 = 0.211_324_87;
        let s = (xin + yin) * F2;
        let i = fastfloor(xin + s);
        let j = fastfloor(yin + s);
        let t = (i + j) as f32 * G2;
        let x0 = xin - (i as f32 - t);
        let y0 = yin - (j as f32 - t);
        let (i1, j1) = if x0 > y0 { (1, 0) } else { (0, 1) };
        let x1 = x0 - i1 as f32 + G2;
        let y1 = y0 - j1 as f32 + G2;
        let x2 = x0 - 1.0 + 2.0 * G2;
        let y2 = y0 - 1.0 + 2.0 * G2;
        let ii = (i & 255) as usize;
        let jj = (j & 255) as usize;
        let p = &self.perm;
        let g0 = (p[ii + p[jj] as usize] & 7) as usize;
        let g1 = (p[ii + i1 + p[jj + j1] as usize] & 7) as usize;
        let g2 = (p[ii + 1 + p[jj + 1] as usize] & 7) as usize;
        let mut n = 0.0;
        let t0 = 0.5 - x0 * x0 - y0 * y0;
        if t0 > 0.0 {
            let t2 = t0 * t0;
            n += t2 * t2 * (GRAD2[g0][0] * x0 + GRAD2[g0][1] * y0);
        }
        let t1 = 0.5 - x1 * x1 - y1 * y1;
        if t1 > 0.0 {
            let t2 = t1 * t1;
            n += t2 * t2 * (GRAD2[g1][0] * x1 + GRAD2[g1][1] * y1);
        }
        let t2v = 0.5 - x2 * x2 - y2 * y2;
        if t2v > 0.0 {
            let t2 = t2v * t2v;
            n += t2 * t2 * (GRAD2[g2][0] * x2 + GRAD2[g2][1] * y2);
        }
        99.2 * n
    }

    /// 3D simplex noise, roughly in [-1, 1].
    pub fn n3(&self, xin: f32, yin: f32, zin: f32) -> f32 {
        const F3: f32 = 1.0 / 3.0;
        const G3: f32 = 1.0 / 6.0;
        let s = (xin + yin + zin) * F3;
        let i = fastfloor(xin + s);
        let j = fastfloor(yin + s);
        let k = fastfloor(zin + s);
        let t = (i + j + k) as f32 * G3;
        let x0 = xin - (i as f32 - t);
        let y0 = yin - (j as f32 - t);
        let z0 = zin - (k as f32 - t);
        let (i1, j1, k1, i2, j2, k2) = if x0 >= y0 {
            if y0 >= z0 {
                (1, 0, 0, 1, 1, 0)
            } else if x0 >= z0 {
                (1, 0, 0, 1, 0, 1)
            } else {
                (0, 0, 1, 1, 0, 1)
            }
        } else if y0 < z0 {
            (0, 0, 1, 0, 1, 1)
        } else if x0 < z0 {
            (0, 1, 0, 0, 1, 1)
        } else {
            (0, 1, 0, 1, 1, 0)
        };
        let x1 = x0 - i1 as f32 + G3;
        let y1 = y0 - j1 as f32 + G3;
        let z1 = z0 - k1 as f32 + G3;
        let x2 = x0 - i2 as f32 + 2.0 * G3;
        let y2 = y0 - j2 as f32 + 2.0 * G3;
        let z2 = z0 - k2 as f32 + 2.0 * G3;
        let x3 = x0 - 1.0 + 3.0 * G3;
        let y3 = y0 - 1.0 + 3.0 * G3;
        let z3 = z0 - 1.0 + 3.0 * G3;
        let ii = (i & 255) as usize;
        let jj = (j & 255) as usize;
        let kk = (k & 255) as usize;
        let p = &self.perm;
        let m = &self.pmod12;
        let gi0 = m[ii + p[jj + p[kk] as usize] as usize] as usize;
        let gi1 = m[ii + i1 + p[jj + j1 + p[kk + k1] as usize] as usize] as usize;
        let gi2 = m[ii + i2 + p[jj + j2 + p[kk + k2] as usize] as usize] as usize;
        let gi3 = m[ii + 1 + p[jj + 1 + p[kk + 1] as usize] as usize] as usize;
        let mut n = 0.0;
        let t0 = 0.6 - x0 * x0 - y0 * y0 - z0 * z0;
        if t0 > 0.0 {
            let t2 = t0 * t0;
            let g = GRAD3[gi0];
            n += t2 * t2 * (g[0] * x0 + g[1] * y0 + g[2] * z0);
        }
        let t1 = 0.6 - x1 * x1 - y1 * y1 - z1 * z1;
        if t1 > 0.0 {
            let t2 = t1 * t1;
            let g = GRAD3[gi1];
            n += t2 * t2 * (g[0] * x1 + g[1] * y1 + g[2] * z1);
        }
        let t2v = 0.6 - x2 * x2 - y2 * y2 - z2 * z2;
        if t2v > 0.0 {
            let t2 = t2v * t2v;
            let g = GRAD3[gi2];
            n += t2 * t2 * (g[0] * x2 + g[1] * y2 + g[2] * z2);
        }
        let t3 = 0.6 - x3 * x3 - y3 * y3 - z3 * z3;
        if t3 > 0.0 {
            let t2 = t3 * t3;
            let g = GRAD3[gi3];
            n += t2 * t2 * (g[0] * x3 + g[1] * y3 + g[2] * z3);
        }
        32.0 * n
    }

    /// Fractal 2D noise normalised to roughly [-1, 1].
    pub fn fbm2(&self, x: f32, y: f32, octaves: u32) -> f32 {
        let mut sum = 0.0;
        let mut amp = 1.0;
        let mut freq = 1.0;
        let mut norm = 0.0;
        for o in 0..octaves {
            // Offset octaves so they don't share the origin artefact.
            let off = o as f32 * 17.13;
            sum += amp * self.n2(x * freq + off, y * freq - off);
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        sum / norm
    }

    /// Fractal 3D noise normalised to roughly [-1, 1].
    pub fn fbm3(&self, x: f32, y: f32, z: f32, octaves: u32) -> f32 {
        let mut sum = 0.0;
        let mut amp = 1.0;
        let mut freq = 1.0;
        let mut norm = 0.0;
        for o in 0..octaves {
            let off = o as f32 * 23.71;
            sum += amp * self.n3(x * freq + off, y * freq, z * freq - off);
            norm += amp;
            amp *= 0.5;
            freq *= 2.0;
        }
        sum / norm
    }
}

#[inline(always)]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

#[inline(always)]
pub fn clamp01(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

/// Hermite smoothstep; works with `e0 > e1` for a falling edge.
#[inline(always)]
pub fn smoothstep(e0: f32, e1: f32, x: f32) -> f32 {
    let t = clamp01((x - e0) / (e1 - e0));
    t * t * (3.0 - 2.0 * t)
}

/// Piecewise-linear spline through sorted (x, y) control points.
pub fn spline(points: &[(f32, f32)], x: f32) -> f32 {
    if x <= points[0].0 {
        return points[0].1;
    }
    for w in points.windows(2) {
        let (x0, y0) = w[0];
        let (x1, y1) = w[1];
        if x <= x1 {
            let t = (x - x0) / (x1 - x0);
            // Smooth the joints a little.
            let t = t * t * (3.0 - 2.0 * t) * 0.5 + t * 0.5;
            return lerp(y0, y1, t);
        }
    }
    points[points.len() - 1].1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn noise_range() {
        let n = Noise::new(1234);
        let (mut lo2, mut hi2, mut lo3, mut hi3) = (0f32, 0f32, 0f32, 0f32);
        for i in 0..20000 {
            let x = i as f32 * 0.137;
            let y = i as f32 * 0.071 + 3.3;
            let a = n.n2(x, y);
            let b = n.n3(x, y, x * 0.3);
            lo2 = lo2.min(a);
            hi2 = hi2.max(a);
            lo3 = lo3.min(b);
            hi3 = hi3.max(b);
        }
        assert!(lo2 > -1.2 && hi2 < 1.2 && lo2 < -0.6 && hi2 > 0.6, "2d {lo2} {hi2}");
        assert!(lo3 > -1.2 && hi3 < 1.2 && lo3 < -0.6 && hi3 > 0.6, "3d {lo3} {hi3}");
    }
}
