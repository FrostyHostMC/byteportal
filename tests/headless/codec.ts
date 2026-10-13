import { decode, encode } from '../../src/platform/net/codec';
import { check } from './_harness';

/** What crosses a socket comes out as it went in: typed arrays, odd numbers, gaps in lists. */
export default function codec() {
  const msg = { args: ['hit', undefined, null, 3], n: [Infinity, -Infinity, NaN], px: new Uint8Array([1, 2, 255]), cells: new Int16Array([-1, 7]), gone: undefined };
  const back = decode<typeof msg>(encode(msg));
  check(back.args.length === 4 && back.args[1] === undefined && back.args[2] === null && back.args[3] === 3, `lists keep undefined apart from null: ${JSON.stringify(back.args)}`);
  check(back.n[0] === Infinity && back.n[1] === -Infinity && Number.isNaN(back.n[2]), 'infinities and NaN');
  check(back.px instanceof Uint8Array && back.px.join() === '1,2,255' && back.cells instanceof Int16Array && back.cells.join() === '-1,7', 'typed arrays');
  check(!('gone' in back), 'undefined properties stay absent');
}
