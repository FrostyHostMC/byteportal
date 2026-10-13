/** The throwables HUD's look (`hud.throwables()`): what's carried, bottom right. Same classes as ever (themes restyle them). */
export const THROWABLES_CSS = `
/* Throwables carried (grenades), bottom right over the rounds and the radar: a picture, how many, the key. */
.throwables {
  position: absolute;
  right: 22px;
  bottom: 176px;
  display: flex;
  gap: 8px;
  color: #fff;
  text-shadow: 0 2px 4px rgba(0, 0, 0, 0.7);
}
.throwable {
  display: flex;
  align-items: center;
  gap: 3px;
}
.throwable-icon {
  width: 34px;
  height: 34px;
  object-fit: contain;
  filter: drop-shadow(0 2px 2px rgba(0, 0, 0, 0.5));
}
.throwable-count {
  font: 700 18px var(--pixel);
}
.throwable-key {
  font: 700 10px var(--pixel);
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.18);
  align-self: flex-end;
}
.throwable.out {
  opacity: 0.35;
}
.throwable.cooking .throwable-icon {
  animation: throwable-cook 0.25s steps(2) infinite;
}
.throwable.spent .throwable-count {
  animation: ammo-bump 160ms ease-out;
}
@keyframes throwable-cook {
  50% {
    transform: scale(1.15) rotate(8deg);
  }
}
@keyframes ammo-bump {
  from {
    transform: translateY(-3px) scale(1.06);
  }
}
`;
