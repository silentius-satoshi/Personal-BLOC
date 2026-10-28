import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  VENUES, DEFAULT_VENUE_COLORS, VENUE_TOKEN, STATUS_COLORS, VENUE_SURFACES, VENUE_SWATCHES,
  READABLE_MIN, VENUE_APART_MIN, STATUS_APART_MIN,
  normalizeHex, cleanVenueColors, incomingVenueColors, resolveVenueColors, venuePaletteOf, hasCustomVenueColors, applyVenueColors,
  contrastRatio, deltaE2000, deltaE2000Lab, venueContrastOf, checkVenueColor, refusalText,
  type Venue,
} from '../venueColors';

/**
 * BL15 (Customization) — the venue colours' rule and palette (batch spec §2.4). The picker refuses a colour that would make
 * a venue unreadable on the app's dark background, or hard to tell from the other venues or from the status colours.
 * Tolerances and thresholds only — never an exact golden on these measures (Math.pow and Math.cbrt; general.md). Every
 * assertion carries its tag (TOKENS, SHARMA, WCAG, DEFAULTS, EXEMPT, SWATCHES, REFUSE, SWEEP, CLEAN, RESOLVE, SINK).
 */

const TOKENS_CSS = readFileSync(join(process.cwd(), 'src', 'styles', 'tokens.css'), 'utf8');
const tokenOf = (name: string): string => {
  const m = TOKENS_CSS.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (m === null) throw new Error(`no ${name} in tokens.css`);
  return m[1].trim().toLowerCase();
};
const others = (v: Venue): Venue[] => VENUES.filter((o) => o !== v);
const grid = (): string[] => {
  const out: string[] = [];
  for (let r = 0; r < 256; r += 17) for (let g = 0; g < 256; g += 17) for (let b = 0; b < 256; b += 17) {
    out.push(`#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`);
  }
  return out;
};

describe('⭐ TOKENS — the palette is tokens.css\'s, one source', () => {
  it('⭐ TOKENS — the defaults are --text-primary, --coinbase and --btc; the venue tokens read them', () => {
    expect(DEFAULT_VENUE_COLORS.strike, 'TOKENS Strike = --text-primary').toBe(tokenOf('--text-primary'));
    expect(DEFAULT_VENUE_COLORS.coinbase, 'TOKENS Coinbase = --coinbase').toBe(tokenOf('--coinbase'));
    expect(DEFAULT_VENUE_COLORS.cold, 'TOKENS cold = --btc').toBe(tokenOf('--btc'));
    expect(tokenOf(VENUE_TOKEN.strike), 'TOKENS --venue-strike').toBe('var(--text-primary)');
    expect(tokenOf(VENUE_TOKEN.coinbase), 'TOKENS --venue-coinbase').toBe('var(--coinbase)');
    expect(tokenOf(VENUE_TOKEN.cold), 'TOKENS --venue-cold').toBe('var(--btc)');
  });
  it('⭐ TOKENS — the status colours and the surfaces are tokens.css\'s', () => {
    expect(STATUS_COLORS.green, 'TOKENS green').toBe(tokenOf('--green'));
    expect(STATUS_COLORS.amber, 'TOKENS amber').toBe(tokenOf('--amber'));
    expect(STATUS_COLORS.red, 'TOKENS red').toBe(tokenOf('--red'));
    expect([...VENUE_SURFACES], 'TOKENS surfaces').toEqual(['--bg-app', '--bg-card', '--surface', '--surface-2'].map(tokenOf));
  });
});

describe('⭐ SHARMA — CIEDE2000 matches the published test pairs (Sharma, Wu & Dalal 2005)', () => {
  const PAIRS: [readonly [number, number, number], readonly [number, number, number], number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.49, -0.001], [50, -2.49, 0.0009], 7.1792],
    [[50, 2.49, -0.001], [50, -2.49, 0.0011], 7.2195],
    [[50, -0.001, 2.49], [50, 0.0009, -2.49], 4.8045],
    [[50, -0.001, 2.49], [50, 0.0011, -2.49], 4.7461],
    [[50, 2.5, 0], [50, 0, -2.5], 4.3065],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[50, 2.5, 0], [61, -5, 29], 22.8977],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082],
  ];
  it('⭐ SHARMA — every pair to 1e-4, both ways (the hue wrap and the zero-chroma branches included)', () => {
    for (const [a, b, want] of PAIRS) {
      expect(Math.abs(deltaE2000Lab(a, b) - want), `SHARMA ${a} vs ${b}`).toBeLessThan(1e-4);
      expect(Math.abs(deltaE2000Lab(b, a) - want), `SHARMA ${b} vs ${a}`).toBeLessThan(1e-4);
    }
  });
  it('⭐ SHARMA — symmetric on colours, and zero on a colour against itself', () => {
    const g = grid();
    for (let i = 0; i < g.length; i += 97) {
      const a = g[i];
      const b = g[(i * 31 + 7) % g.length];
      expect(Math.abs(deltaE2000(a, b) - deltaE2000(b, a)), `SHARMA symmetric ${a} ${b}`).toBeLessThan(1e-9);
      expect(deltaE2000(a, a), `SHARMA self ${a}`).toBeLessThan(1e-9);
    }
  });
});

describe('⭐ WCAG — the contrast ratio', () => {
  it('⭐ WCAG — 21 for white on black, 1 for a colour on itself, ~4.48 for #777 on white; symmetric', () => {
    expect(contrastRatio('#ffffff', '#000000'), 'WCAG 21:1').toBeCloseTo(21, 9);
    expect(contrastRatio('#0052ff', '#0052ff'), 'WCAG 1:1').toBeCloseTo(1, 12);
    expect(contrastRatio('#777777', '#ffffff'), 'WCAG #777 on white').toBeCloseTo(4.48, 2);
    expect(contrastRatio('#111318', '#e8e8e8'), 'WCAG symmetric').toBeCloseTo(contrastRatio('#e8e8e8', '#111318'), 12);
  });
});

describe('⭐ DEFAULTS — the app\'s own palette passes its own rule, every way', () => {
  it('⭐ DEFAULTS — each default passes as its venue\'s colour with the others at theirs', () => {
    for (const v of VENUES) {
      expect(checkVenueColor(v, DEFAULT_VENUE_COLORS[v], DEFAULT_VENUE_COLORS), `DEFAULTS ${v}`).toBeNull();
    }
  });
  it('⭐ DEFAULTS — the figures that set the bars: Coinbase blue is the lowest contrast; Strike and cold the closest venues', () => {
    const blue = venueContrastOf(DEFAULT_VENUE_COLORS.coinbase);
    expect(blue, 'DEFAULTS Coinbase blue ≥ the bar').toBeGreaterThanOrEqual(READABLE_MIN);
    expect(blue, 'DEFAULTS Coinbase blue — the bar sits at the app\'s own blue').toBeLessThan(3.1);
    for (const v of VENUES) expect(venueContrastOf(DEFAULT_VENUE_COLORS[v]), `DEFAULTS ${v} readable`).toBeGreaterThanOrEqual(blue);
    const pairs = [deltaE2000(DEFAULT_VENUE_COLORS.strike, DEFAULT_VENUE_COLORS.coinbase),
      deltaE2000(DEFAULT_VENUE_COLORS.strike, DEFAULT_VENUE_COLORS.cold),
      deltaE2000(DEFAULT_VENUE_COLORS.coinbase, DEFAULT_VENUE_COLORS.cold)];
    expect(Math.min(...pairs), 'DEFAULTS the closest venues, Strike and cold, clear the venue bar').toBeGreaterThan(VENUE_APART_MIN);
  });
});

describe('⭐ EXEMPT — a venue\'s own default skips the status test, and only its own', () => {
  it('⭐ EXEMPT — cold storage\'s orange sits under the status bar from amber: the exemption is what keeps the default', () => {
    const dE = deltaE2000(DEFAULT_VENUE_COLORS.cold, STATUS_COLORS.amber);
    expect(dE, 'EXEMPT orange vs amber is under the bar').toBeLessThan(STATUS_APART_MIN);
    expect(dE, 'EXEMPT orange vs amber — about 4.8').toBeCloseTo(4.8, 1);
    expect(checkVenueColor('cold', DEFAULT_VENUE_COLORS.cold, DEFAULT_VENUE_COLORS), 'EXEMPT cold keeps its orange').toBeNull();
  });
  it('⭐ EXEMPT — the same orange as Strike\'s or Coinbase\'s colour is refused (too close to amber)', () => {
    const p = { ...DEFAULT_VENUE_COLORS, cold: '#2dd4bf' };
    for (const v of ['strike', 'coinbase'] as Venue[]) {
      expect(checkVenueColor(v, DEFAULT_VENUE_COLORS.cold, p), `EXEMPT ${v} may not wear cold's orange`)
        .toEqual({ kind: 'status', status: 'amber', deltaE: expect.any(Number) });
    }
  });
  it('⭐ EXEMPT — the default is exempt from the status test only: cold\'s orange beside a Strike colour too close to it is refused', () => {
    const p = { ...DEFAULT_VENUE_COLORS, strike: '#ffa31a' };   // Strike set near orange while cold wore another colour
    expect(checkVenueColor('cold', DEFAULT_VENUE_COLORS.cold, p), 'EXEMPT the venue test still runs')
      .toEqual({ kind: 'venue', other: 'strike', deltaE: expect.any(Number) });
  });
});

describe('⭐ SWATCHES — the picker\'s own choices', () => {
  it('⭐ SWATCHES — each passes as any venue\'s colour with the others at their defaults', () => {
    for (const c of VENUE_SWATCHES) {
      expect(normalizeHex(c), `SWATCHES ${c} well-formed`).toBe(c);
      for (const v of VENUES) expect(checkVenueColor(v, c, DEFAULT_VENUE_COLORS), `SWATCHES ${c} as ${v}`).toBeNull();
    }
  });
  it('⭐ SWATCHES — any three different choices from the defaults and the swatches pass together (none too close to another)', () => {
    const all = [...Object.values(DEFAULT_VENUE_COLORS), ...VENUE_SWATCHES];
    let combos = 0;
    for (const s of [DEFAULT_VENUE_COLORS.strike, ...VENUE_SWATCHES]) {
      for (const c of [DEFAULT_VENUE_COLORS.coinbase, ...VENUE_SWATCHES]) {
        for (const d of [DEFAULT_VENUE_COLORS.cold, ...VENUE_SWATCHES]) {
          if (s === c || s === d || c === d) continue;
          const p = { strike: s, coinbase: c, cold: d };
          for (const v of VENUES) expect(checkVenueColor(v, p[v], p), `SWATCHES ${s} ${c} ${d} — ${v}`).toBeNull();
          combos++;
        }
      }
    }
    expect(combos, 'SWATCHES the combinations run').toBeGreaterThan(200);
    expect(new Set(all).size, 'SWATCHES nine different colours').toBe(9);
  });
});

describe('⭐ REFUSE — each reason, in order, in words', () => {
  it('⭐ REFUSE — unreadable: a colour under 3:1 on one surface, though over it on the darkest', () => {
    const c = '#646474';
    expect(contrastRatio(c, '#09090e'), 'REFUSE premise: over the bar on --bg-app, the darkest').toBeGreaterThan(READABLE_MIN);
    expect(venueContrastOf(c), 'REFUSE premise: under the bar on a lighter surface').toBeLessThan(READABLE_MIN);
    expect(venueContrastOf(c), 'REFUSE premise: over 2.9 — the bar, not a near-black, refuses it').toBeGreaterThan(2.9);
    expect(checkVenueColor('strike', c, DEFAULT_VENUE_COLORS), 'REFUSE unreadable').toEqual({ kind: 'unreadable', ratio: expect.any(Number) });
    expect(checkVenueColor('strike', '#000000', DEFAULT_VENUE_COLORS)?.kind, 'REFUSE black').toBe('unreadable');
  });
  it('⭐ REFUSE — too close to another venue, named', () => {
    expect(checkVenueColor('strike', '#0a5af0', DEFAULT_VENUE_COLORS), 'REFUSE near Coinbase')
      .toEqual({ kind: 'venue', other: 'coinbase', deltaE: expect.any(Number) });
    expect(checkVenueColor('coinbase', '#f0f0f0', DEFAULT_VENUE_COLORS), 'REFUSE near Strike')
      .toEqual({ kind: 'venue', other: 'strike', deltaE: expect.any(Number) });
    expect(checkVenueColor('strike', DEFAULT_VENUE_COLORS.coinbase, DEFAULT_VENUE_COLORS)?.kind, 'REFUSE Coinbase\'s own blue').toBe('venue');
  });
  it('⭐ REFUSE — too close to a status colour, named (cold in violet here: amber is nearer cold\'s orange than the bar)', () => {
    const p = { ...DEFAULT_VENUE_COLORS, cold: '#a78bfa' };
    for (const [s, hex] of Object.entries(STATUS_COLORS)) {
      for (const v of VENUES) {
        expect(checkVenueColor(v, hex, p), `REFUSE ${s} as ${v}`)
          .toEqual({ kind: 'status', status: s, deltaE: expect.any(Number) });
      }
    }
  });
  it('⭐ REFUSE — the bars themselves: 3:1, 20 from a venue, 10 from a status colour — each refuses a colour a weaker bar would pass', () => {
    // 3:1 — '#646474' clears every surface but the venue bars' track (--surface-2), where it reads 2.98
    expect(contrastRatio('#646474', '#151b25'), 'REFUSE premise 3:1 — just under on --surface-2').toBeGreaterThan(2.9);
    expect(checkVenueColor('cold', '#646474', DEFAULT_VENUE_COLORS)?.kind, 'REFUSE the 3:1 bar').toBe('unreadable');
    // 20 — a blue 15.8 from Coinbase's, readable and far from every status colour
    const blue = '#3b82f6';
    expect(deltaE2000(blue, DEFAULT_VENUE_COLORS.coinbase), 'REFUSE premise 20 — between 10 and 20 from Coinbase').toBeGreaterThan(10);
    expect(deltaE2000(blue, DEFAULT_VENUE_COLORS.coinbase), 'REFUSE premise 20 — under 20').toBeLessThan(VENUE_APART_MIN);
    expect(checkVenueColor('strike', blue, DEFAULT_VENUE_COLORS), 'REFUSE the venue bar').toEqual({ kind: 'venue', other: 'coinbase', deltaE: expect.any(Number) });
    // 10 — a green 6.6 from the app's green, readable and far from every venue
    const green = '#10b981';
    expect(deltaE2000(green, STATUS_COLORS.green), 'REFUSE premise 10 — between 5 and 10 from green').toBeGreaterThan(5);
    expect(checkVenueColor('cold', green, DEFAULT_VENUE_COLORS), 'REFUSE the status bar').toEqual({ kind: 'status', status: 'green', deltaE: expect.any(Number) });
  });
  it('⭐ REFUSE — malformed, and the words', () => {
    for (const bad of ['', 'red', '#fff', '#12345g', 'url(x)', '#0052ff;color:red']) {
      expect(checkVenueColor('coinbase', bad, DEFAULT_VENUE_COLORS), `REFUSE malformed ${bad}`).toEqual({ kind: 'malformed' });
    }
    expect(refusalText({ kind: 'unreadable', ratio: 2 }), 'REFUSE words unreadable').toBe('Too dark to read on the app’s background.');
    expect(refusalText({ kind: 'venue', other: 'cold', deltaE: 3 }), 'REFUSE words venue').toBe('Too close to Cold storage’s color.');
    expect(refusalText({ kind: 'status', status: 'amber', deltaE: 3 }), 'REFUSE words status').toBe('Too close to the app’s amber, which means caution.');
    expect(refusalText({ kind: 'malformed' }), 'REFUSE words malformed').toBe('That isn’t a color the app can use.');
  });
});

describe('⭐ SWEEP — over 4,105 colours (a 4,096 grid, the defaults, the swatches) × 3 venues, the rule is exactly its three measures', () => {
  it('⭐ SWEEP — a colour passes iff readable on every surface, apart from the other venues, and apart from the status colours', () => {
    const seen = { pass: 0, unreadable: 0, venue: 0, status: 0 };
    for (const c of [...grid(), ...Object.values(DEFAULT_VENUE_COLORS), ...VENUE_SWATCHES]) {
      for (const v of VENUES) {
        const readable = VENUE_SURFACES.every((s) => contrastRatio(c, s) >= READABLE_MIN);
        const apart = others(v).every((o) => deltaE2000(c, DEFAULT_VENUE_COLORS[o]) >= VENUE_APART_MIN);
        const unlike = c === DEFAULT_VENUE_COLORS[v]
          || Object.values(STATUS_COLORS).every((s) => deltaE2000(c, s) >= STATUS_APART_MIN);
        const r = checkVenueColor(v, c, DEFAULT_VENUE_COLORS);
        expect(r === null, `SWEEP ${c} as ${v}`).toBe(readable && apart && unlike);
        if (r === null) seen.pass++;
        else if (r.kind === 'unreadable') { seen.unreadable++; expect(readable, `SWEEP ${c} reason`).toBe(false); }
        else if (r.kind === 'venue') { seen.venue++; expect(readable && !apart, `SWEEP ${c} reason`).toBe(true); }
        else if (r.kind === 'status') { seen.status++; expect(readable && apart && !unlike, `SWEEP ${c} reason`).toBe(true); }
      }
    }
    for (const [k, n] of Object.entries(seen)) expect(n, `SWEEP reaches ${k}`).toBeGreaterThan(30);
  });
});

describe('⭐ CLEAN — only the three venues, each a well-formed colour, ever reach the palette', () => {
  it('⭐ CLEAN — junk is dropped; case is folded; the palette falls back to the defaults', () => {
    for (const junk of [undefined, null, 'x', 42, [], ['#123456'], true]) {
      expect(cleanVenueColors(junk), `CLEAN ${JSON.stringify(junk)}`).toEqual({});
      expect(venuePaletteOf(junk), `CLEAN palette ${JSON.stringify(junk)}`).toEqual(DEFAULT_VENUE_COLORS);
    }
    expect(cleanVenueColors({ strike: '#ABCDEF', coinbase: 'blue', cold: '#12', ghost: '#123456' }), 'CLEAN mixed')
      .toEqual({ strike: '#abcdef' });
    expect(venuePaletteOf({ coinbase: '#38BDF8' }), 'CLEAN partial').toEqual({ ...DEFAULT_VENUE_COLORS, coinbase: '#38bdf8' });
    expect(hasCustomVenueColors({}), 'CLEAN {} is the defaults').toBe(false);
    expect(hasCustomVenueColors({ cold: DEFAULT_VENUE_COLORS.cold }), 'CLEAN a default is no custom').toBe(false);
    expect(hasCustomVenueColors({ cold: '#2dd4bf' }), 'CLEAN custom').toBe(true);
    for (const junk of [undefined, null, 'x', 42, [], ['#123456'], true]) {
      expect(incomingVenueColors(junk), `CLEAN incoming ${JSON.stringify(junk)} reads as absent`).toBeUndefined();
    }
    expect(incomingVenueColors({}), 'CLEAN incoming {} lands').toEqual({});
    expect(incomingVenueColors({ coinbase: '#38BDF8', ghost: '#123456', cold: 'url(x)' }), 'CLEAN incoming lands as it is — the sink cleans it')
      .toEqual({ coinbase: '#38BDF8', ghost: '#123456', cold: 'url(x)' });
  });
});

describe('⭐ RESOLVE — THE rule at the sink: a stored colour the rule refuses is never shown', () => {
  const TEAL = '#2dd4bf';
  it('⭐ RESOLVE — a stored colour that fails alone falls back: too dark, near a status colour, malformed; a default is no choice', () => {
    expect(resolveVenueColors({ cold: '#000000', strike: STATUS_COLORS.green, coinbase: 'url(x)' }), 'RESOLVE each alone').toEqual({});
    expect(resolveVenueColors({ cold: DEFAULT_VENUE_COLORS.cold, coinbase: '#38BDF8' }), 'RESOLVE a default drops; a passing colour stays')
      .toEqual({ coinbase: '#38bdf8' });
  });
  it('⭐ RESOLVE — a colour too close to another venue\'s default falls back alone (Strike in Coinbase\'s blue)', () => {
    expect(venueContrastOf(DEFAULT_VENUE_COLORS.coinbase), 'RESOLVE premise: readable').toBeGreaterThanOrEqual(READABLE_MIN);
    expect(checkVenueColor('strike', DEFAULT_VENUE_COLORS.coinbase, DEFAULT_VENUE_COLORS)?.kind, 'RESOLVE premise: a venue clash').toBe('venue');
    expect(resolveVenueColors({ strike: DEFAULT_VENUE_COLORS.coinbase, cold: TEAL }), 'RESOLVE Strike falls back, cold stays').toEqual({ cold: TEAL });
  });
  it('⭐ RESOLVE — two venues too close to each other both fall back, in any order; a fallback that exposes a clash drops that colour too', () => {
    const [X, Y, W] = [TEAL, '#00bbbb', '#aaaaaa'];
    expect(deltaE2000(X, Y), 'RESOLVE premise: teal and cyan clash').toBeLessThan(VENUE_APART_MIN);
    expect(checkVenueColor('strike', X, DEFAULT_VENUE_COLORS), 'RESOLVE premise: teal passes alone as Strike').toBeNull();
    expect(checkVenueColor('cold', Y, DEFAULT_VENUE_COLORS), 'RESOLVE premise: cyan passes alone as cold').toBeNull();
    expect(resolveVenueColors({ strike: X, cold: Y }), 'RESOLVE both fall back').toEqual({});
    expect(resolveVenueColors({ cold: Y, strike: X }), 'RESOLVE … in either key order').toEqual({});
    expect(resolveVenueColors({ strike: Y, cold: X }), 'RESOLVE … whichever venue wears which').toEqual({});
    expect(checkVenueColor('coinbase', W, { strike: X, coinbase: W, cold: Y }), 'RESOLVE premise: grey passes beside teal and cyan').toBeNull();
    expect(deltaE2000(W, DEFAULT_VENUE_COLORS.strike), 'RESOLVE premise: grey is too close to Strike\'s white').toBeLessThan(VENUE_APART_MIN);
    expect(resolveVenueColors({ strike: X, coinbase: W, cold: Y }), 'RESOLVE the cascade: Strike back in white, the grey falls too').toEqual({});
  });
  it('⭐ RESOLVE — what the picker can store shows as stored: every palette of defaults and swatches with no two alike', () => {
    let n = 0;
    for (const s of [DEFAULT_VENUE_COLORS.strike, ...VENUE_SWATCHES]) for (const c of [DEFAULT_VENUE_COLORS.coinbase, ...VENUE_SWATCHES]) {
      for (const d of [DEFAULT_VENUE_COLORS.cold, ...VENUE_SWATCHES]) {
        if (new Set([s, c, d]).size < 3) continue;
        const stored = Object.fromEntries(([['strike', s], ['coinbase', c], ['cold', d]] as [Venue, string][])
          .filter(([v, h]) => h !== DEFAULT_VENUE_COLORS[v]));
        expect(resolveVenueColors(stored), `RESOLVE ${JSON.stringify(stored)}`).toEqual(stored);
        n++;
      }
    }
    expect(n, 'RESOLVE premise: the palettes').toBe(229);
  });
  it('⭐ RESOLVE — over 3,000 stored prefs: what shows passes THE rule, is a fixed point, ignores key order, and keeps a lone colour iff it passes', () => {
    let seed = 7;
    const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
    const POOL: unknown[] = [...grid().filter((_, i) => i % 7 === 0), ...Object.values(DEFAULT_VENUE_COLORS), ...VENUE_SWATCHES, 'url(x)', '#12', null];
    const seen = { kept: 0, dropped: 0, lone: 0 };
    for (let i = 0; i < 3000; i++) {
      const p: Record<string, unknown> = {};
      for (const v of VENUES) if (rnd() < 0.7) p[v] = POOL[Math.floor(rnd() * POOL.length)];
      const r = resolveVenueColors(p);
      const shown = venuePaletteOf(p);
      for (const v of VENUES) {
        expect(checkVenueColor(v, shown[v], shown), `RESOLVE ${JSON.stringify(p)}: ${v} passes`).toBeNull();
        const h = normalizeHex(p[v]);
        if (r[v] !== undefined) seen.kept++;
        else if (h !== null && h !== DEFAULT_VENUE_COLORS[v]) seen.dropped++;
      }
      expect(resolveVenueColors(r), `RESOLVE ${JSON.stringify(p)}: a fixed point`).toEqual(r);
      expect(resolveVenueColors(Object.fromEntries(Object.entries(p).reverse())), `RESOLVE ${JSON.stringify(p)}: key order`).toEqual(r);
      const c = cleanVenueColors(p);
      const lone = (Object.keys(c) as Venue[]).filter((v) => c[v] !== DEFAULT_VENUE_COLORS[v]);
      if (lone.length === 1) {
        const v = lone[0];
        expect(r[v] === c[v], `RESOLVE lone ${v} ${c[v]}`).toBe(checkVenueColor(v, c[v] as string, DEFAULT_VENUE_COLORS) === null);
        seen.lone++;
      }
    }
    expect([seen.kept > 500, seen.dropped > 500, seen.lone > 200], 'RESOLVE both sides, and lone colours, reached').toEqual([true, true, true]);
  });
});

describe('⭐ SINK — what reaches :root', () => {
  const fake = () => {
    const props = new Map<string, string>();
    return {
      props,
      style: {
        setProperty: (k: string, v: string | null) => { props.set(k, String(v)); },
        removeProperty: (k: string) => { props.delete(k); return ''; },
      },
    };
  };
  it('⭐ SINK — a chosen colour is set; a default, an absent venue and junk are removed, never set', () => {
    const f = fake();
    applyVenueColors(f.style, { coinbase: '#38bdf8' });
    expect([...f.props], 'SINK chosen').toEqual([['--venue-coinbase', '#38bdf8']]);
    applyVenueColors(f.style, { coinbase: DEFAULT_VENUE_COLORS.coinbase, cold: 'url(https://x.example/t)', strike: '#0052FF;x:y' });
    expect([...f.props], 'SINK default and junk removed').toEqual([]);
    applyVenueColors(f.style, { strike: '#FB7185' });
    expect([...f.props], 'SINK case folded').toEqual([['--venue-strike', '#fb7185']]);
    applyVenueColors(f.style, undefined);
    expect([...f.props], 'SINK never set → all removed').toEqual([]);
    applyVenueColors(f.style, { strike: DEFAULT_VENUE_COLORS.coinbase });
    expect([...f.props], 'SINK a clash never reaches CSS (Strike in Coinbase\'s blue)').toEqual([]);
  });
});
