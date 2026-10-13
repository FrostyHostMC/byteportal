import { defineMeta } from '@platform';
import cover from './cover.webp?url';

/**
 * Blockyard Links: eighteen holes of golf on a parkland course, with a cart to get round it. Swing
 * with the mouse (or a three-click meter), pick the strike point for spin and shape, read the
 * greens' slopes.
 */
export default defineMeta({
  id: 'golf',
  title: 'Stonebyte Links',
  tagline: 'Eighteen holes, a cart and your swing. Read the greens.',
  accent: '#7ccf4f',
  cover,
  instances: true,
  controls: [
    ['E', 'get in or out of the cart; step up to your ball'],
    ['C', 'call your cart to you'],
    ['Hold click, pull back, swing up', 'swing (Space: the click meter)'],
    ['Mouse or A / D', 'aim (hold Shift to aim finely)'],
    ['1-9 or wheel', 'choose a club'],
    ['Arrow keys', 'strike point: backspin, topspin, draw, fade'],
    ['W / S, A / D', 'drive the cart (Space brakes)'],
    ['F', 'caddie: take me to my ball'],
    ['Tab', 'scores'],
  ],
  // Touch: hold swing and drag (pull back, swing up), as the mouse does; the cart and the caddie at hand.
  touch: { RT: ['LMB', 'swing'], X: ['KeyE', 'cart · ball'], RB: ['KeyF', 'caddie'], LB: ['KeyC', 'call cart'], B: null, Up: null, Down: null, Back: ['Tab', 'scores'] },
  achievements: {
    par: { title: 'Par for the Course', description: 'Make a par' },
    birdie: { title: 'Birdie', description: 'Make a birdie' },
    eagle: { title: 'Eagle Eye', description: 'Make an eagle' },
    ace: { title: 'Hole in One', description: 'Hole your tee shot' },
    chip_in: { title: 'Chip In', description: 'Hole out from off the green' },
    long_putt: { title: 'Drain It', description: 'Hole a putt of 30 feet or more' },
    sandy: { title: 'From the Sand', description: 'Hole out from a bunker', hidden: true },
    big_drive: { title: 'Grip It and Rip It', description: 'Drive the ball 300 yards' },
    front_nine: { title: 'The Turn', description: 'Finish the front nine' },
    round: { title: 'Eighteen', description: 'Finish all eighteen holes' },
    under_par: { title: 'Under Par', description: 'Finish a round under par' },
    splash: { title: 'Splash', description: 'Find the water', hidden: true },
  },
});
