/**
 * chartZoom — the shared, VIEW-ONLY zoom math behind `useChartZoom` + `ChartZoomFrame` (spec
 * `pbloc-spec-chart-zoom-v1.md`). PURE: no React, no DOM, no recharts, no store — and it imports NOTHING (a leaf, like
 * `simulation/ltv.ts`; `chartZoomWiring.test.ts` pins that).
 *
 * The model: the view is two domains. Each axis is AUTO (`null` — it follows the chart's own full extent, HOME: the
 * opening view, and where Reset returns) or PINNED (the owner's domain). Pins are clamped into the REACH — how far
 * zoom-out and pan may go — which always contains home and is home unless a chart gives one (the Decision chart's price
 * reaches $0.01–$10M). Every operation runs in SCALED space — identity on a linear axis, `ln` on a log axis — so +/−,
 * pan, pinch and the clamp are one piece of code on both axes, and the price axis works in log space by construction.
 * Zoom changes the view only: nothing here ever touches a series value.
 */

export type AxisScale = 'linear' | 'log';   // 'log' = ln space. A future "log time" axis is 'log' on (t − GENESIS).
export type Domain = [lo: number, hi: number];   // mutable, so it passes straight to a recharts `domain`
export interface Scales { x: AxisScale; y: AxisScale }
export interface View { x: Domain; y: Domain }
/** A pinned axis holds the owner's domain; `null` = auto (the chart's full extent). */
export interface Pins { x: Domain | null; y: Domain | null }
/** The plot area, in px relative to the chart area (the element the gestures land on). */
export interface PlotRect { left: number; top: number; width: number; height: number }
/** A point in px, relative to the same chart area. */
export interface Pt { x: number; y: number }
/** The smallest span a pin may have, in SCALED units: ms on a time axis, an ln-ratio on a log price axis. */
export interface MinSpan { x: number; y: number }

const DAY_MS = 86_400_000;
/** 90 days on the dates (about a dozen history points and four forward months) and ×1.1 on the price. */
export const MIN_SPAN_TIME_LOG: MinSpan = { x: 90 * DAY_MS, y: Math.log(1.1) };
/** A pin within this relative distance of home's (or the reach's) span IS that span (float guard). */
const FULL_EPS = 1e-9;

const fwd = (v: number, s: AxisScale): number => (s === 'log' ? Math.log(v) : v);
const inv = (t: number, s: AxisScale): number => (s === 'log' ? Math.exp(t) : t);

// ── Scale and pixels ────────────────────────────────────────────────────────────────────────────────────────────

/** Where `v` sits along the domain: 0 at the low end, 1 at the high end (in scaled space). */
export function toUnit(v: number, d: Domain, s: AxisScale): number {
  const a = fwd(d[0], s), b = fwd(d[1], s);
  return (fwd(v, s) - a) / (b - a);
}

/** The value at fraction `u` along the domain (in scaled space). */
export function fromUnit(u: number, d: Domain, s: AxisScale): number {
  const a = fwd(d[0], s), b = fwd(d[1], s);
  return inv(a + u * (b - a), s);
}

export function pxToX(px: number, r: PlotRect, d: Domain, s: AxisScale): number {
  return fromUnit((px - r.left) / r.width, d, s);
}

/** y grows DOWN on screen, so the plot's top pixel is the domain's HIGH end. */
export function pxToY(py: number, r: PlotRect, d: Domain, s: AxisScale): number {
  return fromUnit(1 - (py - r.top) / r.height, d, s);
}

export function clampToRect(p: Pt, r: PlotRect): Pt {
  return {
    x: Math.min(r.left + r.width, Math.max(r.left, p.x)),
    y: Math.min(r.top + r.height, Math.max(r.top, p.y)),
  };
}

export function inRect(p: Pt, r: PlotRect): boolean {
  return p.x >= r.left && p.x <= r.left + r.width && p.y >= r.top && p.y <= r.top + r.height;
}

// ── The box — Plotly's dragbox rule ─────────────────────────────────────────────────────────────────────────────

/** Under this, a drag is a click and zooms nothing. */
export const MIN_DRAG_PX = 8;
/** A box thinner than this (relative to the other side) zooms the other axis only. */
export const BAND_PX = 20;
export type BoxAxes = 'xy' | 'x' | 'y';

/**
 * Plotly's rule (dragbox.js): if `dy < min(max(0.6·dx, 8), 20)` it zooms the dates only — nothing if `dx < 8`; else
 * if `dx < min(0.6·dy, 20)` it zooms the price only; otherwise both. Direction never matters.
 */
export function classifyBox(a: Pt, b: Pt): BoxAxes | null {
  const dx = Math.abs(b.x - a.x), dy = Math.abs(b.y - a.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  if (dy < Math.min(Math.max(dx * 0.6, MIN_DRAG_PX), BAND_PX)) return dx < MIN_DRAG_PX ? null : 'x';
  if (dx < Math.min(dy * 0.6, BAND_PX)) return 'y';
  return 'xy';
}

/** What the overlay draws: the box clamped to the plot; a dates-only box is a full-height band, and vice versa. */
export function boxRect(a: Pt, b: Pt, axes: BoxAxes, r: PlotRect): PlotRect {
  const p = clampToRect(a, r), q = clampToRect(b, r);
  const left = axes === 'y' ? r.left : Math.min(p.x, q.x);
  const right = axes === 'y' ? r.left + r.width : Math.max(p.x, q.x);
  const top = axes === 'x' ? r.top : Math.min(p.y, q.y);
  const bottom = axes === 'x' ? r.top + r.height : Math.max(p.y, q.y);
  return { left, top, width: right - left, height: bottom - top };
}

/** The pins a released box sets. An axis the box doesn't zoom keeps its pin (auto stays auto). */
export function boxToPins(a: Pt, b: Pt, axes: BoxAxes, r: PlotRect, view: View, pins: Pins, sc: Scales): Pins {
  const box = boxRect(a, b, axes, r);
  const x: Domain | null = axes === 'y' ? pins.x
    : [pxToX(box.left, r, view.x, sc.x), pxToX(box.left + box.width, r, view.x, sc.x)];
  const y: Domain | null = axes === 'x' ? pins.y
    : [pxToY(box.top + box.height, r, view.y, sc.y), pxToY(box.top, r, view.y, sc.y)];
  return { x, y };
}

// ── The scrub lock (Z6) — a one-finger stroke in Scroll mode ────────────────────────────────────────────────────

export type LockAxis = 'x' | 'y';

/**
 * The direction a one-finger stroke locks to once it passes MIN_DRAG_PX — under it (or on junk) it may still be a
 * tap: `null`. More sideways than vertical → 'x': the chart holds the page still and recharts' tooltip scrubs, even
 * if the finger wobbles later. Anything else → 'y': the page scrolls, as before (a perfect diagonal scrolls). The
 * 8px is the tap rule's and the drag's arm: `hypot ≥ 8` is a stroke.
 */
export function lockAxis(dx: number, dy: number): LockAxis | null {
  const ax = Math.abs(dx), ay = Math.abs(dy);
  if (!Number.isFinite(ax) || !Number.isFinite(ay) || Math.hypot(ax, ay) < MIN_DRAG_PX) return null;
  return ax > ay ? 'x' : 'y';
}

// ── The toolbar's mode (Z15) ────────────────────────────────────────────────────────────────────────────────────

/** Zoom draws a box, Pan pans; `null` is Scroll — a touch device's resting mode (the page scrolls over the chart). */
export type ZoomMode = 'zoom' | 'pan' | null;

/**
 * The mode after a press on the Zoom or Pan button. An unpressed button selects its mode. Pressing the pressed one:
 * on a computer (`fine`) Zoom is the resting mode, so Pan toggles back to Zoom and Zoom stays; on a touch device it
 * toggles off to Scroll (`null`).
 */
export function nextMode(cur: ZoomMode, pressed: 'zoom' | 'pan', fine: boolean): ZoomMode {
  if (cur !== pressed) return pressed;
  return fine ? 'zoom' : null;
}

// ── Step, pan, pinch — scaled space; the hook normalizes every result ──────────────────────────────────────────

/** + halves the visible span, − doubles it, about the centre (log space on a log axis). */
export const ZOOM_STEP = 2;

/** The domain scaled about its centre by `factor` (< 1 zooms in), in scaled space. */
export function scaleDomain(d: Domain, factor: number, s: AxisScale): Domain {
  const a = fwd(d[0], s), b = fwd(d[1], s);
  const c = (a + b) / 2, half = ((b - a) / 2) * factor;
  return [inv(c - half, s), inv(c + half, s)];
}

export function stepPins(view: View, dir: 'in' | 'out', sc: Scales): Pins {
  const f = dir === 'in' ? 1 / ZOOM_STEP : ZOOM_STEP;
  return { x: scaleDomain(view.x, f, sc.x), y: scaleDomain(view.y, f, sc.y) };
}

function shift(d: Domain, du: number, s: AxisScale): Domain {
  const a = fwd(d[0], s), b = fwd(d[1], s), k = du * (b - a);
  return [inv(a + k, s), inv(b + k, s)];
}

/** Content follows the finger: a drag RIGHT shows EARLIER dates, a drag DOWN shows HIGHER prices. */
export function panPins(start: View, dxPx: number, dyPx: number, r: PlotRect, sc: Scales): Pins {
  return {
    x: shift(start.x, -dxPx / r.width, sc.x),
    y: shift(start.y, dyPx / r.height, sc.y),
  };
}

/** Fingers closer than this along an axis never scale that axis (a sideways pinch zooms the dates only). */
export const PINCH_AXIS_MIN_PX = 40;

/**
 * The view under a pinch that started at `from` over `start` and is now at `to`. Each axis scales by the change in
 * the fingers' separation ALONG it (only if they started at least PINCH_AXIS_MIN_PX apart on it), and the value under
 * the fingers' start centroid stays under their current centroid — so moving both fingers pans.
 */
export function pinchPins(start: View, from: readonly [Pt, Pt], to: readonly [Pt, Pt], r: PlotRect, sc: Scales): Pins {
  const axis = (d: Domain, s: AxisScale, sep0: number, sep1: number, u0: number, u1: number): Domain => {
    const k = sep0 >= PINCH_AXIS_MIN_PX && sep1 > 0 ? sep0 / sep1 : 1;
    const a = fwd(d[0], s), b = fwd(d[1], s);
    const v = a + u0 * (b - a);
    const span = (b - a) * k;
    const lo = v - u1 * span;
    return [inv(lo, s), inv(lo + span, s)];
  };
  const c0 = { x: (from[0].x + from[1].x) / 2, y: (from[0].y + from[1].y) / 2 };
  const c1 = { x: (to[0].x + to[1].x) / 2, y: (to[0].y + to[1].y) / 2 };
  return {
    x: axis(start.x, sc.x, Math.abs(from[0].x - from[1].x), Math.abs(to[0].x - to[1].x),
      (c0.x - r.left) / r.width, (c1.x - r.left) / r.width),
    y: axis(start.y, sc.y, Math.abs(from[0].y - from[1].y), Math.abs(to[0].y - to[1].y),
      1 - (c0.y - r.top) / r.height, 1 - (c1.y - r.top) / r.height),
  };
}

// ── Clamp to the data ───────────────────────────────────────────────────────────────────────────────────────────

function normAxis(pin: Domain | null, home: Domain, reach: Domain, s: AxisScale, minSpan: number): Domain | null {
  if (pin === null) return null;
  const h0 = fwd(home[0], s), h1 = fwd(home[1], s);
  const homeSpan = h1 - h0;
  if (!(homeSpan > 0)) return null;
  // The reach always contains home — the union, end by end (a NaN end reads as home's, so a junk reach is home).
  const q0 = fwd(reach[0], s), q1 = fwd(reach[1], s);
  const r0 = q0 < h0 ? q0 : h0, r1 = q1 > h1 ? q1 : h1;
  const reachSpan = r1 - r0;
  let a = fwd(pin[0], s), b = fwd(pin[1], s);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a > b) [a, b] = [b, a];
  const c = (a + b) / 2;
  // Raise to the minimum about the centre FIRST, then cap: a span at (or above) the reach's IS the reach — auto when the
  // reach is home. The cap is checked after the raise, so data shorter than the minimum gives auto — never a pin wider
  // than the data (Z3a). With the reach equal to home this line is today's "a span at the full span is auto", and
  // everything below it is today's arithmetic, so a chart with no reach is byte-identical (chartZoom test ⭐26).
  const span = Math.max(b - a, minSpan);
  if (span >= reachSpan * (1 - FULL_EPS)) return r0 === h0 && r1 === h1 ? null : [inv(r0, s), inv(r1, s)];
  a = c - span / 2;
  b = c + span / 2;
  // Shift, never clip — the pin keeps its zoom level.
  if (a < r0) { b += r0 - a; a = r0; }
  if (b > r1) { a -= b - r1; b = r1; }
  // A pin back at home — home's span, at home's place — is auto: the view Reset gives, and `zoomed` reads false again.
  if (span >= homeSpan * (1 - FULL_EPS) && Math.abs(a - h0) <= FULL_EPS * homeSpan
    && Math.abs(b - h1) <= FULL_EPS * homeSpan) return null;
  return [inv(a, s), inv(b, s)];
}

/**
 * Pins clamped into the reach: each pinned span is raised to the minimum and capped to the reach's span (a pin that now
 * spans the whole reach is the reach — auto when the reach is home — and data shorter than the minimum is auto), then
 * SHIFTED back inside the reach. A pin back at home is auto. `full` is HOME: the chart's own fitted extent, the opening
 * view and where Reset returns. `reach` is how far zoom-out and pan may go: it always contains home (each axis is the
 * union), and it defaults to home — today's clamp, bit for bit.
 */
export function normalizePins(p: Pins, full: View, sc: Scales, min: MinSpan, reach: View = full): Pins {
  return {
    x: normAxis(p.x, full.x, reach.x, sc.x, min.x),
    y: normAxis(p.y, full.y, reach.y, sc.y, min.y),
  };
}

export function effectiveView(p: Pins, full: View): View {
  return { x: p.x ?? full.x, y: p.y ?? full.y };
}

export function isZoomed(p: Pins): boolean {
  return p.x !== null || p.y !== null;
}

/**
 * True when the view leaves home on either axis — a zoom out past it, or a pan past its edge into the reach. Then a
 * double-tap zooms back IN, so the note says "reset", never "zoom back out".
 */
export function leavesHome(view: View, home: View, sc: Scales): boolean {
  const out = (d: Domain, h: Domain, s: AxisScale): boolean => {
    const h0 = fwd(h[0], s), h1 = fwd(h[1], s), tol = FULL_EPS * (h1 - h0);
    return fwd(d[0], s) < h0 - tol || fwd(d[1], s) > h1 + tol;
  };
  return out(view.x, home.x, sc.x) || out(view.y, home.y, sc.y);
}

// ── The date axis ───────────────────────────────────────────────────────────────────────────────────────────────

const YEAR_MS = 365.25 * DAY_MS;
/** Steps in years, finest first. The year rungs are `yearTicks`' own (2 / 4 / 8); 8 years is also the fallback. */
const TIME_STEPS: { years: number; months: number }[] = [
  { years: 1 / 12, months: 1 }, { years: 1 / 4, months: 3 }, { years: 1 / 2, months: 6 },
  { years: 1, months: 12 }, { years: 2, months: 24 }, { years: 4, months: 48 }, { years: 8, months: 96 },
];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export type TimeUnit = 'year' | 'month';

/**
 * Date ticks: the finest step in 1 mo · 3 mo · 6 mo · 1 y · 2 y · 4 y · 8 y with `span / step ≤ density` (8 y when
 * none fits). Years land on 1 January of years divisible by the step; months on UTC month starts (quarters at
 * Jan/Apr/Jul/Oct, halves at Jan/Jul). At density 6 this IS the old `yearTicks` for every span over 6 years. Junk ⇒
 * none.
 */
export function timeTicks(d: Domain, density: number): { ticks: number[]; unit: TimeUnit } {
  const [lo, hi] = d;
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return { ticks: [], unit: 'year' };
  const spanY = (hi - lo) / YEAR_MS;
  const step = TIME_STEPS.find((st) => spanY / st.years <= density) ?? TIME_STEPS[TIME_STEPS.length - 1];
  const out: number[] = [];
  if (step.months >= 12) {
    const stepY = step.months / 12;
    const first = new Date(lo).getUTCFullYear();
    for (let y = Math.ceil(first / stepY) * stepY; ; y += stepY) {
      const t = Date.UTC(y, 0, 1);
      if (t > hi) break;
      if (t >= lo) out.push(t);
    }
    return { ticks: out, unit: 'year' };
  }
  const d0 = new Date(lo);
  // An absolute month index; aligning it to a multiple of the step aligns the month (12 is a multiple of every step).
  for (let k = Math.ceil((d0.getUTCFullYear() * 12 + d0.getUTCMonth()) / step.months) * step.months; ; k += step.months) {
    const t = Date.UTC(Math.floor(k / 12), k % 12, 1);
    if (t > hi) break;
    if (t >= lo) out.push(t);
  }
  return { ticks: out, unit: 'month' };
}

/** The density `timeTicks` gets: at least 6, one more per 100 px of plot. 6 on a phone, about 8 on a desktop. */
export function tickDensity(plotWidthPx: number): number {
  return Number.isFinite(plotWidthPx) ? Math.max(6, Math.floor(plotWidthPx / 100)) : 6;
}

/**
 * A date tick's label, in UTC from a fixed month table (never ICU, which prints "Sept"). Years read "2026"; months
 * read "Apr", January reads its year, and the first visible tick carries its year ("Apr 2027").
 */
export function fmtTimeTick(t: number, unit: TimeUnit, index: number): string {
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth();
  if (unit === 'year' || m === 0) return String(y);
  return index === 0 ? `${MONTHS[m]} ${y}` : MONTHS[m];
}

// ── The price axis — d3's log ticks, ported ─────────────────────────────────────────────────────────────────────
// A faithful port of d3-scale 4.0.2 `log.ticks` (base 10, positive domain) over d3-array 3.2.4 `ticks` — the exact
// algorithm recharts runs today through `scale.ticks(5)` — so the unzoomed axis is unchanged. Test 15 compares it,
// bit for bit, with recharts' own vendored d3. d3 is ISC-licensed (Copyright Mike Bostock).

const E10 = Math.sqrt(50), E5 = Math.sqrt(10), E2 = Math.sqrt(2);

function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const step = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(step));
  const error = step / Math.pow(10, power);
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  let i1: number, i2: number, inc: number;
  if (power < 0) {
    inc = Math.pow(10, -power) / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = Math.pow(10, power) * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && 0.5 <= count && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

/** d3-array 3.2.4 `ticks`, for an ascending (start ≤ stop) interval. */
function linearTicks(start: number, stop: number, count: number): number[] {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const [i1, i2, inc] = tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1;
  const out = new Array<number>(n);
  if (inc < 0) for (let i = 0; i < n; ++i) out[i] = (i1 + i) / -inc;
  else for (let i = 0; i < n; ++i) out[i] = (i1 + i) * inc;
  return out;
}

/** d3-scale's precise base-10 power (a string round-trip, so 1e-2 is exactly 0.01). */
const pow10 = (x: number): number => (Number.isFinite(x) ? +('1e' + x) : x < 0 ? 0 : x);

/** Log-axis ticks for a positive domain — d3-scale 4.0.2 `log.ticks(count)`, base 10. */
export function logTicks(d: Domain, count = 5): number[] {
  let u = d[0], v = d[1];
  if (!(u > 0) || !(v > 0) || !Number.isFinite(u) || !Number.isFinite(v)) return [];
  const r = v < u;
  if (r) [u, v] = [v, u];
  let i = Math.log10(u);
  let j = Math.log10(v);
  const n = count;
  let z: number[] = [];
  if (j - i < n) {
    i = Math.floor(i);
    j = Math.ceil(j);
    for (; i <= j; ++i) {
      for (let k = 1; k < 10; ++k) {
        const t = i < 0 ? k / pow10(-i) : k * pow10(i);
        if (t < u) continue;
        if (t > v) break;
        z.push(t);
      }
    }
    if (z.length * 2 < n) z = linearTicks(u, v, n);
  } else {
    z = linearTicks(i, j, Math.min(j - i, n)).map(pow10);
  }
  return r ? z.reverse() : z;
}

/** A label reads as zero when it has no digit 1–9 ("$0.00", "$0", "$0k"). */
const readsZero = (label: string): boolean => !/[1-9]/.test(label);

/**
 * The price axis's labels. The chart's own formatter (`base`) wherever its labels are distinct AND no positive tick
 * reads as zero — so the unzoomed labels stay byte-identical. Otherwise a precise form: the same $ / k / M units with
 * the fewest decimals (0–8) that make every label distinct and every positive label non-zero ("$63k" twice for 62.5k
 * and 63k becomes "$62.5k" / "$63.0k"; "$0.00" for $0.004 becomes "$0.004" — the house rule: never "$0" for
 * something that isn't zero, Z3b).
 */
export function priceTickFormatter(ticks: readonly number[], base: (v: number) => string): (v: number) => string {
  const ok = (labels: string[]): boolean =>
    new Set(labels).size === labels.length && ticks.every((v, i) => !(v > 0) || !readsZero(labels[i]));
  if (ok(ticks.map(base))) return base;
  const precise = (dp: number) => (v: number): string => {
    const a = Math.abs(v);
    if (a >= 1_000_000) return `$${(v / 1_000_000).toFixed(dp)}M`;
    if (a >= 1_000) return `$${(v / 1_000).toFixed(dp)}k`;
    return `$${v.toFixed(dp)}`;
  };
  for (let dp = 0; dp <= 8; dp++) {
    const f = precise(dp);
    if (ok(ticks.map(f))) return f;
  }
  return precise(8);
}

// ── Taps and the note ───────────────────────────────────────────────────────────────────────────────────────────

export interface Tap { t: number; x: number; y: number }
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;

/** Two taps within DOUBLE_TAP_MS and DOUBLE_TAP_PX of each other. */
export function isDoubleTap(prev: Tap | null, next: Tap): boolean {
  if (prev === null) return false;
  return next.t - prev.t <= DOUBLE_TAP_MS && Math.hypot(next.x - prev.x, next.y - prev.y) <= DOUBLE_TAP_PX;
}

/**
 * The once-per-session note, worded for the input that zoomed. `outward` — the view left home (a zoom out or a pan past
 * it, `leavesHome`): a double-tap then zooms back IN, so the note says "reset the view".
 */
export function zoomBackNote(pointerType: string, outward = false): string {
  const verb = pointerType === 'mouse' ? 'Double-click' : 'Double-tap';
  return outward ? `${verb} to reset the view` : `${verb} to zoom back out`;
}
