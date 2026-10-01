import { describe, it, expect } from 'vitest';
// Test-only: recharts' own vendored d3 (the ESM build re-exports node_modules/d3-scale 4.0.2 — exactly what the
// app's log axes run today). It proves the port below leaves the unzoomed axis unchanged (test 15).
import { scaleLog } from 'victory-vendor/d3-scale';
import {
  toUnit, fromUnit, pxToX, pxToY, clampToRect, inRect,
  classifyBox, boxRect, boxToPins,
  scaleDomain, stepPins, panPins, pinchPins,
  normalizePins, effectiveView, isZoomed,
  timeTicks, tickDensity, fmtTimeTick, logTicks, priceTickFormatter,
  isDoubleTap, zoomBackNote, lockAxis, nextMode, leavesHome,
  MIN_SPAN_TIME_LOG,
  type AxisScale, type Domain, type Pins, type PlotRect, type Scales, type View,
} from '../chartZoom';

/**
 * chartZoom — the shared, view-only zoom math (spec `pbloc-spec-chart-zoom-v1.md`). Round synthetic figures only.
 * Each ⭐ names the mutation that turns it red; every one was run against the real module before it landed.
 */

const DAY = 86_400_000;
const RECT: PlotRect = { left: 50, top: 10, width: 400, height: 200 };
const TIME_LOG: Scales = { x: 'linear', y: 'log' };
const PRICE: Domain = [1_000, 100_000];
const pins = (x: Domain | null, y: Domain | null): Pins => ({ x, y });
/** Relative closeness for log-space figures. */
const close = (a: number, b: number, rel = 1e-9) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(rel);
/** The Decision face's base formatter, copied as a fixture (the formatter properties are generic). */
const fmtAxisUsd = (v: number): string => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  if (v >= 1) return `$${Math.round(v)}`;
  return `$${v.toFixed(2)}`;
};

describe('⭐ 1–2 · scale and pixels', () => {
  it('⭐ 1 — the log midpoint of [1,000, 100,000] is 10,000, and toUnit/fromUnit round-trip on both scales', () => {
    // mutation: interpolate linearly → 50,500
    close(fromUnit(0.5, PRICE, 'log'), 10_000);
    close(toUnit(10_000, PRICE, 'log'), 0.5);
    expect(fromUnit(0.5, [0, 100], 'linear')).toBe(50);
    for (const u of [0, 0.1, 0.25, 0.5, 0.9, 1]) {
      close(toUnit(fromUnit(u, PRICE, 'log'), PRICE, 'log') + 1, u + 1);
      expect(toUnit(fromUnit(u, [10 * DAY, 90 * DAY], 'linear'), [10 * DAY, 90 * DAY], 'linear')).toBeCloseTo(u, 12);
    }
  });

  it('⭐ 2 — pxToY at the plot\'s top pixel is the domain\'s HIGH end; x grows to the right', () => {
    // mutation: drop the y inversion → the top pixel reads the LOW end
    close(pxToY(RECT.top, RECT, PRICE, 'log'), 100_000);
    close(pxToY(RECT.top + RECT.height, RECT, PRICE, 'log'), 1_000);
    expect(pxToX(RECT.left, RECT, [0, 100], 'linear')).toBe(0);
    expect(pxToX(RECT.left + RECT.width, RECT, [0, 100], 'linear')).toBe(100);
  });

  it('clampToRect and inRect', () => {
    expect(clampToRect({ x: 0, y: 500 }, RECT)).toEqual({ x: 50, y: 210 });
    expect(inRect({ x: 60, y: 20 }, RECT)).toBe(true);
    expect(inRect({ x: 20, y: 20 }, RECT)).toBe(false);
  });
});

describe('⭐ 3–6 · the box (Plotly\'s dragbox rule)', () => {
  const o = { x: 100, y: 100 };
  const at = (dx: number, dy: number) => classifyBox(o, { x: o.x + dx, y: o.y + dy });

  it('⭐ 3 — sideways → dates only, vertical → price only, both → both, a click → nothing', () => {
    // mutations: drop the 20px cap → (200,25) and (100,25) become x-only; drop MIN_DRAG → a click zooms
    expect(at(100, 5)).toBe('x');
    expect(at(5, 100)).toBe('y');
    expect(at(100, 100)).toBe('xy');
    expect(at(5, 5)).toBeNull();
    expect(at(100, 19)).toBe('x');
    expect(at(100, 25)).toBe('xy');
    expect(at(200, 25)).toBe('xy');
    expect(at(-100, -5)).toBe('x');   // direction never matters
  });

  const view: View = { x: [0, 400 * DAY], y: PRICE };
  const a = { x: 150, y: 60 }, b = { x: 350, y: 160 };

  it('⭐ 4 — boxToPins ignores the drag direction', () => {
    // mutation: no sort → a reversed domain
    const fwd = boxToPins(a, b, 'xy', RECT, view, pins(null, null), TIME_LOG);
    const back = boxToPins(b, a, 'xy', RECT, view, pins(null, null), TIME_LOG);
    const cross = boxToPins({ x: a.x, y: b.y }, { x: b.x, y: a.y }, 'xy', RECT, view, pins(null, null), TIME_LOG);
    expect(back).toEqual(fwd);
    expect(cross).toEqual(fwd);
    expect(fwd.x![0]).toBeLessThan(fwd.x![1]);
    expect(fwd.y![0]).toBeLessThan(fwd.y![1]);
    expect(fwd.x).toEqual([100 * DAY, 300 * DAY]);
  });

  it('⭐ 5 — an x-only box leaves y as it was (auto stays auto)', () => {
    // mutation: write the box's rows into y
    const p = boxToPins(a, { x: b.x, y: a.y + 4 }, 'x', RECT, view, pins(null, null), TIME_LOG);
    expect(p.x).toEqual([100 * DAY, 300 * DAY]);
    expect(p.y).toBeNull();
    const kept = boxToPins(a, { x: b.x, y: a.y + 4 }, 'x', RECT, view, pins(null, [2_000, 20_000]), TIME_LOG);
    expect(kept.y).toEqual([2_000, 20_000]);
    // …and the overlay draws the x-only box as a full-height band
    expect(boxRect(a, { x: b.x, y: a.y + 4 }, 'x', RECT)).toEqual({ left: 150, top: 10, width: 200, height: 200 });
    expect(boxRect(a, { x: a.x + 4, y: b.y }, 'y', RECT)).toEqual({ left: 50, top: 60, width: 400, height: 100 });
  });

  it('⭐ 6 — a box over the middle half (in px) of [1e3, 1e5] pins y to [10^3.5, 10^4.5]', () => {
    // mutation: linear mapping → [25,750, 75,250]
    const p = boxToPins({ x: 60, y: 60 }, { x: 440, y: 160 }, 'xy', RECT, view, pins(null, null), TIME_LOG);
    close(p.y![0], 10 ** 3.5);
    close(p.y![1], 10 ** 4.5);
  });
});

describe('⭐ 7–10 · step, pan, pinch and the clamp', () => {
  const full: View = { x: [0, 100 * DAY], y: PRICE };

  it('⭐ 7 — + halves each span about the centre (log space on y); − from near-full normalizes to auto', () => {
    // mutation: no cap in normalizePins → the − view leaves the data
    const p = stepPins(full, 'in', TIME_LOG);
    expect(p.x![0]).toBeCloseTo(25 * DAY, 3);
    expect(p.x![1]).toBeCloseTo(75 * DAY, 3);
    close(p.y![0], 10 ** 3.5);
    close(p.y![1], 10 ** 4.5);
    const nearFull: View = { x: [10 * DAY, 90 * DAY], y: PRICE };
    expect(normalizePins(stepPins(nearFull, 'out', TIME_LOG), full, TIME_LOG, MIN_SPAN_TIME_LOG)).toEqual(pins(null, null));
    close(scaleDomain([100, 10_000], 2, 'log')[1], 100_000);
  });

  it('⭐ 8 — a drag right by a quarter width moves x a quarter span EARLIER (content follows the finger)', () => {
    // mutation: sign flip → a quarter span LATER
    const p = panPins(full, RECT.width / 4, 0, RECT, TIME_LOG);
    expect(p.x![0]).toBeCloseTo(-25 * DAY, 3);
    expect(p.x![1]).toBeCloseTo(75 * DAY, 3);
    close(p.y![0], 1_000);   // no vertical move → y untouched
    // a drag DOWN by a quarter height shows a quarter span (in log space) HIGHER prices
    const q = panPins(full, 0, RECT.height / 4, RECT, TIME_LOG);
    close(q.y![0], 10 ** 3.5);
    close(q.y![1], 10 ** 5.5);
  });

  it('⭐ 9 — fingers twice as far apart sideways halve the x span about the centroid; y is unchanged', () => {
    // mutation: isotropic scaling (one distance for both axes) → y halves too
    const start: View = { x: [0, 400 * DAY], y: PRICE };
    const from = [{ x: 200, y: 110 }, { x: 300, y: 110 }] as const;
    const to = [{ x: 150, y: 110 }, { x: 350, y: 110 }] as const;
    const p = pinchPins(start, from, to, RECT, TIME_LOG);
    expect(p.x![1] - p.x![0]).toBeCloseTo(200 * DAY, 3);
    // the date under the centroid (px 250 → day 200) is still under it
    expect(pxToX(250, RECT, p.x!, 'linear')).toBeCloseTo(200 * DAY, 3);
    close(p.y![0], PRICE[0]);
    close(p.y![1], PRICE[1]);
  });

  it('⭐ 10 — the clamp shifts (never clips), caps, raises to the minimum, and turns full into auto', () => {
    // mutations: clip instead of shift at the high end → [950, 1,000]; clip at the LOW end (Z7) → [0, 50]; drop the
    // minimum → a 1-day pin survives
    const big: View = { x: [0, 1_000 * DAY], y: PRICE };
    const n = (x: Domain) => normalizePins(pins(x, null), big, TIME_LOG, MIN_SPAN_TIME_LOG).x;
    const shifted = n([950 * DAY, 1_050 * DAY])!;
    expect(shifted[0]).toBeCloseTo(900 * DAY, 3);
    expect(shifted[1]).toBeCloseTo(1_000 * DAY, 3);
    const early = n([-50 * DAY, 50 * DAY])!;                 // before the data → slides forward, same 100-day span
    expect(early[0]).toBeCloseTo(0, 3);
    expect(early[1]).toBeCloseTo(100 * DAY, 3);
    expect(n([-10 * DAY, 1_010 * DAY])).toBeNull();          // wider than the data → auto
    const raised = n([500 * DAY, 501 * DAY])!;               // under the 90-day minimum → widened about its centre
    expect(raised[1] - raised[0]).toBeCloseTo(90 * DAY, 3);
    expect((raised[0] + raised[1]) / 2).toBeCloseTo(500.5 * DAY, 3);
    expect(n([0, 1_000 * DAY])).toBeNull();                   // exactly full → auto
    // y: the ×1.1 minimum, in log space
    const y = normalizePins(pins(null, [50_000, 50_001]), big, TIME_LOG, MIN_SPAN_TIME_LOG).y!;
    close(y[1] / y[0], 1.1);
  });

  it('effectiveView and isZoomed', () => {
    expect(effectiveView(pins(null, null), full)).toEqual(full);
    expect(effectiveView(pins([DAY, 2 * DAY], null), full)).toEqual({ x: [DAY, 2 * DAY], y: PRICE });
    expect(isZoomed(pins(null, null))).toBe(false);
    expect(isZoomed(pins(null, [1, 2]))).toBe(true);
  });
});

describe('⭐ 11–13 · the date axis', () => {
  const YEAR_MS = 365.25 * DAY;
  /** The old `yearTicks` (decisionChartView), frozen here as the oracle for "unzoomed labels unchanged". */
  function oldYearTicks(minT: number, maxT: number): number[] {
    if (!Number.isFinite(minT) || !Number.isFinite(maxT) || !(maxT > minT)) return [];
    const span = (maxT - minT) / YEAR_MS;
    const step = span <= 12 ? 2 : span <= 24 ? 4 : 8;
    const first = new Date(minT).getUTCFullYear();
    const out: number[] = [];
    for (let y = Math.ceil(first / step) * step; ; y += step) {
      const t = Date.UTC(y, 0, 1);
      if (t > maxT) break;
      if (t >= minT) out.push(t);
    }
    return out;
  }
  const Y = (y: number) => Date.UTC(y, 0, 1);

  it('⭐ 11 — at density 6 it IS the old yearTicks for every span over 6 years (sweep)', () => {
    // mutations: `≤ density` → `< density` (moves the 12- and 24-year thresholds); add a 16-year rung (spans > 48 y)
    const starts = [Date.UTC(2010, 6, 17), Date.UTC(2009, 0, 3), Date.UTC(2013, 11, 31), Date.UTC(2026, 8, 30)];
    const spans: number[] = [12, 24, 48];
    for (let s = 6.05; s <= 60; s += 0.37) spans.push(s);
    let checked = 0;
    for (const lo of starts) for (const s of spans) {
      const hi = lo + s * YEAR_MS;
      expect(timeTicks([lo, hi], 6).ticks, `span ${s.toFixed(2)} y from ${new Date(lo).toISOString()}`)
        .toEqual(oldYearTicks(lo, hi));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(500);
    // the three cases moved from decisionChartView.test.ts
    expect(timeTicks([Date.UTC(2010, 6, 17), Date.UTC(2031, 8, 29)], 6).ticks).toEqual([2012, 2016, 2020, 2024, 2028].map(Y));
    expect(timeTicks([Date.UTC(2010, 6, 17), Date.UTC(2046, 8, 29)], 6).ticks).toEqual([2016, 2024, 2032, 2040].map(Y));
    // ⚠ The one moved case whose answer CHANGES, by design (the plan's unzoomed difference 1): a span of 6 years or
    // less gets yearly labels. `yearTicks` gave [2028, 2030] here.
    expect(timeTicks([Date.UTC(2026, 8, 29), Date.UTC(2031, 8, 29)], 6).ticks).toEqual([2027, 2028, 2029, 2030, 2031].map(Y));
    // unique, ascending, inside the span — and junk gives none
    const t = timeTicks([Y(2011), Y(2046)], 6).ticks;
    expect(new Set(t).size).toBe(t.length);
    t.forEach((v, i) => { if (i > 0) expect(v).toBeGreaterThan(t[i - 1]); });
    for (const v of t) { expect(v).toBeGreaterThanOrEqual(Y(2011)); expect(v).toBeLessThanOrEqual(Y(2046)); }
    expect(timeTicks([Number.NaN, Y(2030)], 6).ticks).toEqual([]);
    expect(timeTicks([Y(2030), Y(2020)], 6).ticks).toEqual([]);
    // the density the hook uses
    expect(tickDensity(300)).toBe(6);
    expect(tickDensity(850)).toBe(8);
    expect(tickDensity(Number.NaN)).toBe(6);
  });

  it('⭐ 12 — zoomed spans re-flow: 4 y yearly · 30 mo Jan/Jul · 9 mo quarterly · 4 mo monthly, at UTC month starts', () => {
    // mutation: local-time months (new Date(y, m, 1)) → every value is off by the machine's UTC offset
    const M = (y: number, m: number) => Date.UTC(y, m, 1);
    const four = timeTicks([Date.UTC(2027, 1, 15), Date.UTC(2031, 1, 15)], 6);
    expect(four.unit).toBe('year');
    expect(four.ticks).toEqual([2028, 2029, 2030, 2031].map(Y));
    const halves = timeTicks([Date.UTC(2027, 1, 15), Date.UTC(2029, 7, 15)], 6);
    expect(halves.unit).toBe('month');
    expect(halves.ticks).toEqual([M(2027, 6), M(2028, 0), M(2028, 6), M(2029, 0), M(2029, 6)]);
    const quarters = timeTicks([Date.UTC(2027, 1, 15), Date.UTC(2027, 10, 15)], 6);
    expect(quarters.ticks).toEqual([M(2027, 3), M(2027, 6), M(2027, 9)]);
    const months = timeTicks([Date.UTC(2027, 0, 15), Date.UTC(2027, 4, 15)], 6);
    expect(months.ticks).toEqual([M(2027, 1), M(2027, 2), M(2027, 3), M(2027, 4)]);
    for (const tt of [halves, quarters, months].flatMap((r) => r.ticks)) {
      const d = new Date(tt);
      expect([d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()]).toEqual([1, 0, 0]);
    }
  });

  it('⭐ 13 — labels come from a fixed month table, in UTC: "Sep", never "Sept"', () => {
    // mutation: toLocaleDateString('en-GB', { month: 'short' }) → "Sept" under Node's ICU
    expect(fmtTimeTick(Date.UTC(2026, 8, 1), 'month', 1)).toBe('Sep');
    expect(fmtTimeTick(Date.UTC(2027, 0, 1), 'month', 2)).toBe('2027');
    expect(fmtTimeTick(Date.UTC(2027, 3, 1), 'month', 0)).toBe('Apr 2027');
    expect(fmtTimeTick(Date.UTC(2026, 0, 1), 'year', 0)).toBe('2026');
    expect(fmtTimeTick(Number.NaN, 'year', 0)).toBe('');
  });
});

describe('⭐ 14–16 · the price axis', () => {
  it('⭐ 14 — logTicks: today\'s full views, and the re-flow inside a decade', () => {
    // mutation: drop the linear fallback → [62k, 68k] gets no ticks
    expect(logTicks([0.04, 1.2e6])).toEqual([1, 100, 10_000, 1_000_000]);          // Decision today
    expect(logTicks([0.01, 1e8])).toEqual([0.01, 1, 100, 10_000, 1_000_000, 100_000_000]);   // PowerLaw today
    expect(logTicks([60_000, 80_000])).toEqual([60_000, 70_000, 80_000]);
    expect(logTicks([62_000, 68_000])).toEqual([62_000, 63_000, 64_000, 65_000, 66_000, 67_000, 68_000]);
  });

  it('⭐ 15 — the port IS d3\'s log.ticks(5): edge decades plus 500 seeded random domains', () => {
    // mutation: `j − i < n` → `≤` (the exact-five-decade domains take the other branch)
    let seed = 20260930;
    const rnd = () => {   // mulberry32 — deterministic
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const domains: Domain[] = [[1, 1e5], [0.01, 1e3], [10, 1e6], [1, 1e4], [3, 3e5], [0.04, 1.2e6], [0.01, 1e8],
      [1, 1.1], [60_000, 66_000], [99_000, 101_000]];
    for (let i = 0; i < 500; i++) {
      const lo = 10 ** (rnd() * 10 - 3);
      domains.push([lo, lo * 10 ** (0.02 + rnd() * 8)]);
    }
    for (const d of domains) {
      expect(logTicks(d, 5), `[${d[0]}, ${d[1]}]`).toEqual(scaleLog().domain([d[0], d[1]]).ticks(5));
    }
  });

  it('⭐ 16 — the base formatter\'s own labels when distinct; decimals only where they would repeat', () => {
    // mutation: always use the base → "$63k" twice
    for (const t of [[1, 100, 10_000, 1_000_000], [60_000, 70_000, 80_000]]) {
      const f = priceTickFormatter(t, fmtAxisUsd);
      expect(t.map(f)).toEqual(t.map(fmtAxisUsd));
    }
    const t = [62_000, 62_500, 63_000];
    expect(t.map(priceTickFormatter(t, fmtAxisUsd))).toEqual(['$62.0k', '$62.5k', '$63.0k']);
    const narrow = logTicks([1, 1.1]);
    const labels = narrow.map(priceTickFormatter(narrow, fmtAxisUsd));
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('⭐ 17–18 · taps and the note', () => {
  it('⭐ 17 — a double tap is two taps within 300 ms and 30 px', () => {
    // mutation: drop the distance check → two taps 60 px apart reset the zoom
    const first = { t: 0, x: 100, y: 100 };
    expect(isDoubleTap(first, { t: 250, x: 110, y: 100 })).toBe(true);
    expect(isDoubleTap(first, { t: 400, x: 100, y: 100 })).toBe(false);
    expect(isDoubleTap(first, { t: 200, x: 160, y: 100 })).toBe(false);
    expect(isDoubleTap(null, { t: 200, x: 100, y: 100 })).toBe(false);
  });

  it('18 — the note speaks the input that zoomed', () => {
    expect(zoomBackNote('mouse')).toBe('Double-click to zoom back out');
    expect(zoomBackNote('touch')).toBe('Double-tap to zoom back out');
    expect(zoomBackNote('pen')).toBe('Double-tap to zoom back out');
  });
});

describe('⭐ 19–20 · guards for the future adopters (Z3)', () => {
  it('⭐ 19 (Z3a) — a full span below the minimum gives auto, never a pin wider than the data', () => {
    // mutation: raise to the minimum after the cap without re-checking the full span → a 90-day pin on 60 days
    const short: View = { x: [0, 60 * DAY], y: PRICE };
    expect(normalizePins(pins([10 * DAY, 20 * DAY], null), short, TIME_LOG, MIN_SPAN_TIME_LOG).x).toBeNull();
  });

  it('⭐ 20 (Z3b) — never a zero label for a positive tick, even when the base labels are distinct', () => {
    // mutation: return the base labels whenever they are distinct → "$0.00"
    const t = [0.004, 1, 100];
    expect(t.map(fmtAxisUsd)).toEqual(['$0.00', '$1', '$100']);   // premise: distinct, and a false zero
    const label = priceTickFormatter(t, fmtAxisUsd)(0.004);
    expect(label).toMatch(/[1-9]/);
    expect(label).not.toBe('$0.00');
  });
});

describe('⭐ 21 · the scrub lock (Z6)', () => {
  it('⭐ 21 (Z6) — past 8px a stroke locks: more sideways than vertical holds the page, anything else scrolls it', () => {
    // mutations: drop the absolute values → a LEFTWARD scrub reads as vertical and the page scrolls; drop the 8px
    // gate → a tap's twitch locks; `>` → `>=` → a perfect diagonal is held
    expect(lockAxis(3, 1)).toBeNull();          // under 8px — it may still be a tap
    expect(lockAxis(12, 3)).toBe('x');
    expect(lockAxis(-12, 3)).toBe('x');         // leftward
    expect(lockAxis(12, -9)).toBe('x');         // a wobble, still more sideways than vertical
    expect(lockAxis(8, 0)).toBe('x');           // exactly 8px is a stroke (the tap rule and the drag's arm agree)
    expect(lockAxis(3, 12)).toBe('y');
    expect(lockAxis(-3, -12)).toBe('y');
    expect(lockAxis(8, 8)).toBe('y');           // a perfect diagonal scrolls, as before
    expect(lockAxis(Number.NaN, 20)).toBeNull();
    expect(lockAxis(20, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('⭐ 22 · the toolbar\'s mode rule (Z15)', () => {
  it('⭐ 22 (Z15) — on a computer Pan toggles back to Zoom, the resting mode; on a phone a pressed mode toggles off to Scroll', () => {
    // mutations: the old radio rule (a computer keeps the pressed mode) → clicking the pressed Pan leaves Pan on;
    // rest on Zoom on a phone too → a touch device could never get back to scrolling the page
    expect(nextMode('pan', 'pan', true)).toBe('zoom');
    expect(nextMode('zoom', 'zoom', true)).toBe('zoom');
    expect(nextMode('zoom', 'pan', true)).toBe('pan');
    expect(nextMode('pan', 'zoom', true)).toBe('zoom');
    expect(nextMode(null, 'pan', false)).toBe('pan');
    expect(nextMode('pan', 'pan', false)).toBeNull();
    expect(nextMode('zoom', 'zoom', false)).toBeNull();
    expect(nextMode('zoom', 'pan', false)).toBe('pan');
  });
});

describe('⭐ 23–28 · the reach (the Decision chart\'s price axis) and the note', () => {
  /** HOME is the fitted view: where the chart opens, and where Reset returns. REACH is how far zoom-out and pan may go —
   *  the Decision chart's shape: the dates' reach is home, and the price reaches $0.01–$10M. */
  const HOME: View = { x: [0, 1_000 * DAY], y: [1_000, 100_000] };
  const REACH: View = { x: HOME.x, y: [0.01, 10_000_000] };
  const norm = (p: Pins, home: View = HOME, reach: View = REACH): Pins =>
    normalizePins(p, home, TIME_LOG, MIN_SPAN_TIME_LOG, reach);

  it('⭐ 23 — − from home zooms out past it, step by step, and stops at the reach', () => {
    // mutations: ignore the reach (today's clamp) → the first step out is auto, its top 1e5; a span at the reach →
    // auto ("always null") → the third step snaps back to home; drop the early return → the third step runs wider
    // than the reach
    let p = pins(null, null);
    const views: View[] = [];
    for (let i = 0; i < 4; i++) {
      p = norm(stepPins(effectiveView(p, HOME), 'out', TIME_LOG));
      views.push(effectiveView(p, HOME));
    }
    close(views[0].y[0], 100);                       // 2 → 4 decades about 10^4
    close(views[0].y[1], 1_000_000);
    close(views[1].y[0], 0.1);                       // 8 decades, shifted down inside the reach
    close(views[1].y[1], 10_000_000);
    for (const v of views.slice(2)) {                // the whole reach, and no further
      close(v.y[0], 0.01);
      close(v.y[1], 10_000_000);
    }
    expect(p.x).toBeNull();                          // the dates' reach is home, so they stay auto
    expect(isZoomed(p)).toBe(true);                  // pinned: Reset stays enabled
  });

  it('⭐ 24 — a pan at home moves the price (today it snaps back); past the reach it stops at the edge, its span kept; the dates stay home', () => {
    // mutations: ignore the reach → a pan at home is auto; clip at the reach's edge instead of shifting → the far pan
    // loses its span
    const up = norm(panPins(HOME, 0, RECT.height / 4, RECT, TIME_LOG));   // a drag DOWN shows higher prices
    expect(up.y, 'the view moved').not.toBeNull();
    close(up.y![0], 10 ** 3.5);
    close(up.y![1], 10 ** 5.5);
    expect(up.x).toBeNull();
    const far = norm(panPins(HOME, 0, RECT.height * 10, RECT, TIME_LOG));
    expect(far.y, 'the far pan').not.toBeNull();
    close(far.y![0], 100_000);                       // the reach's top, 2 decades kept
    close(far.y![1], 10_000_000);
    expect(norm(panPins(HOME, RECT.width / 4, 0, RECT, TIME_LOG))).toEqual(pins(null, null));   // sideways: still home
  });

  it('⭐ 25 — a pin back at home is auto: a pan up and back down returns home (Reset\'s view, zoomed false); half a span off home stays pinned', () => {
    // mutations: drop the home check → `back` stays pinned at ≈home; drop its `a` (or `b`) conjunct → [10², 10⁵]
    // (or [10³, 10⁶]), which ends at home's top (or starts at its bottom), turns auto
    const up = norm(panPins(HOME, 0, RECT.height / 4, RECT, TIME_LOG));
    expect(isZoomed(up), 'premise: the pan left home').toBe(true);
    const back = norm(panPins(effectiveView(up, HOME), 0, -RECT.height / 4, RECT, TIME_LOG));
    expect(back).toEqual(pins(null, null));
    expect(effectiveView(back, HOME)).toEqual(HOME);
    expect(norm(pins(null, [100, 100_000])).y, 'home\'s top, half a span lower at the bottom').not.toBeNull();
    expect(norm(pins(null, [1_000, 1_000_000])).y, 'home\'s bottom, half a span higher at the top').not.toBeNull();
  });

  it('⭐ 26 — a reach equal to home IS today\'s clamp, bit for bit (a frozen oracle; green before and after by design)', () => {
    // mutations: drop the home check's span conjunct → [750, 1e12 − 750] on a [0, 1e12] home (within 2·EPS of it, at
    // its place) turns auto; drop the early return → the 60-day home's pins come back pinned (Z3a)
    const fw = (v: number, s: AxisScale): number => (s === 'log' ? Math.log(v) : v);
    const iv = (t: number, s: AxisScale): number => (s === 'log' ? Math.exp(t) : t);
    /** Today's normAxis (chartZoom.ts before the reach), frozen. */
    function oldNormAxis(pin: Domain | null, full: Domain, s: AxisScale, minSpan: number): Domain | null {
      if (pin === null) return null;
      const f0 = fw(full[0], s), f1 = fw(full[1], s);
      const fullSpan = f1 - f0;
      if (!(fullSpan > 0)) return null;
      let a = fw(pin[0], s), b = fw(pin[1], s);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
      if (a > b) [a, b] = [b, a];
      const c = (a + b) / 2;
      const span = Math.max(b - a, minSpan);
      if (span >= fullSpan * (1 - 1e-9)) return null;
      a = c - span / 2;
      b = c + span / 2;
      if (a < f0) { b += f0 - a; a = f0; }
      if (b > f1) { a -= b - f1; b = f1; }
      return [iv(a, s), iv(b, s)];
    }
    const oldNorm = (p: Pins, full: View): Pins => ({
      x: oldNormAxis(p.x, full.x, TIME_LOG.x, MIN_SPAN_TIME_LOG.x),
      y: oldNormAxis(p.y, full.y, TIME_LOG.y, MIN_SPAN_TIME_LOG.y),
    });
    const homes: View[] = [
      HOME,
      { x: [Date.UTC(2009, 0, 3), Date.UTC(2031, 8, 30)], y: [0.04, 1_200_000] },   // the Decision chart's shape
      { x: [0, 60 * DAY], y: [1, 1.05] },                                         // both under the minimum (Z3a)
      { x: [0, 1e12], y: [1_000, 100_000] },
    ];
    // premise: the span conjunct's case is pinned today
    expect(oldNormAxis([750, 1e12 - 750], [0, 1e12], 'linear', MIN_SPAN_TIME_LOG.x)).not.toBeNull();

    let seed = 20261001;
    const rnd = () => {   // mulberry32 — deterministic
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const at = (d: Domain, s: AxisScale, u: number): number => {
      const a = fw(d[0], s), b = fw(d[1], s);
      return iv(a + u * (b - a), s);
    };
    const pinAt = (d: Domain, s: AxisScale, u0: number, u1: number): Domain => [at(d, s, u0), at(d, s, u1)];
    const JUNK: Domain[] = [[Number.NaN, 1], [0, Infinity], [-Infinity, 0], [1.4e308, -1.4e308], [Infinity, -Infinity]];
    const UNIT: [number, number][] = [
      [0, 1], [1, 0], [0.25, 0.75], [-0.5, 0.5], [0.5, 1.5], [-0.1, 1.1], [0.5, 0.5], [0.4, 0.4 + 1e-7],
      [0.5e-9, 1 - 0.5e-9], [0.75e-9, 1 - 0.75e-9], [-0.5e-9, 1 + 0.5e-9], [2e-9, 1], [0, 1 - 2e-9],
    ];
    const randomPin = (d: Domain, s: AxisScale): Domain | null => {
      const r = rnd();
      if (r < 0.08) return null;
      if (r < 0.12) return JUNK[Math.floor(rnd() * JUNK.length)];
      if (r < 0.35) {   // within ±20 ulp-ish of the full span — the threshold
        const off = (rnd() - 0.5) * 1e-8, k = (rnd() * 40 - 20) * 1e-9;
        return pinAt(d, s, off, 1 + off + k);
      }
      if (r < 0.55) {   // under the minimum
        const c = rnd() * 1.4 - 0.2, h = rnd() * 0.02;
        return pinAt(d, s, c - h, c + h);
      }
      return pinAt(d, s, rnd() * 2 - 0.5, rnd() * 2 - 0.5);
    };
    const sameBits = (a: Domain | null, b: Domain | null): boolean =>
      a === null || b === null ? a === b : Object.is(a[0], b[0]) && Object.is(a[1], b[1]);

    const mismatches: string[] = [];
    let nulls = 0, pinned = 0;
    const check = (p: Pins, home: View) => {
      const got = normalizePins(p, home, TIME_LOG, MIN_SPAN_TIME_LOG, home);
      const want = oldNorm(p, home);
      for (const k of ['x', 'y'] as const) {
        if (want[k] === null) nulls += 1; else pinned += 1;
        if (!sameBits(got[k], want[k])) {
          mismatches.push(`${k} [${p[k]}] on [${home[k]}]: [${got[k]}] ≠ [${want[k]}]`);
        }
      }
    };
    for (const home of homes) {
      for (const [u0, u1] of UNIT) check({ x: pinAt(home.x, 'linear', u0, u1), y: pinAt(home.y, 'log', u0, u1) }, home);
      for (const j of JUNK) check({ x: j, y: j }, home);
      check(pins(null, null), home);
      for (let i = 0; i < 3_000; i++) check({ x: randomPin(home.x, 'linear'), y: randomPin(home.y, 'log') }, home);
    }
    check(pins([750, 1e12 - 750], null), homes[3]);
    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(nulls, 'auto outcomes').toBeGreaterThan(100);
    expect(pinned, 'pinned outcomes').toBeGreaterThan(100);
  });

  it('⭐ 27 — the reach always contains home, end by end', () => {
    // mutations: no union (the reach as given) → a home wider than the reach "zooms out" to the narrower reach — a zoom
    // IN; drop `r0 === h0` (or `r1 === h1`) → a reach wider at the bottom (or the top) only zooms out to home instead
    const WIDE: View = { x: HOME.x, y: [0.001, 1e9] };
    expect(norm(stepPins(WIDE, 'out', TIME_LOG), WIDE)).toEqual(pins(null, null));
    const bottom = norm(stepPins(HOME, 'out', TIME_LOG), HOME, { x: HOME.x, y: [10, 100_000] }).y;
    expect(bottom, 'a reach wider at the bottom only').not.toBeNull();
    close(bottom![0], 10);
    close(bottom![1], 100_000);
    const top = norm(stepPins(HOME, 'out', TIME_LOG), HOME, { x: HOME.x, y: [1_000, 10_000_000] }).y;
    expect(top, 'a reach wider at the top only').not.toBeNull();
    close(top![0], 1_000);
    close(top![1], 10_000_000);
  });

  it('⭐ 28 — the note says "reset" once a view leaves home, and "zoom back out" while it stays inside', () => {
    // mutations: `||` → `&&` in leavesHome → a price-only zoom out reads as inside; the note never says reset → after a
    // zoom out it would say "zoom back out", which is false (a double-tap zooms back IN, to home)
    expect(leavesHome({ x: [100 * DAY, 300 * DAY], y: [2_000, 20_000] }, HOME, TIME_LOG)).toBe(false);   // a box inside
    expect(leavesHome(HOME, HOME, TIME_LOG)).toBe(false);
    expect(leavesHome({ x: HOME.x, y: [100, 1_000_000] }, HOME, TIME_LOG)).toBe(true);                 // a price zoom out
    expect(leavesHome({ x: HOME.x, y: [10 ** 3.5, 10 ** 5.5] }, HOME, TIME_LOG)).toBe(true);           // a pan up
    expect(zoomBackNote('mouse', true)).toBe('Double-click to reset the view');
    expect(zoomBackNote('touch', true)).toBe('Double-tap to reset the view');
    expect(zoomBackNote('mouse', false)).toBe('Double-click to zoom back out');
  });
});
