/**
 * The gunner HUD's look (`hud.gunner()`): the gun's crosshair, the scope, the rounds and the
 * optics' reticle. It was the platform's own stylesheet's until the kit took these pieces over:
 * the classes are the same, so games' HUD themes restyle them as before.
 */
export const GUNNER_CSS = `
/* ---------- Guns: crosshair, scope, ammo ---------- */
.gun-cross {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  --gap: 8px;
  transition: opacity 120ms ease;
  filter: drop-shadow(0 0 1px rgba(0, 0, 0, 0.9)) drop-shadow(0 1px 0 rgba(0, 0, 0, 0.6));
}
.gun-cross span {
  position: absolute;
  background: #fff;
  transition: transform 60ms linear;
}
.gun-cross .gc-t,
.gun-cross .gc-b {
  width: 2px;
  height: 9px;
  left: -1px;
}
.gun-cross .gc-l,
.gun-cross .gc-r {
  width: 9px;
  height: 2px;
  top: -1px;
}
.gun-cross .gc-t {
  top: -9px;
  transform: translateY(calc(var(--gap) * -1));
}
.gun-cross .gc-b {
  top: 0;
  transform: translateY(var(--gap));
}
.gun-cross .gc-l {
  left: -9px;
  transform: translateX(calc(var(--gap) * -1));
}
.gun-cross .gc-r {
  left: 0;
  transform: translateX(var(--gap));
}
.gun-cross .gc-dot {
  width: 2px;
  height: 2px;
  left: -1px;
  top: -1px;
  opacity: 0.85;
}
.gun-cross.aiming {
  opacity: 0;
}

.scope {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(circle at center, transparent 0, transparent min(38vh, 38vw), rgba(0, 0, 0, 0.9) calc(min(38vh, 38vw) + 2px), #000 calc(min(38vh, 38vw) + 40px));
}
.scope-lens {
  position: absolute;
  left: 50%;
  top: 50%;
  width: min(76vh, 76vw);
  height: min(76vh, 76vw);
  transform: translate(-50%, -50%);
  border-radius: 50%;
  box-shadow: inset 0 0 60px 20px rgba(0, 0, 0, 0.55);
  background:
    linear-gradient(#000, #000) center / 2px 100% no-repeat,
    linear-gradient(#000, #000) center / 100% 2px no-repeat,
    linear-gradient(#000, #000) center 30% / 6px 26% no-repeat,
    radial-gradient(circle at center, rgba(255, 40, 40, 0.95) 0 2px, transparent 3px);
}

.ammo {
  position: absolute;
  right: 22px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);
  color: #fff;
}
.ammo-name {
  font: 700 12px var(--pixel);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  opacity: 0.85;
}
.ammo-count {
  display: flex;
  align-items: baseline;
  gap: 6px;
  font-variant-numeric: tabular-nums;
}
.ammo-mag {
  font: 700 44px/1 var(--pixel);
}
.ammo-sep {
  font: 700 20px var(--pixel);
  opacity: 0.6;
}
.ammo-reserve {
  font: 700 20px var(--pixel);
  opacity: 0.8;
}
.ammo-pips {
  display: flex;
  flex-wrap: wrap-reverse;
  justify-content: flex-end;
  gap: 2px;
  max-width: 180px;
}
.ammo-pip {
  width: 4px;
  height: 11px;
  border-radius: 1px;
  background: #ffd36b;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.6);
}
.ammo-pip.spent {
  background: rgba(255, 255, 255, 0.18);
}
.ammo-reload {
  font: 700 12px var(--pixel);
  letter-spacing: 0.1em;
  color: #9fd8ff;
}
.ammo-reload.low {
  color: #ffcf4d;
  animation: meter-low 0.6s steps(2) infinite;
}
.ammo-reload.out {
  color: #ff6b5e;
}
.ammo.low .ammo-mag {
  color: #ff6b5e;
}
.ammo.fired .ammo-mag {
  animation: ammo-bump 90ms ease-out;
}
@keyframes ammo-bump {
  from {
    transform: translateY(-3px) scale(1.06);
  }
}

.hud-themed .ammo-pip {
  background: var(--hud-accent, #ffd36b);
}

/* A red dot / holo sight's reticle (a gun's aim.sight 'dot' or 'holo'), at the aim point */
.gun-reticle {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  --rc: #ff2a2a;
  pointer-events: none;
  mix-blend-mode: screen;
}
.gun-reticle-dot {
  position: absolute;
  left: -2.5px;
  top: -2.5px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: radial-gradient(circle, #fff 0 18%, var(--rc) 45%);
  box-shadow: 0 0 4px 1px var(--rc), 0 0 10px 2px color-mix(in srgb, var(--rc) 55%, transparent);
}
.gun-reticle.holo .gun-reticle-dot {
  left: -2px;
  top: -2px;
  width: 4px;
  height: 4px;
}
.gun-reticle-ring {
  display: none;
  position: absolute;
  left: -30px;
  top: -30px;
  width: 60px;
  height: 60px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid var(--rc);
  box-shadow: 0 0 6px color-mix(in srgb, var(--rc) 80%, transparent), inset 0 0 6px color-mix(in srgb, var(--rc) 70%, transparent);
  opacity: 0.9;
  /* The EOTech's ticks at the four points of the ring. */
  background:
    linear-gradient(var(--rc), var(--rc)) top center / 2px 7px no-repeat,
    linear-gradient(var(--rc), var(--rc)) bottom center / 2px 7px no-repeat,
    linear-gradient(var(--rc), var(--rc)) left center / 7px 2px no-repeat,
    linear-gradient(var(--rc), var(--rc)) right center / 7px 2px no-repeat;
}
.gun-reticle.holo .gun-reticle-ring {
  display: block;
}
`;
