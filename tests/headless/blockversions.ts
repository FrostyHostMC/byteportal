import { gameBlocks } from '../../src/platform/world/blocks';
import { check, launch } from './_harness';

/**
 * A page older (or newer) than its server: the server's block ids come first, and the page's own
 * blocks the server hasn't got fill what room is left, never past it. A game that changed its
 * blocks between two deploys (a page left open across them) still starts, the server's blocks at
 * the server's ids.
 */
export default function blockVersions() {
  // (A game started once: the engine's loaded.)
  launch('heart-hunt');
  const cube = { texture: { color: '#888888' } };
  const blocks = (prefix: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${prefix}${i}`, cube]));
  const server = gameBlocks({ id: 'versions', blocks: blocks('new_block_', 66) });
  // The page's copy: 60 blocks of its own the server no longer has (66 + 60 would be far past the room).
  const page = gameBlocks({ id: 'versions', blocks: blocks('old_block_', 60) }, server.keys);
  check(page.keys.length <= 68, `the page's blocks must fit (${page.keys.length})`);
  server.keys.forEach((k, i) => check(page.keys[i] === k, `the server's block ${k} at its id (page has ${page.keys[i]})`));
  // Same game both sides: nothing missing, nothing extra.
  const same = gameBlocks({ id: 'versions', blocks: blocks('new_block_', 66) }, server.keys);
  check(same.keys.join() === server.keys.join(), 'the same game on both sides agrees');
}
