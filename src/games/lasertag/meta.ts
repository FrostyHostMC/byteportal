import { defineMeta } from '@platform';

/**
 * Laser Tag: the item-kit litmus (docs/REDESIGN-ITEMS.md, 4e). Its tagger is a kind of item of
 * its own, written in this folder alone on the public API (`tagger.*.ts`, `client/tagger.ts`):
 * fired on each player's screen at once, taken or turned down by the host.
 */
export default defineMeta({
  id: 'lasertag',
  title: 'Laser Tag',
  tagline: 'Tag them before they tag you',
  accent: '#39f3ff',
  controls: [
    ['LMB', 'tag'],
    ['1 2', 'taggers'],
  ],
});
