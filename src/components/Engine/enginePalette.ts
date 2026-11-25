/**
 * The Engine (BL61) — the machine's own paint: the ONE file of the Engine that writes a colour.
 *
 * The owner's prototypes (`personal-bloc-engine-prototype-v2.html`, built on `family-fire-engine-v3.html`) draw the engine
 * in two kinds of colour. Theme colours — green, amber, red, the bitcoin orange, the two text tones, the accent, the venue
 * marks — the canvas reads from the app's tokens (`EngineCanvas`'s `readTones`), as the prototypes read theirs. Everything
 * else is the machine's own: steel, glass, the dark plates and wells, the sparks, two grey tones of its labels. Those
 * are written here once, as the prototypes write them, so the drawing (`engineDraw.ts`) names a material, never a colour.
 *
 * Kept off this list on purpose: any colour the app has a token for (`engineWiring.test.ts` TOKENS pins it). The two
 * grey label tones are the prototypes' own (#8d919b, #7F8794): the app's `--text-faint` (#555555) is too dark for the
 * canvas's 10–11 px labels on its dark background.
 */

/** The prototypes' type: the system's sans — SF Pro on an iPhone. */
export const ENGINE_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

/** White and black at an alpha: light on glass and steel, shadows under them. */
export const wh = (a: number): string => `rgba(255,255,255,${a})`;
export const bk = (a: number): string => `rgba(0,0,0,${a})`;

/** A colour at an alpha — a token's value or a material: `#rrggbb`, `#rgb` or `rgb(…)` in, `rgba(…)` out. */
export function al(c: string, a: number): string {
  const s = c.trim();
  let r = 128; let g = 128; let b = 128;
  if (s.startsWith('#')) {
    const h = s.length === 4 ? s.slice(1).split('').map((x) => x + x).join('') : s.slice(1, 7);
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = s.match(/\d+(\.\d+)?/g);
    if (m !== null && m.length >= 3) { r = Number(m[0]); g = Number(m[1]); b = Number(m[2]); }
  }
  return `rgba(${r},${g},${b},${a})`;
}

/** The materials, by part. */
export const MAT = {
  // label tones the app has no token for (see above)
  muted: '#8d919b',
  faint: '#7F8794',
  // the liquidation price's figure, and its shift upward (a move made it worse)
  liqPink: '#ff8f8a',
  liqRose: '#F26B3A',
  // the glass tubes
  tubeDark: 'rgba(6,8,11,0.62)',
  // the piston: a steel disc seen a little from above, its top, its rod and the rod's cap
  piston: ['#4b535f', '#f3f5f9', '#aab2be', '#6d7582', '#3f4651'],
  pistonTop: ['#aeb6c2', '#ffffff', '#8f97a4'],
  rod: ['#606874', '#f6f8fb', '#565d69'],
  rodCap: '#c6ccd6',
  // the beam that ties the pistons, its bosses, and the bed plate
  beam: ['#f1f4f8', '#a7afbb', '#565d69'],
  boss: ['#ffffff', '#8a929e'],
  bed: ['#465060', '#232a35'],
  // brushed steel (the crank rods)
  metal: ['#eef1f6', '#a9b0bc', '#666d79'],
  pin: ['#ffffff', '#9aa2ae'],
  // the flywheel: its edge seen in depth, its teeth, its rim, spokes, web and hub
  wheelEdge: '#0f1318',
  wheelDepth: ['#0d1116', '#141920'],
  wheelTeeth: ['#aab3c0', '#5b6472', '#2a313b'],
  wheelRim: ['#7d8795', '#333a45', '#161b22'],
  spoke: ['#59616e', '#a3acb9'],
  web: '#4a525f',
  hub: ['#f4f6f9', '#9aa3b0', '#414956'],
  hubBolt: 'rgba(20,24,30,0.75)',
  hubCap: '#e9edf2',
  bead: '#ffffff',
  // the price motor: cooling fins, housing, the well its rotor turns in, the rotor's blades and hub
  fin: ['#5d6775', '#2a313b'],
  housing: ['#6a7482', '#2b323c', '#12161c'],
  well: ['#1c212a', '#06080b'],
  blade: [[238, 241, 246], [104, 113, 127]] as const,
  bladeBlur: [214, 221, 232] as const,
  motorHub: ['#ffffff', '#f0a04a', '#7d8693'],
  // the worm gear: its drive shaft, gearbox, bearings, screw and thread
  shaft: ['#dfe4ea', '#8f98a5', '#4a525e'],
  gearbox: ['#59626f', '#1b2028'],
  bearing: '#20262f',
  screw: ['#3b434f', '#e4e8ee', '#8d96a3', '#2a313b'],
  thread: 'rgba(8,10,14,0.62)',
  // the gauge: bezel, face, the little disc its liquidation mark sits on, and the hub
  bezel: ['#6a7482', '#262c35', '#0f1318'],
  dial: ['#1d222b', '#0b0e12'],
  markDisc: '#0e1116',
  gaugeHub: ['#ffffff', '#8a929e'],
  gaugeMark: '#ffffff',
  // pipes and their flanges
  pipe: ['#262d37', '#3c4553'],
  flange: ['#6a7689', '#3d4755', '#1c222b'],
  // what a tick or a move throws: sparks up, down and all through; the glow under the piston; an ember's core
  sparkUp: '#bff5d6',
  sparkDown: '#ffb38a',
  sparkKick: '#ffe2b0',
  flash: [255, 236, 200] as const,
  emberCore: 'rgba(255,240,210,0.9)',
  // the backing under the names, and the tape's hover box
  labelBack: 'rgba(17,19,23,0.88)',
  hoverBox: 'rgba(26,29,35,0.96)',
} as const;

/** One of the material triples at an alpha. */
export const tri = (c: readonly [number, number, number], a: number): string => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
