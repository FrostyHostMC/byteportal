import type { HudOptions } from '@platform';
import hudCss from './hud.css?raw';

/**
 * The Arena's colours: bronze and gold on dark stone, marble-white type, blood for harm. Every
 * piece of the HUD takes them from here (the theme's stylesheet as CSS variables, the widgets'
 * and the screens' own code by name).
 */
export const PALETTE = {
  gold: '#f0c060',
  goldHi: '#ffe3a1',
  bronze: '#c0773a',
  bronzeDk: '#6b3f1d',
  blood: '#d8343c',
  bloodDk: '#7c1218',
  marble: '#f5efe4',
  stone: '#15110e',
  good: '#9fd870',
  /** The crowd's favour: a hotter gold. */
  favour: '#ffcf3f',
} as const;

/** Faces: Roman capitals for titles, a condensed sans for labels and numbers, a plain one to read. */
export const FONTS = {
  title: "'Cinzel', 'Trajan Pro', Georgia, serif",
  label: "'Oswald', 'Arial Narrow', 'Helvetica Neue', sans-serif",
  text: "'Barlow', 'Helvetica Neue', system-ui, sans-serif",
} as const;

/**
 * How the HUD looks on every screen (`shared.ts`'s `hud`): health as a bar with bars over the
 * monsters' heads, and the theme (`hud.css`), which restyles the platform's own pieces: the
 * health bar, the hotbar, the boss bar, banners, the feed, menus (the shop, the blessings), toasts,
 * prompts, damage numbers. The Arena's own pieces are its client code's (`client/hud/`).
 */
export const HUD: HudOptions = {
  health: 'bar',
  healthBars: true,
  nameTags: 'sight',
  theme: {
    display: FONTS.title,
    text: FONTS.text,
    fonts: ['Cinzel:500;600;700;800;900', 'Oswald:400;500;600;700', 'Barlow:400;500;600;700'],
    colors: { accent: PALETTE.gold, ink: PALETTE.stone, paper: PALETTE.stone, text: PALETTE.marble, danger: PALETTE.blood, good: PALETTE.good },
    css: hudCss,
  },
};
