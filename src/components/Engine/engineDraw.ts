import type { SafetyLevel } from '../../simulation/safetyView';
import { ENGINE_FONT as FONT, MAT, al, bk, tri, wh } from './enginePalette';
import {
  RING_IDS, TAPE_MS, bayOf, cylLabelX, priceScale, rotorDims, tagHeights, type Bay, type EngineScene, type MotorLamp, type Rect,
  type TapePoint,
} from './engineScene';
import { liqFooter, liqShift, tapeHoverText, tapePriceText, tapeTitle, tickDelta, type EnginePart } from './engineView';

/**
 * The Engine · Micro (BL61, step 1) — the drawing. A port of the owner's prototypes' canvas, function by function:
 * `personal-bloc-engine-prototype-v2.html`'s Micro view, which draws with `family-fire-engine-v3.html`'s machine — the glass
 * tubes and their charge of particles, the embers and sparks, the steel flywheel with its teeth, the worm gear and the
 * price motor, the gauge, the live tape and its wire, the pipes and their flanges, the tags. Their motion too: the piston
 * eases to a new price and idles while the price is live, the needle springs, the scale follows, each live price sparks
 * down the wire into the chamber and kicks the motor.
 *
 * What it draws, it takes from the scene (`engineScene`): every figure, word, place and level. What it keeps is only
 * motion — `EngineMotion`, one per canvas, never saved. Colours: the app's tokens (`Tones`) and the machine's own paint
 * (`enginePalette`); none is written here.
 *
 * Left out of the prototypes, on purpose: their five colour zones (the Dashboard's three levels colour the engine,
 * BL61), the valve marks on the gauge and the kids' line (the family's plan, step 3), Strike's margin-call line (the app
 * prices no such line), the red line's drag and its probe (its sums are new money math), and the desk's machine.
 */

/** The app's theme colours, read from its tokens (`EngineCanvas`'s `readTones`). */
export interface Tones {
  green: string; amber: string; red: string; btc: string; text: string; text2: string; accent: string;
  coinbase: string; strike: string;
}

interface Particle { x: number; y: number; vx: number; vy: number; s: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number; k: number; col: string; r: number }
interface Ember { x: number; y: number; vy: number; ph: number; life: number; k: number; r: number }
interface Layer { cv: HTMLCanvasElement; key: string }

/** Everything that moves between scenes, one per canvas (the prototypes' `E.v`, `FX` and their kin). Never saved. */
export interface EngineMotion {
  init: boolean;
  /** The piston's price; the coins in each tube; the needle and its speed; the red line; the scale (in logs). */
  P: number; cb: number; s: number; gauge: number; gaugeV: number; rl: number; lo: number; hi: number;
  /** The live tape's scale (in dollars) and its span (ms). */
  llo: number; lhi: number; lspan: number; lseen: boolean;
  clock: number; last: number; dtLast: number;
  spin: number; spinV: number; mot: number; pk: number; rp: number;
  burst: number; burstDir: number; kick: number; flash2: number; pulse: number;
  newTick: { dir: number; size: number; by: number } | null;
  deltas: { t: string; up: boolean; life: number }[];
  wire: { u: number; dir: number }[];
  sparks: Spark[];
  embers: { cb: Ember[]; s: Ember[] };
  parts: { cb: Particle[]; s: Particle[] };
  liqDelta: { by: number; life: number } | null;
  /** The live prices this canvas has seen, oldest first: the motor's pace and the tape's newest stretch. */
  ticks: TapePoint[];
  seenLive: number;
  seenPrice: number;
  seenPos: string;
  seenLiq: number;
  layers: Map<string, Layer>;
  sprites: Map<string, HTMLCanvasElement>;
  /** Where the two tags were drawn this frame (their rings follow them). */
  tagRects: { price: Rect | null; redtag: Rect | null };
  /** A mouse's place and the region under it (no finger hovers). */
  ptr: { x: number; y: number } | null;
  hover: string | null;
  /** The piston is held: the price follows the hand at once, and the scale holds still. */
  held: boolean;
  /** The piston has been dragged: the "drag" hint has done its job. */
  hinted: boolean;
}

export function newMotion(): EngineMotion {
  return {
    init: false, P: 0, cb: 0, s: 0, gauge: 0, gaugeV: 0, rl: 0, lo: 0, hi: 0, llo: 0, lhi: 0, lspan: 0, lseen: false,
    clock: 0, last: 0, dtLast: 0, spin: 0, spinV: 0, mot: 0, pk: 0, rp: 0, burst: 0, burstDir: 0, kick: 0, flash2: 0, pulse: 0,
    newTick: null, deltas: [], wire: [], sparks: [], embers: { cb: [], s: [] }, parts: { cb: [], s: [] }, liqDelta: null,
    ticks: [], seenLive: 0, seenPrice: 0, seenPos: '', seenLiq: 0, layers: new Map(), sprites: new Map(),
    tagRects: { price: null, redtag: null }, ptr: null, hover: null, held: false, hinted: false,
  };
}

const TAU = 6.283;
const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

const levelTone = (t: Tones, l: SafetyLevel): string => (l === 'safe' ? t.green : l === 'watch' ? t.amber : t.red);
const lampTone = (t: Tones, l: MotorLamp): string => (l === 'live' ? t.green : l === 'tried' ? t.accent : l === 'held' ? t.amber : MAT.muted);

/** Where the gauge's needle points on its dial, 0 to 1: its spring's place and, while the picture moves, a tremble past
 *  60% — read off where the needle rests (`needleOf`), never the level itself, so an infinite level (a debt with no coins
 *  behind it) or a price tried far under the line trembles as at 100%, at the dial's end (v1.5). */
export function needleAt(gf: EngineScene['gaugeFig'], gauge: number, clock: number, reduce: boolean): number {
  const jit = gf.needle > 0.6 && !reduce ? Math.sin(clock * 31) * (gf.needle - 0.6) * 0.012 : 0;
  return gauge + jit;
}

/** The gauge's figure in the Dashboard's bar colour: its level's whenever the loan is on, as SafetyDashboard's
 *  `LEVEL_COLOR[cbLevel]` — a debt with no coins behind it is Poor there, so its "∞" is red here (v1.5); grey with none. */
export function gaugeTone(t: Tones, gf: EngineScene['gaugeFig']): string {
  return !gf.loan ? MAT.muted : levelTone(t, gf.level);
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const q = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + q, y);
  ctx.arcTo(x + w, y, x + w, y + h, q);
  ctx.arcTo(x + w, y + h, x, y + h, q);
  ctx.arcTo(x, y + h, x, y, q);
  ctx.arcTo(x, y, x + w, y, q);
  ctx.closePath();
}

/** Brushed steel across a span. */
function metal(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  g.addColorStop(0, MAT.metal[0]); g.addColorStop(0.5, MAT.metal[1]); g.addColorStop(1, MAT.metal[2]);
  return g;
}

/** A round glow, drawn once per colour and kept. */
function glowSprite(m: EngineMotion, col: string): HTMLCanvasElement {
  const have = m.sprites.get(col);
  if (have !== undefined) return have;
  const c = document.createElement('canvas');
  c.width = 48; c.height = 48;
  const g = c.getContext('2d');
  if (g !== null) {
    const gr = g.createRadialGradient(24, 24, 0, 24, 24, 24);
    gr.addColorStop(0, al(col, 1)); gr.addColorStop(0.2, al(col, 0.95)); gr.addColorStop(0.42, al(col, 0.3)); gr.addColorStop(1, al(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 48, 48);
  }
  m.sprites.set(col, c);
  return c;
}

/** A part that is heavy to draw and hardly moves, drawn once into its own canvas and kept until its key changes. */
function cachedLayer(ctx: CanvasRenderingContext2D, m: EngineMotion, dpr: number, name: string, key: string,
  x: number, y: number, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void): void {
  const px0 = Math.floor(x * dpr);
  const py0 = Math.floor(y * dpr);
  const pw = Math.ceil(w * dpr) + 2;
  const ph = Math.ceil(h * dpr) + 2;
  let c = m.layers.get(name);
  if (c === undefined) { c = { cv: document.createElement('canvas'), key: '' }; m.layers.set(name, c); }
  if (c.key !== key || c.cv.width !== pw || c.cv.height !== ph) {
    c.cv.width = pw; c.cv.height = ph;                                  // sizing a canvas also clears it
    const g = c.cv.getContext('2d');
    if (g === null) return;
    g.setTransform(dpr, 0, 0, dpr, -px0, -py0); g.textBaseline = 'alphabetic'; g.lineJoin = 'round';
    draw(g);
    c.key = key;
  }
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(c.cv, px0, py0); ctx.restore();
}

/** A pipe: its shadow, its body, its lit top and a fine highlight. */
function pipe3d(ctx: CanvasRenderingContext2D, points: [number, number][]): void {
  const path = (dx: number, dy: number): void => {
    ctx.beginPath();
    points.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0] + dx, p[1] + dy) : ctx.lineTo(p[0] + dx, p[1] + dy)));
  };
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.setLineDash([]);
  ctx.strokeStyle = bk(0.42); ctx.lineWidth = 8; path(0.5, 2.5); ctx.stroke();
  ctx.strokeStyle = MAT.pipe[0]; ctx.lineWidth = 7; path(0, 0); ctx.stroke();
  ctx.strokeStyle = MAT.pipe[1]; ctx.lineWidth = 3.4; path(-0.9, -0.9); ctx.stroke();
  ctx.strokeStyle = wh(0.17); ctx.lineWidth = 1; path(-1.8, -1.8); ctx.stroke();
  ctx.lineCap = 'butt';
}

function sparkBurst(m: EngineMotion, reduce: boolean, x: number, y: number, n: number, col: string, speed: number, ang: number, spread: number): void {
  if (reduce) return;
  for (let i = 0; i < n && m.sparks.length < 460; i++) {
    const a = ang + (Math.random() - 0.5) * spread;
    const sp = speed * (0.3 + Math.random());
    m.sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, k: 1.3 + Math.random() * 2, col, r: 0.7 + Math.random() * 1.1 });
  }
}

function drawSparks(ctx: CanvasRenderingContext2D, m: EngineMotion, dt: number): void {
  const a = m.sparks;
  if (a.length === 0) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (let i = a.length - 1; i >= 0; i--) {
    const s = a[i];
    s.life -= dt * s.k;
    if (s.life <= 0) { a.splice(i, 1); continue; }
    s.vy += 90 * dt; s.vx *= 1 - dt * 0.8;
    const ox = s.x; const oy = s.y;
    s.x += s.vx * dt; s.y += s.vy * dt;
    ctx.strokeStyle = al(s.col, Math.min(1, s.life * 1.4)); ctx.lineWidth = s.r * (0.6 + s.life);
    ctx.beginPath(); ctx.moveTo(ox - s.vx * 0.02, oy - s.vy * 0.02); ctx.lineTo(s.x, s.y); ctx.stroke();
  }
  ctx.restore();
}

/** Embers rise off a hot floor, more and faster the harder the charge is squeezed. */
function drawEmbers(ctx: CanvasRenderingContext2D, m: EngineMotion, reduce: boolean, arr: Ember[], dt: number,
  x: number, w: number, yP: number, yF: number, col: string, heat: number): void {
  if (reduce) { arr.length = 0; return; }
  const hc = yF - yP;
  let want = hc > 12 ? (1.5 + 30 * heat * heat) * dt : 0;
  while (want > 0) {
    if (Math.random() < want && arr.length < 90) {
      arr.push({ x: x + 3 + Math.random() * Math.max(1, w - 6), y: yF - 1, vy: -(14 + 60 * heat) * (0.5 + Math.random()), ph: Math.random() * TAU, life: 1, k: 0.5 + Math.random() * 0.9, r: 0.8 + Math.random() * 1.3 });
    }
    want -= 1;
  }
  const espr = glowSprite(m, col);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (let i = arr.length - 1; i >= 0; i--) {
    const e = arr[i];
    e.life -= dt * e.k; e.y += e.vy * dt; e.ph += dt * 5; e.x += Math.sin(e.ph) * 10 * dt;
    if (e.life <= 0 || e.y < yP + 2) { arr.splice(i, 1); continue; }
    const es = e.r * 6.4;
    ctx.globalAlpha = Math.min(1, e.life * 1.6); ctx.drawImage(espr, e.x - es / 2, e.y - es / 2, es, es);
    ctx.fillStyle = MAT.emberCore; ctx.fillRect(e.x - e.r * 0.5, e.y - e.r * 0.5, e.r, e.r);
  }
  ctx.restore();
}

/** The charge's particles: as many as the debt is worth, joining from the floor's far corner once the engine runs.
 *  Under reduced motion nothing would carry them from that corner, so there they are all placed at once, spread out. */
function syncParticles(arr: Particle[], target: number, init: boolean, reduce: boolean): void {
  const n = Math.max(0, Math.min(520, Math.round(target)));
  const diff = n - arr.length;
  const stepN = reduce ? Math.abs(diff) : Math.max(1, Math.ceil(Math.abs(diff) * 0.2));
  const pour = init && !reduce;
  if (diff > 0) {
    for (let i = 0; i < Math.min(stepN, diff); i++) {
      arr.push({ x: pour ? 0.86 + Math.random() * 0.14 : Math.random(), y: Math.random() * (pour ? 0.2 : 1), vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.5) * 2, s: 0.55 + Math.random() * 0.9 });
    }
  } else if (diff < 0) arr.splice(0, Math.min(stepN, -diff));
}

function stepParticles(arr: Particle[], dt: number, wPx: number, hPx: number, speed: number, reduce: boolean): void {
  if (reduce) return;
  const w = Math.max(24, wPx);
  const h = Math.max(10, hPx);
  for (const p of arr) {
    p.x += p.vx * p.s * speed * dt / w; p.y += p.vy * p.s * speed * dt / h;
    if (p.x < 0) { p.x = -p.x; p.vx = Math.abs(p.vx); } else if (p.x > 1) { p.x = 2 - p.x; p.vx = -Math.abs(p.vx); }
    if (p.y < 0) { p.y = -p.y; p.vy = Math.abs(p.vy); } else if (p.y > 1) { p.y = 2 - p.y; p.vy = -Math.abs(p.vy); }
    p.x = clamp(p.x, 0, 1); p.y = clamp(p.y, 0, 1);
  }
}

/** Three to five round dollar levels between lo and hi. */
function linTicks(lo: number, hi: number): number[] {
  const span = hi - lo;
  const raw = span / 4;
  if (!(raw > 0)) return [];
  const mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
  const f = raw / mag;
  const step = (f < 1.5 ? 1 : f < 2.25 ? 2 : f < 3.5 ? 2.5 : f < 7.5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil((lo + span * 0.06) / step) * step; v <= hi - span * 0.06; v += step) out.push(v);
  return out;
}
const hhmm = (ms: number): string => { const t = new Date(ms); return `${t.getHours()}:${String(t.getMinutes()).padStart(2, '0')}`; };

interface Geo extends Bay { yP: number; beamY: number; yF: number; floorIn: boolean; wheel: { x: number; y: number; r: number; ro: number } | null }

/** What a frame needs beyond the scene. */
export interface FrameOpts { ts: number; now: number; dpr: number; reduce: boolean; openPart: EnginePart | null }

/** The live ticks and the loans' moves since the last frame: what the engine answers to. */
function hear(s: EngineScene, m: EngineMotion): void {
  const lv = s.tapePrices.live;
  if (lv !== null && lv.t !== m.seenLive) {
    m.seenLive = lv.t;
    const a = m.ticks;
    const last = a.length > 0 ? a[a.length - 1] : null;
    if (last !== null && lv.t - last.t < 900) last.p = lv.p;
    else if (last === null || lv.t > last.t) {
      if (last !== null && lv.p !== last.p) { m.burstDir = lv.p > last.p ? 1 : -1; m.newTick = { dir: m.burstDir, size: Math.abs(lv.p / last.p - 1), by: lv.p - last.p }; }
      a.push({ t: lv.t, p: lv.p });
      if (a.length === 1) m.newTick = { dir: 1, size: 0.0022, by: 0 };   // the first live price: the engine catches and revs up
      if (a.length > 4000) a.splice(0, a.length - 3600);
    }
  }
  if (m.seenPrice > 0 && m.seenPrice !== s.realPrice) m.pulse = 1;   // a fresh price just arrived
  m.seenPrice = s.realPrice;
  const pos = [s.cb.coins, Math.round(s.cb.debt), s.sk.coins, Math.round(s.sk.debt)].join('|');
  const liqNow = s.cb.owes ? s.cb.liq : 0;
  if (m.init && pos !== m.seenPos) {                                     // the loans moved: the engine answers
    m.kick = 1;
    if (m.seenLiq > 0 && liqNow > 0 && Math.abs(liqNow - m.seenLiq) >= 1) m.liqDelta = { by: liqNow - m.seenLiq, life: 1 };
  }
  m.seenPos = pos; m.seenLiq = liqNow;
}

function ticksLastMinute(m: EngineMotion, now: number): number {
  let n = 0;
  for (let i = m.ticks.length - 1; i >= 0 && m.ticks[i].t >= now - 60e3; i--) n++;
  return n;
}

/** THE frame: everything moved by `dt`, then drawn. Returns the piston's height (its handle rides it). */
export function drawFrame(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, o: FrameOpts): number {
  const { reduce, dpr, now } = o;
  const dt = m.last > 0 ? clamp((o.ts - m.last) / 1000, 0, 0.05) : 0;
  m.last = o.ts; m.clock += dt; m.dtLast = dt;
  hear(s, m);
  const snap = reduce || !m.init;
  const k = snap ? 1 : 1 - Math.exp(-dt * 9);
  m.P = m.held || snap || !(m.P > 0) ? s.price : Math.exp(Math.log(m.P) + (Math.log(s.price) - Math.log(m.P)) * k);
  m.cb += (s.cb.coins - m.cb) * k; m.s += (s.sk.coins - m.s) * k;
  if (snap) { m.gauge = s.gaugeFig.needle; m.gaugeV = 0; } else {
    m.gaugeV += ((s.gaugeFig.needle - m.gauge) * 130 - m.gaugeV * 15) * dt;   // the needle is on a spring: it overshoots a touch, then settles
    m.gauge += m.gaugeV * dt;
  }
  m.rl = snap || !(s.cb.liq > 0) || !(m.rl > 0) ? s.cb.liq : Math.exp(Math.log(m.rl) + (Math.log(s.cb.liq) - Math.log(m.rl)) * k);

  // the price range in view: the piston's price, and the liquidation line whenever it is near enough to matter
  const rl = s.cb.owes ? (m.rl || s.cb.liq) : 0;
  const want = priceScale(m.P, rl, s.price);
  const tl = Math.log(want.lo);
  const th = Math.log(want.hi);
  if (snap || !m.lo) { m.lo = tl; m.hi = th; } else if (!m.held) {
    const kr = 1 - Math.exp(-dt * 5);
    m.lo += (tl - m.lo) * kr; m.hi += (th - m.hi) * kr;
  }
  const Y = (p: number): number => s.bot - (Math.log(Math.max(p, 1e-9)) - m.lo) / (m.hi - m.lo) * (s.bot - s.top);

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, s.W, s.H);
  ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';

  // what just happened: a live price landed. The price motor runs on live prices and nothing else.
  const motOn = s.motorOn;
  if (m.newTick !== null) {
    const nt = m.newTick;
    m.newTick = null;
    if (!reduce) {
      if (motOn) m.spinV = Math.min(16, m.spinV + clamp(nt.size * 3200, 1.2, 8));
      for (let wi = 0; wi < 3; wi++) m.wire.push({ u: -wi * 0.13, dir: nt.dir });
      if (Math.abs(nt.by) >= 1 && m.deltas.length < 4) m.deltas.push({ t: tickDelta(nt.by), up: nt.by > 0, life: 1 });
    }
  }
  if (!reduce) {                                                         // live: it turns over steadily and kicks with each price; else it runs down and stops
    m.spinV += ((motOn ? 1.9 + Math.min(1.5, ticksLastMinute(m, now) / 45) : 0) - m.spinV) * (1 - Math.exp(-dt * (motOn ? 0.9 : 1.8)));
    if (m.spinV < 0.02 && !motOn) m.spinV = 0;
    m.spin += m.spinV * dt;
  }
  if (m.mot > 0) m.mot *= Math.exp(-dt * 3.2);
  if (m.pk > 0) m.pk *= Math.exp(-dt * 10);
  if (m.rp > 0) { m.rp += dt / 0.26; if (m.rp >= 1) m.rp = 0; }      // the push that runs up the motor's rod when the chamber fires

  const tape = drawLiveTape(ctx, s, m, t, now, dt, snap, reduce);
  const geo = drawCylinders(ctx, s, m, t, Y, dt, reduce);
  m.burst = 0; m.kick = 0;

  // the wire: the tape's pen feeds the piston
  const pyy = geo.yP;
  const { penX, penY } = tape;
  const endX = geo.cX - 2;
  const penCol = tape.col;
  const c1x = penX + (endX - penX) * 0.55;
  ctx.strokeStyle = al(penCol, 0.85); ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(penX, penY); ctx.bezierCurveTo(c1x, penY, c1x, pyy, endX, pyy); ctx.stroke();
  ctx.fillStyle = al(penCol, 0.22); ctx.beginPath(); ctx.arc(penX, penY, 7.5, 0, TAU); ctx.fill();
  ctx.fillStyle = penCol; ctx.beginPath(); ctx.arc(penX, penY, 3.4, 0, TAU); ctx.fill();
  if (m.pulse > 0.02) { ctx.strokeStyle = al(penCol, m.pulse * 0.7); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(penX, penY, 3 + (1 - m.pulse) * 16, 0, TAU); ctx.stroke(); }
  else if (!tape.stale && !reduce) {
    const br = 0.5 + 0.5 * Math.sin(m.clock * 3);
    ctx.strokeStyle = al(penCol, 0.35 * (1 - br)); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(penX, penY, 4 + br * 9, 0, TAU); ctx.stroke();
  }
  // how much the last price moved, floating off the pen
  ctx.font = `600 11.5px ${FONT}`; ctx.textAlign = 'right';
  for (let i = m.deltas.length - 1; i >= 0; i--) {
    const dl = m.deltas[i];
    dl.life -= dt * 0.85;
    if (dl.life <= 0) { m.deltas.splice(i, 1); continue; }
    ctx.fillStyle = al(dl.up ? t.green : t.red, Math.min(1, dl.life * 1.6)); ctx.fillText(dl.t, penX - 9, penY - 9 - (1 - dl.life) * 24);
  }
  // each price sends sparks down the wire and into the chamber
  for (let i = m.wire.length - 1; i >= 0; i--) {
    const ws = m.wire[i];
    ws.u += dt * 2.6;
    if (ws.u >= 1) { m.wire.splice(i, 1); m.burst = 1; if (motOn) { m.mot = 1; m.pk = 1; m.rp = 0.001; } continue; }
    if (ws.u < 0) continue;
    const uu = ws.u; const iu = 1 - uu;
    const wxp = iu * iu * iu * penX + 3 * iu * uu * c1x + uu * uu * uu * endX;
    const wyp = iu * iu * (iu + 3 * uu) * penY + uu * uu * (3 * iu + uu) * pyy;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.drawImage(glowSprite(m, ws.dir < 0 ? MAT.sparkDown : MAT.sparkUp), wxp - 8, wyp - 8, 16, 16);
    ctx.restore();
  }
  drawWheel(ctx, s, m, t, geo, dpr);
  drawMotor(ctx, s, m, t, geo, reduce);
  drawBanner(ctx, s, t, geo);
  drawGauge(ctx, s, m, t, geo, reduce);
  drawFlows(ctx, s, m, t, geo, reduce);
  drawCylLabels(ctx, s, t, geo);
  drawTags(ctx, s, m, t, geo, reduce);
  drawRings(ctx, s, m, t, o.openPart);
  drawSparks(ctx, m, dt);
  if (m.flash2 > 0) m.flash2 *= Math.exp(-dt * 7);
  m.pulse *= Math.exp(-dt * 2.6);
  m.init = true;
  return geo.yP;
}

/** The live tape: the last half hour, price by price, sliding left as time passes, in its own scale. */
function drawLiveTape(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, now: number, dt: number,
  snap: boolean, reduce: boolean): { penX: number; penY: number; col: string; stale: boolean } {
  const T = s.tape;
  const x0 = T.x;
  const x1 = T.x + T.w - (T.w > 300 ? 46 : 26);
  const TW = x1 - x0;
  // the points: the minute closes up to the first live price this canvas heard, then every live price
  const t0w = now - TAPE_MS - 90e3;
  const firstT = m.ticks.length > 0 ? m.ticks[0].t : Infinity;
  const pts: TapePoint[] = [];
  for (const q of s.tapePrices.closes) if (q.t >= t0w && q.t < firstT - 20e3) pts.push(q);
  for (const q of m.ticks) if (q.t >= t0w) pts.push(q);
  const n = pts.length;
  const stale = s.feed !== 'live';
  // the chart spans what it has: 20 seconds at first, half an hour once it has heard that much
  const wantSpan = clamp((now - (n > 0 ? pts[0].t : now)) * 1.06, 20e3, TAPE_MS);
  if (!m.lseen || reduce) m.lspan = wantSpan; else m.lspan += (wantSpan - m.lspan) * 0.08;
  const span = m.lspan || wantSpan;
  const t0 = now - span;
  let lmin = s.realPrice;
  let lmax = s.realPrice;
  for (const q of pts) { if (q.p < lmin) lmin = q.p; if (q.p > lmax) lmax = q.p; }
  const lmid = (lmin + lmax) / 2;
  const lhalf = Math.max((lmax - lmin) / 2 * 1.3, lmid * 0.0012);
  if (snap || !m.llo) { m.llo = lmid - lhalf; m.lhi = lmid + lhalf; } else {
    const kl = 1 - Math.exp(-dt * 4);
    m.llo += (lmid - lhalf - m.llo) * kl; m.lhi += (lmid + lhalf - m.lhi) * kl;
  }
  m.lseen = true;
  const lo = m.llo;
  const hi = m.lhi;
  const tx = (ms: number): number => x0 + (ms - t0) / span * TW;
  const Yt = (p: number): number => T.y + T.h - 50 - (p - lo) / (hi - lo) * (T.h - 82);

  ctx.fillStyle = wh(0.018); rr(ctx, x0, T.y, TW, T.h, 12); ctx.fill();
  ctx.save(); rr(ctx, x0, T.y, TW, T.h, 12); ctx.clip();
  // price levels
  ctx.font = `500 11px ${FONT}`; ctx.textAlign = 'left';
  const lt = linTicks(lo, hi);
  lt.forEach((v, ix) => {
    const y = Yt(v);
    ctx.strokeStyle = wh(0.05); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
    if (TW >= 260 && (ix === 0 || ix === lt.length - 1)) { ctx.fillStyle = MAT.faint; ctx.fillText(tapePriceText(v), x0 + 8, y - 4); }
  });
  // minutes along the bottom; on a narrow chart two times would run together, so the second waits
  const mins = span / 60e3;
  const per = TW > 420 ? 6 : 3;
  const secs = span <= 150e3;
  const stepMs = secs ? (span <= 45e3 ? 10e3 : span <= 90e3 ? 20e3 : 30e3) * (TW > 420 ? 1 : 2)
    : (mins / per <= 1 ? 1 : mins / per <= 2 ? 2 : mins / per <= 5 ? 5 : 10) * 60e3;
  ctx.textAlign = 'center'; ctx.fillStyle = MAT.faint;
  let lastLab = -1e9;
  for (let tm = Math.ceil(t0 / stepMs) * stepMs; tm < now - stepMs * 0.2; tm += stepMs) {
    const gx = tx(tm);
    if (gx < x0 + 22 || gx > x1 - 30) continue;
    ctx.strokeStyle = wh(0.035); ctx.beginPath(); ctx.moveTo(gx, T.y); ctx.lineTo(gx, T.y + T.h - 22); ctx.stroke();
    const lab = secs ? `${hhmm(tm)}:${String(new Date(tm).getSeconds()).padStart(2, '0')}` : hhmm(tm);
    if (gx - lastLab < ctx.measureText(lab).width + 12) continue;
    ctx.fillText(lab, gx, T.y + T.h - 8); lastLab = gx;
  }
  // the line, price to price, the pen resting at today's price until the next one lands
  const col = stale ? MAT.faint : t.btc;
  const px = x1;
  const py = Yt(s.realPrice);
  if (n > 0) {
    ctx.beginPath();
    if (n < 2) ctx.moveTo(x0, Yt(pts[0].p)); else ctx.moveTo(tx(pts[0].t), Yt(pts[0].p));
    for (let i = 1; i < n; i++) ctx.lineTo(tx(pts[i].t), Yt(pts[i].p));
    ctx.lineTo(px, Yt(pts[n - 1].p)); ctx.lineTo(px, py);
    ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.stroke();
    ctx.lineTo(px, T.y + T.h); ctx.lineTo(n < 2 ? x0 : tx(pts[0].t), T.y + T.h); ctx.closePath();
    const g = ctx.createLinearGradient(0, T.y, 0, T.y + T.h); g.addColorStop(0, al(col, 0.16)); g.addColorStop(1, al(col, 0));
    ctx.fillStyle = g; ctx.fill();
  } else {
    ctx.textAlign = 'center'; ctx.font = `500 11px ${FONT}`; ctx.fillStyle = MAT.faint;
    ctx.fillText('Waiting for prices', x0 + TW / 2, T.y + T.h / 2 - 14);
  }
  // today's price level, as a faint guide
  ctx.strokeStyle = wh(0.16); ctx.setLineDash([2, 4]); ctx.beginPath(); ctx.moveTo(x0, py); ctx.lineTo(x1, py); ctx.stroke(); ctx.setLineDash([]);
  // far below this window: the liquidation price
  if (s.cb.owes && s.cb.liq > 0 && s.cb.liq < lo) {
    const gr = ctx.createLinearGradient(0, T.y + T.h - 46, 0, T.y + T.h); gr.addColorStop(0, al(t.red, 0)); gr.addColorStop(1, al(t.red, 0.14));
    ctx.fillStyle = gr; ctx.fillRect(x0, T.y + T.h - 46, TW, 46);
    ctx.textAlign = 'right'; ctx.font = `600 11px ${FONT}`; ctx.fillStyle = al(t.red, 0.95);
    ctx.fillText(liqFooter(TW, s.labels.liqText, s.labels.bufferText), x1 - 8, T.y + T.h - 26);
  }
  // under a mouse: the time and the price there
  if (m.ptr !== null && !m.held && m.hover === 'tape' && m.ptr.x > x0 && m.ptr.x < x1 && n > 0) {
    const ht = t0 + (m.ptr.x - x0) / TW * span;
    let hp = pts[0].p;
    for (const q of pts) if (q.t <= ht) hp = q.p;
    const hx = m.ptr.x;
    const hy = Yt(hp);
    const txt = tapeHoverText(hhmm(ht), hp);
    ctx.strokeStyle = wh(0.25); ctx.setLineDash([2, 3]); ctx.beginPath(); ctx.moveTo(hx, T.y); ctx.lineTo(hx, T.y + T.h); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = t.text; ctx.beginPath(); ctx.arc(hx, hy, 3, 0, TAU); ctx.fill();
    ctx.font = `600 11.5px ${FONT}`;
    const tw = ctx.measureText(txt).width + 16;
    const bx = clamp(hx - tw / 2, x0 + 4, x1 - tw - 4);
    ctx.fillStyle = MAT.hoverBox; rr(ctx, bx, T.y + 8, tw, 20, 10); ctx.fill();
    ctx.fillStyle = t.text; ctx.textAlign = 'left'; ctx.fillText(txt, bx + 8, T.y + 22);
  }
  ctx.restore();
  ctx.strokeStyle = wh(0.08); ctx.lineWidth = 1; rr(ctx, x0, T.y, TW, T.h, 12); ctx.stroke();
  // its title; on a phone the gauge sits over the chart's top left corner
  const shown = Math.round(span / 60e3);
  const last = m.ticks.length > 0 ? m.ticks[m.ticks.length - 1].t : s.tapePrices.live?.t ?? now;
  const ttl = tapeTitle(s.feed, shown, Math.round((now - last) / 60e3), TW < 330);
  ctx.textAlign = 'left'; ctx.font = `600 12px ${FONT}`; ctx.fillStyle = MAT.muted;
  const ttlX = Math.max(x0 + 2, s.gauge.cx + s.gauge.r * 1.25 + 6);
  if (ctx.measureText(ttl).width < T.x + T.w - 8 - ttlX) ctx.fillText(ttl, ttlX, T.y - 10);
  return { penX: px, penY: py, col, stale };
}

/** The two tubes, their charge, the floor plates, the pistons, the beam and the bed. */
function drawCylinders(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, Y: (p: number) => number,
  dt: number, reduce: boolean): Geo {
  const top = s.top;
  const bot = s.bot;
  const bay = bayOf(s, m.cb, m.s);
  const { cX, cW, sX, sW, showS, right, rodX, attX } = bay;
  let yP = clamp(Y(m.P), top + 2, bot - 2);
  let beamY = yP - 34;
  const geo: Geo = { ...bay, yP, beamY, yF: bot, floorIn: false, wheel: null };

  // a running engine shakes a little: the piston rides the price, with a hair of idle stroke while it is live
  if (!reduce && !m.held) {
    yP = clamp(yP + Math.sin(m.spin) * 1.3 * Math.min(1, m.spinV / 2.4) + 2.4 * (m.pk || 0), top + 2, bot - 2);
    geo.yP = yP; geo.beamY = beamY = yP - 34;
  }

  // a soft pool of light behind the engine
  const lg = ctx.createRadialGradient((cX + right) / 2, (top + bot) / 2, 10, (cX + right) / 2, (top + bot) / 2, (bot - top) * 0.75);
  lg.addColorStop(0, wh(0.045)); lg.addColorStop(1, wh(0));
  ctx.fillStyle = lg; ctx.fillRect(cX - 60, top - 40, right - cX + 120, bot - top + 80);

  const cylinder = (x: number, w: number, debt: number, ltv: number, level: SafetyLevel, liqFrac: number, floorP: number,
    parts: Particle[], isCb: boolean, embers: Ember[]): { yF: number; floorIn: boolean } => {
    const floorIn = floorP > 0 && Y(floorP) < bot - 1;
    const yF = floorIn ? Math.max(top, Y(floorP)) : bot;
    const tubeTop = top - 8;
    const r6 = Math.min(7, w / 2);
    const cxm = x + w / 2;
    const ry = clamp(w * 0.09, 1.5, 6.5);
    // the glass tube: a dark inside with a lit back wall
    ctx.fillStyle = MAT.tubeDark; rr(ctx, x, tubeTop, w, bot - tubeTop, r6); ctx.fill();
    const back = ctx.createLinearGradient(x, 0, x + w, 0);
    back.addColorStop(0, wh(0.06)); back.addColorStop(0.5, wh(0.015)); back.addColorStop(1, bk(0.18));
    ctx.fillStyle = back; rr(ctx, x, tubeTop, w, bot - tubeTop, r6); ctx.fill();
    ctx.save(); rr(ctx, x + 1, tubeTop + 1, w - 2, bot - tubeTop - 2, Math.max(1, r6 - 1)); ctx.clip();
    if (floorIn) {                                                      // under the floor: the part that would be sold
      const ug = ctx.createLinearGradient(0, yF, 0, bot); ug.addColorStop(0, al(t.red, 0.24)); ug.addColorStop(1, al(t.red, 0.05));
      ctx.fillStyle = ug; ctx.fillRect(x, yF, w, bot - yF);
    }
    const hc = Math.max(0, yF - yP);
    const col = debt > 0 ? levelTone(t, level) : t.green;
    const blown = debt > 0 && ltv >= liqFrac;
    const heat = debt > 0 ? clamp((ltv - 0.15) / 0.7, 0, 1) : 0;
    const flick = reduce ? 1 : 0.86 + 0.14 * Math.sin(m.clock * 9 + x * 0.3) * Math.sin(m.clock * 5.3);
    if (debt > 0 && hc > 1) {
      // the charge: thicker and brighter the harder it is squeezed
      const cg = ctx.createLinearGradient(0, yP, 0, yF);
      cg.addColorStop(0, al(col, 0.03 + 0.10 * heat)); cg.addColorStop(1, al(col, 0.10 + 0.30 * heat));
      ctx.fillStyle = cg; ctx.fillRect(x, yP, w, hc);
      // the glow of the hot floor
      const fr = Math.max(w * 0.75, 22);
      const fgl = ctx.createRadialGradient(cxm, yF, 1, cxm, yF, fr);
      fgl.addColorStop(0, al(col, (0.22 + 0.5 * heat) * flick)); fgl.addColorStop(1, al(col, 0));
      ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = fgl; ctx.fillRect(x, Math.max(yP, yF - fr), w, Math.min(hc, fr)); ctx.globalCompositeOperation = 'source-over';
    }
    // the loan, as a charge of particles between the price and the floor
    syncParticles(parts, debt > 0 && s.chargeUsd > 0 ? debt / s.chargeUsd : 0, m.init, reduce);
    stepParticles(parts, dt, w - 8, hc - 6, 26 + 230 * clamp(ltv, 0, 1.2), reduce);
    ctx.globalCompositeOperation = 'lighter';
    const rad = w < 44 ? 1.5 : 2.1;
    const jx = ltv > 0.6 && !reduce ? ((Number.isFinite(ltv) ? ltv : 1.2) - 0.6) * 5 : 0;   // infinite: as at 120% (v1.5)
    const hh = Math.max(0, hc - 6);
    const spr = glowSprite(m, col);
    for (const p of parts) {
      const px = x + 4 + p.x * Math.max(1, w - 8) + (jx ? (Math.random() - 0.5) * jx : 0);
      const pyy = yF - 3 - p.y * hh;
      const sz = rad * 5.2 * (0.55 + 0.45 * p.s / 1.45);              // nearer ones are larger
      ctx.drawImage(spr, px - sz / 2, pyy - sz / 2, sz, sz);
    }
    ctx.globalCompositeOperation = 'source-over';
    if (debt > 0) drawEmbers(ctx, m, reduce, embers, dt, x, w, yP, yF, col, heat); else embers.length = 0;
    if (blown) { ctx.fillStyle = al(t.red, 0.2 + 0.08 * Math.sin(m.clock * 8)); ctx.fillRect(x, top - 6, w, bot - top + 4); }
    // the glass in front: lit edges and one long reflection
    const gl = ctx.createLinearGradient(x, 0, x + w, 0);
    if (w > 30) {
      gl.addColorStop(0, wh(0.20)); gl.addColorStop(Math.min(0.12, 4 / w), wh(0.03));
      gl.addColorStop(0.18, wh(0.10)); gl.addColorStop(0.27, wh(0));
      gl.addColorStop(1 - Math.min(0.1, 4 / w), wh(0)); gl.addColorStop(1, wh(0.12));
    } else { gl.addColorStop(0, wh(0.18)); gl.addColorStop(0.45, wh(0)); gl.addColorStop(1, wh(0.10)); }
    ctx.fillStyle = gl; ctx.fillRect(x, tubeTop, w, bot - tubeTop);
    if (isCb && w > 40 && !reduce) {                                   // now and then a sheen slides across the glass
      const shT = (m.clock % 7) / 1.6;
      if (shT < 1) {
        const shX = x - 30 + shT * (w + 60);
        const sh = ctx.createLinearGradient(shX - 16, 0, shX + 16, 0);
        sh.addColorStop(0, wh(0)); sh.addColorStop(0.5, wh(Number((0.07 * Math.sin(shT * Math.PI)).toFixed(3)))); sh.addColorStop(1, wh(0));
        ctx.save(); ctx.transform(1, 0, -0.25, 1, (tubeTop + (bot - tubeTop) / 2) * 0.25, 0); ctx.fillStyle = sh; ctx.fillRect(shX - 16, tubeTop, 32, bot - tubeTop); ctx.restore();
      }
    }
    ctx.restore();
    ctx.lineWidth = 1.4; ctx.strokeStyle = isCb ? al(t.coinbase, 0.6) : al(t.strike, 0.3); rr(ctx, x, tubeTop, w, bot - tubeTop, r6); ctx.stroke();
    if (w > 14) {                                                       // the rim of the open tube and the curve of its base
      ctx.strokeStyle = wh(0.20); ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(cxm, tubeTop + ry + 1, w / 2 - 1.5, ry, 0, 0, TAU); ctx.stroke();
      ctx.strokeStyle = wh(0.10); ctx.beginPath(); ctx.ellipse(cxm, bot - ry - 1, w / 2 - 1.5, ry, 0, 0.1, Math.PI - 0.1); ctx.stroke();
    }
    if (floorIn) {                                                      // the liquidation price: a glowing plate across the tube
      const near = isCb && (yF - yP) < (bot - top) * 0.12;
      const gw = near && !reduce ? 9 + 3 * Math.sin(m.clock * 6) : 6;
      ctx.lineCap = 'round';
      ctx.strokeStyle = al(t.red, 0.16); ctx.lineWidth = gw * 2; ctx.beginPath(); ctx.moveTo(x - (isCb ? 6 : 0), yF); ctx.lineTo(x + w + (isCb ? 1 : 0), yF); ctx.stroke();
      ctx.strokeStyle = al(t.red, 0.22); ctx.lineWidth = gw; ctx.stroke();
      ctx.lineCap = 'butt';
      if (w > 14) { ctx.fillStyle = al(t.red, 0.5); ctx.beginPath(); ctx.ellipse(cxm, yF, w / 2 - 1, ry, 0, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = t.red; ctx.lineWidth = isCb ? 2.4 : 1.6;
      ctx.beginPath(); ctx.moveTo(x - (isCb ? 9 : 0), yF); ctx.lineTo(x + w + (isCb ? 3 : 0), yF); ctx.stroke();
    }
    // sparks under the piston when a price lands, and all through the charge when the loans move
    if (isCb && debt > 0 && hc > 6) {
      if (m.burst) m.flash2 = 1;
      if (m.flash2 > 0.02 && !reduce) {
        const f2 = ctx.createRadialGradient(cxm, yP + 4, 1, cxm, yP + 4, Math.max(18, w * 0.7));
        f2.addColorStop(0, tri(MAT.flash, Number((0.5 * m.flash2).toFixed(3)))); f2.addColorStop(1, tri(MAT.flash, 0));
        ctx.save(); rr(ctx, x + 1, yP, w - 2, Math.max(1, hc), 2); ctx.clip(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = f2; ctx.fillRect(x, yP, w, Math.min(hc, w)); ctx.restore();
      }
      if (m.burst) sparkBurst(m, reduce, x + 6 + Math.random() * Math.max(1, w - 12), yP + 3, 7 + Math.round(8 * heat), m.burstDir < 0 ? MAT.sparkDown : MAT.sparkUp, 70 + 90 * heat, Math.PI / 2, 2.4);
      if (m.kick) for (let kb = 0; kb < 4; kb++) sparkBurst(m, reduce, x + 4 + Math.random() * Math.max(1, w - 8), yP + Math.random() * hc, 6, MAT.sparkKick, 90, 0, TAU);
    }
    // the piston: a metal disc seen a little from above, and its rod up to the beam
    const ph = 13; const px0 = x - 2; const pw = w + 4; const pry = clamp(pw * 0.085, 1.5, 6);
    ctx.fillStyle = bk(0.35); rr(ctx, px0 + 1, yP - 2, pw - 2, 5, 2); ctx.fill();                       // its shadow on the charge
    const pg = ctx.createLinearGradient(px0, 0, px0 + pw, 0);
    pg.addColorStop(0, MAT.piston[0]); pg.addColorStop(0.2, MAT.piston[1]); pg.addColorStop(0.5, MAT.piston[2]); pg.addColorStop(0.85, MAT.piston[3]); pg.addColorStop(1, MAT.piston[4]);
    ctx.fillStyle = pg; rr(ctx, px0, yP - ph, pw, ph, 3); ctx.fill();
    ctx.fillStyle = bk(0.30); ctx.fillRect(px0, yP - 5, pw, 1.2); ctx.fillRect(px0, yP - 9, pw, 1);
    if (pw > 18) {
      const tg = ctx.createLinearGradient(px0, 0, px0 + pw, 0); tg.addColorStop(0, MAT.pistonTop[0]); tg.addColorStop(0.3, MAT.pistonTop[1]); tg.addColorStop(1, MAT.pistonTop[2]);
      ctx.fillStyle = tg; ctx.beginPath(); ctx.ellipse(px0 + pw / 2, yP - ph, pw / 2, pry, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = bk(0.22); ctx.lineWidth = 1; ctx.stroke();
    }
    const rg = ctx.createLinearGradient(cxm - 3, 0, cxm + 3, 0); rg.addColorStop(0, MAT.rod[0]); rg.addColorStop(0.35, MAT.rod[1]); rg.addColorStop(1, MAT.rod[2]);
    ctx.fillStyle = rg; ctx.fillRect(cxm - 3, beamY, 6, yP - ph - beamY);
    if (pw > 18) { ctx.fillStyle = MAT.rodCap; ctx.beginPath(); ctx.ellipse(cxm, yP - ph, 5.5, 2.3, 0, 0, TAU); ctx.fill(); }
    return { yF, floorIn };
  };
  const cb = cylinder(cX, cW, s.cb.owes ? s.cb.debt : 0, s.cb.ltv, s.cb.level, s.cb.liqFrac, m.rl > 0 && s.cb.owes ? m.rl : 0, m.parts.cb, true, m.embers.cb);
  if (showS) cylinder(sX, sW, s.sk.owes ? s.sk.debt : 0, s.sk.ltv, s.sk.level, s.sk.liqFrac, s.sk.owes ? s.sk.liq : 0, m.parts.s, false, m.embers.s);
  else { m.parts.s.length = 0; m.embers.s.length = 0; }
  geo.yF = cb.yF; geo.floorIn = cb.floorIn;

  // the beam that ties the two pistons: one price moves both (with Strike's tube gone, a short crosshead for the motor's pin)
  const bg = ctx.createLinearGradient(0, beamY - 4, 0, beamY + 4); bg.addColorStop(0, MAT.beam[0]); bg.addColorStop(0.5, MAT.beam[1]); bg.addColorStop(1, MAT.beam[2]);
  ctx.fillStyle = bk(0.35); rr(ctx, rodX - 4, beamY - 1, attX - rodX + 8, 7, 3); ctx.fill();
  ctx.fillStyle = bg; rr(ctx, rodX - 4, beamY - 3.5, attX - rodX + 8, 7, 3.5); ctx.fill();
  const boss = (bx0: number, r0: number): void => {
    const g0 = ctx.createRadialGradient(bx0 - r0 * 0.3, beamY - r0 * 0.3, 0.5, bx0, beamY, r0); g0.addColorStop(0, MAT.boss[0]); g0.addColorStop(1, MAT.boss[1]);
    ctx.fillStyle = g0; ctx.beginPath(); ctx.arc(bx0, beamY, r0, 0, TAU); ctx.fill();
  };
  boss(rodX, 4.8); boss(attX, 3.8);
  // the bed plate: a slab with a lit top edge and a shadow under it
  ctx.fillStyle = bk(0.4); rr(ctx, cX - 6, bot + 6, right - cX + 12, 6, 3); ctx.fill();
  const bedG = ctx.createLinearGradient(0, bot + 1, 0, bot + 9); bedG.addColorStop(0, MAT.bed[0]); bedG.addColorStop(1, MAT.bed[1]);
  ctx.fillStyle = bedG; rr(ctx, cX - 10, bot + 1, right - cX + 20, 8, 2.5); ctx.fill();
  ctx.fillStyle = wh(0.28); ctx.fillRect(cX - 9, bot + 1, right - cX + 18, 1);
  return geo;
}

/** The flywheel's body: drawn once and kept until its angle moves. */
function rotorBody(g: CanvasRenderingContext2D, t: Tones, rodX: number, wy: number, wr: number, angle: number, dim: boolean): void {
  const D = rotorDims(wr);
  const { big, band, tooth, Rt, Ro, depth } = D;
  const teeth = big ? 44 : 34;
  const tw = Math.PI * 2 * Rt / (teeth * 2);
  const a0 = -Math.PI / 2 + angle;
  const hubR = big ? 11 : 8.2;
  const sIn = hubR - 1;
  const sOut = wr - band / 2;
  g.lineCap = 'butt';
  // its shadow on the back wall
  g.fillStyle = bk(0.40); g.beginPath(); g.arc(rodX + depth + 2, wy + depth * 1.7 + 3, Ro + 2, 0, TAU); g.fill();
  // the thickness of the flywheel: the same ring, seen edge-on, stepping back into the picture
  g.lineWidth = tooth; g.strokeStyle = MAT.wheelEdge; g.setLineDash([tw, tw]); g.lineDashOffset = -angle * Rt;
  g.beginPath(); g.arc(rodX + depth * 0.85, wy + depth * 1.45, Rt, 0, TAU); g.stroke();
  g.beginPath(); g.arc(rodX + depth * 0.42, wy + depth * 0.72, Rt, 0, TAU); g.stroke(); g.setLineDash([]);
  for (let i = Math.round(depth); i >= 1; i--) {
    g.lineWidth = band + 1; g.strokeStyle = i % 2 ? MAT.wheelDepth[0] : MAT.wheelDepth[1]; g.beginPath(); g.arc(rodX + i * 0.85, wy + i * 1.45, wr, 0, TAU); g.stroke();
  }
  // gear teeth round the rim
  g.lineWidth = tooth; g.setLineDash([tw, tw]); g.lineDashOffset = -angle * Rt;
  const tg = g.createLinearGradient(rodX - Ro, wy - Ro, rodX + Ro, wy + Ro); tg.addColorStop(0, MAT.wheelTeeth[0]); tg.addColorStop(0.5, MAT.wheelTeeth[1]); tg.addColorStop(1, MAT.wheelTeeth[2]);
  g.strokeStyle = tg; g.beginPath(); g.arc(rodX, wy, Rt, 0, TAU); g.stroke(); g.setLineDash([]); g.lineDashOffset = 0;
  // the rim: a heavy steel ring, lit from the top left, with the cycle's two legs inlaid
  const rimG = g.createLinearGradient(rodX - wr, wy - wr, rodX + wr, wy + wr); rimG.addColorStop(0, MAT.wheelRim[0]); rimG.addColorStop(0.45, MAT.wheelRim[1]); rimG.addColorStop(1, MAT.wheelRim[2]);
  g.lineWidth = band; g.strokeStyle = rimG; g.beginPath(); g.arc(rodX, wy, wr, 0, TAU); g.stroke();
  g.lineWidth = big ? 4 : 3.2;
  g.beginPath(); g.arc(rodX, wy, wr, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05); g.strokeStyle = al(t.red, dim ? 0.3 : 0.88); g.stroke();
  g.beginPath(); g.arc(rodX, wy, wr, Math.PI / 2 + 0.05, Math.PI * 1.5 - 0.05); g.strokeStyle = al(t.green, dim ? 0.3 : 0.88); g.stroke();
  g.lineWidth = 1; g.strokeStyle = wh(0.34); g.beginPath(); g.arc(rodX, wy, wr + band / 2 - 0.5, Math.PI * 0.85, Math.PI * 1.65); g.stroke();
  g.strokeStyle = bk(0.6); g.beginPath(); g.arc(rodX, wy, wr - band / 2 + 0.5, 0, TAU); g.stroke();
  g.strokeStyle = wh(0.10); g.beginPath(); g.arc(rodX, wy, wr - band / 2 - 0.5, Math.PI * 1.9, Math.PI * 2.6); g.stroke();
  // six heavy spokes and the hub turn with the rotor
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const sa = a0 + i * Math.PI / 3; const cs = Math.cos(sa); const sn = Math.sin(sa);
    g.strokeStyle = bk(0.5); g.lineWidth = big ? 7 : 5.4; g.beginPath(); g.moveTo(rodX + cs * sIn + 1.2, wy + sn * sIn + 2); g.lineTo(rodX + cs * sOut + 1.2, wy + sn * sOut + 2); g.stroke();
    g.strokeStyle = MAT.spoke[0]; g.lineWidth = big ? 5.4 : 4; g.beginPath(); g.moveTo(rodX + cs * sIn, wy + sn * sIn); g.lineTo(rodX + cs * sOut, wy + sn * sOut); g.stroke();
    g.strokeStyle = MAT.spoke[1]; g.lineWidth = big ? 1.8 : 1.4; g.beginPath(); g.moveTo(rodX + cs * sIn - 0.8, wy + sn * sIn - 0.8); g.lineTo(rodX + cs * sOut - 0.8, wy + sn * sOut - 0.8); g.stroke();
  }
  g.lineCap = 'butt';
  const webR = (hubR + sOut) * 0.5;                                    // a web ring ties the spokes together: this wheel has mass
  g.strokeStyle = bk(0.5); g.lineWidth = big ? 5 : 4; g.beginPath(); g.arc(rodX + 1, wy + 1.8, webR, 0, TAU); g.stroke();
  g.strokeStyle = MAT.web; g.lineWidth = big ? 3.6 : 2.8; g.beginPath(); g.arc(rodX, wy, webR, 0, TAU); g.stroke();
  g.strokeStyle = wh(0.22); g.lineWidth = 1; g.beginPath(); g.arc(rodX, wy, webR + (big ? 1.6 : 1.2), Math.PI * 0.9, Math.PI * 1.6); g.stroke();
  g.fillStyle = bk(0.45); g.beginPath(); g.arc(rodX + 1.5, wy + 2.5, hubR + 1, 0, TAU); g.fill();
  const hg = g.createRadialGradient(rodX - hubR * 0.35, wy - hubR * 0.35, 0.5, rodX, wy, hubR); hg.addColorStop(0, MAT.hub[0]); hg.addColorStop(0.5, MAT.hub[1]); hg.addColorStop(1, MAT.hub[2]);
  g.fillStyle = hg; g.beginPath(); g.arc(rodX, wy, hubR, 0, TAU); g.fill();
  for (let i = 0; i < 6; i++) { const ba = a0 + Math.PI / 6 + i * Math.PI / 3; g.fillStyle = MAT.hubBolt; g.beginPath(); g.arc(rodX + Math.cos(ba) * hubR * 0.62, wy + Math.sin(ba) * hubR * 0.62, big ? 1.3 : 1, 0, TAU); g.fill(); }
  g.fillStyle = MAT.hubCap; g.beginPath(); g.arc(rodX, wy, hubR * 0.3, 0, TAU); g.fill();
}

/** The flywheel: the 4-year cycle, its top a peak. It stays put when a tube narrows; only the crank follows the piston. */
function drawWheel(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, geo: Geo, dpr: number): void {
  const wy = s.wheel.y;
  const wr = s.wheel.r;
  const rodX = Math.max(geo.rodX, s.cylX + wr + 4);
  const cyc = s.cycle?.angle ?? 0;
  const { Ro, depth } = rotorDims(wr);
  const pinX = rodX + Math.sin(cyc) * wr * 0.56;
  const pinY = wy - Math.cos(cyc) * wr * 0.56;
  cachedLayer(ctx, m, dpr, 'rotor', [s.W, dpr, Math.round(cyc * 400), Math.round(rodX * 2), wy, s.cycle === null ? 0 : 1, t.red, t.green].join('|'),
    rodX - Ro - 6, wy - Ro - 6, Ro * 2 + depth + 16, Ro * 2 + depth * 1.7 + 18, (g) => rotorBody(g, t, rodX, wy, wr, cyc, s.cycle === null));
  // the crank rod, from the pin on the rotor down to the crosshead
  ctx.lineCap = 'round';
  ctx.strokeStyle = bk(0.45); ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(pinX + 1, pinY + 2); ctx.lineTo(geo.rodX + 1, geo.beamY + 2); ctx.stroke();
  ctx.strokeStyle = metal(ctx, rodX - 3, 0, rodX + 3, 0); ctx.lineWidth = 4.5;
  ctx.beginPath(); ctx.moveTo(pinX, pinY); ctx.lineTo(geo.rodX, geo.beamY); ctx.stroke();
  const pgd = ctx.createRadialGradient(pinX - 1.5, pinY - 1.5, 0.5, pinX, pinY, 4.6); pgd.addColorStop(0, MAT.pin[0]); pgd.addColorStop(1, MAT.pin[1]);
  ctx.fillStyle = pgd; ctx.beginPath(); ctx.arc(pinX, pinY, 4.4, 0, TAU); ctx.fill();
  ctx.lineCap = 'butt';
  if (s.cycle !== null) {                                               // where the 4-year cycle stands: a bright bead on the rim
    const bdx = rodX + Math.sin(cyc) * wr;
    const bdy = wy - Math.cos(cyc) * wr;
    ctx.fillStyle = wh(0.18); ctx.beginPath(); ctx.arc(bdx, bdy, 6.5, 0, TAU); ctx.fill();
    ctx.fillStyle = MAT.bead; ctx.beginPath(); ctx.arc(bdx, bdy, 3, 0, TAU); ctx.fill();
  }
  ctx.font = `600 10.5px ${FONT}`; ctx.fillStyle = MAT.muted; ctx.textAlign = 'center';
  ctx.fillText(s.labels.wheelTop, rodX, wy - Ro - 6);
  geo.wheel = { x: rodX, y: wy, r: wr, ro: Ro };
}

/** The worm gear: the motor's shaft turns its screw, and the screw's thread winds down against the flywheel's teeth. */
function drawWorm(ctx: CanvasRenderingContext2D, m: EngineMotion, t: Tones, reduce: boolean, x: number, y: number, w: number, h: number,
  boxW: number, motorEdge: number, a: number, on: boolean): void {
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  // the drive shaft from the motor, and the little gearbox that turns it through a right angle
  const sg = ctx.createLinearGradient(0, y - 3, 0, y + 3); sg.addColorStop(0, MAT.shaft[0]); sg.addColorStop(0.5, MAT.shaft[1]); sg.addColorStop(1, MAT.shaft[2]);
  ctx.fillStyle = bk(0.4); ctx.fillRect(x + w / 2 + boxW - 1, y - 1.5, motorEdge - (x + w / 2 + boxW) + 3, 5);
  ctx.fillStyle = sg; ctx.fillRect(x + w / 2 + boxW - 1, y - 2.5, motorEdge - (x + w / 2 + boxW) + 3, 5);
  const bx = x + w / 2 - 1;
  const bg = ctx.createLinearGradient(bx, y - 9, bx + boxW, y + 9); bg.addColorStop(0, MAT.gearbox[0]); bg.addColorStop(1, MAT.gearbox[1]);
  ctx.fillStyle = bk(0.4); rr(ctx, bx + 1, y - 8, boxW + 1, 19, 2.5); ctx.fill();
  ctx.fillStyle = bg; rr(ctx, bx, y - 9.5, boxW + 1, 19, 2.5); ctx.fill();
  ctx.fillStyle = wh(0.22); ctx.fillRect(bx + 1, y - 9, boxW - 1, 1);
  // its two bearings
  ctx.fillStyle = MAT.bearing; rr(ctx, x0 - 2, y0 - 5, w + 4, 6, 2); ctx.fill(); rr(ctx, x0 - 2, y0 + h - 1, w + 4, 6, 2); ctx.fill();
  ctx.fillStyle = wh(0.18); ctx.fillRect(x0 - 1, y0 - 5, w + 2, 1); ctx.fillRect(x0 - 1, y0 + h - 1, w + 2, 1);
  // the screw: a steel cylinder, round across its width
  ctx.fillStyle = bk(0.4); rr(ctx, x0 + 1.5, y0 + 2, w, h, 3); ctx.fill();
  const cg = ctx.createLinearGradient(x0, 0, x0 + w, 0); cg.addColorStop(0, MAT.screw[0]); cg.addColorStop(0.32, MAT.screw[1]); cg.addColorStop(0.6, MAT.screw[2]); cg.addColorStop(1, MAT.screw[3]);
  ctx.fillStyle = cg; rr(ctx, x0, y0, w, h, 3); ctx.fill();
  // the thread winds down it as the motor turns
  const pitch = w < 11 ? 5 : 6;
  const ph = reduce ? 0 : (((a * 1.9) % pitch) + pitch) % pitch;
  ctx.save(); rr(ctx, x0, y0, w, h, 3); ctx.clip(); ctx.lineCap = 'butt';
  for (let i = -1; i < h / pitch + 2; i++) {
    const ty = y0 + i * pitch + ph;
    ctx.strokeStyle = MAT.thread; ctx.lineWidth = 1.7; ctx.beginPath(); ctx.moveTo(x0 - 1, ty + 2.2); ctx.lineTo(x0 + w + 1, ty - 2.2); ctx.stroke();
    ctx.strokeStyle = wh(0.30); ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(x0 - 1, ty + 3.7); ctx.lineTo(x0 + w + 1, ty - 0.7); ctx.stroke();
  }
  ctx.restore();
  if (on && m.mot > 0.05 && !reduce) {                                 // a price has just landed: the screw catches the light
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * m.mot;
    const gz = h * 0.9; ctx.drawImage(glowSprite(m, t.btc), x - gz / 2, y - gz / 2, gz, gz); ctx.restore();
  }
}

/** The price motor: it turns while the price is live, kicks with each new price, and drives the beam's far end. */
function drawMotor(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, geo: Geo, reduce: boolean): void {
  const w = geo.wheel;
  if (w === null) return;
  const mr = s.motor.r;
  const on = s.motorOn;
  const big = mr >= 24;
  const wormW = big ? 12 : 10;
  const wormH = big ? 34 : 26;
  const boxW = big ? 9 : 7;
  const shaft = big ? 5 : 3;
  const wormX = w.x + w.ro + 1 + wormW / 2;
  const my = w.y;
  const mx = clamp(Math.max(wormX + wormW / 2 + boxW + shaft + mr + 5, geo.attX + 4), mr + 12, s.W - mr - 12);
  const a = m.spin;
  const sp = clamp(m.spinV / 14, 0, 1);
  drawWorm(ctx, m, t, reduce, wormX, my, wormW, wormH, boxW, mx - mr - 4, a, on);

  // its shadow, then the housing with cooling fins, lit from the top left like everything else
  ctx.fillStyle = bk(0.38); ctx.beginPath(); ctx.arc(mx + 3, my + 5, mr + 5, 0, TAU); ctx.fill();
  ctx.lineCap = 'butt'; ctx.lineWidth = 2.6;
  for (let i = 0; i < 16; i++) {
    const fa = i * Math.PI / 8 + 0.2; const c0 = Math.cos(fa); const s0 = Math.sin(fa);
    ctx.strokeStyle = s0 + c0 < 0 ? MAT.fin[0] : MAT.fin[1];
    ctx.beginPath(); ctx.moveTo(mx + c0 * (mr - 1), my + s0 * (mr - 1)); ctx.lineTo(mx + c0 * (mr + 4.5), my + s0 * (mr + 4.5)); ctx.stroke();
  }
  const hg = ctx.createLinearGradient(mx - mr, my - mr, mx + mr, my + mr); hg.addColorStop(0, MAT.housing[0]); hg.addColorStop(0.5, MAT.housing[1]); hg.addColorStop(1, MAT.housing[2]);
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
  // the well the rotor turns in
  const wr2 = mr * 0.77;
  const R = wr2 - 2;
  const wg = ctx.createRadialGradient(mx, my, 1, mx, my, wr2); wg.addColorStop(0, MAT.well[0]); wg.addColorStop(1, MAT.well[1]);
  ctx.fillStyle = wg; ctx.beginPath(); ctx.arc(mx, my, wr2, 0, TAU); ctx.fill();
  ctx.strokeStyle = bk(0.6); ctx.lineWidth = 1; ctx.stroke();
  // the live price glows in its core: steady while live, a flare each time a price lands
  ctx.save(); ctx.beginPath(); ctx.arc(mx, my, wr2 - 0.5, 0, TAU); ctx.clip();
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = on ? 0.4 + 0.6 * m.mot : 0.06;
  const gz = mr * (1.8 + 1.2 * m.mot); ctx.drawImage(glowSprite(m, t.btc), mx - gz / 2, my - gz / 2, gz, gz);
  ctx.restore();
  // the rotor: three swept blades, blurring as it speeds up
  const bladeA = Number((1 - 0.55 * sp).toFixed(3));
  ctx.save(); ctx.translate(mx, my); ctx.rotate(a);
  for (let i = 0; i < 3; i++) {
    ctx.rotate(Math.PI * 2 / 3);
    const bgd = ctx.createLinearGradient(0, -R, R * 0.6, 0); bgd.addColorStop(0, tri(MAT.blade[0], bladeA)); bgd.addColorStop(1, tri(MAT.blade[1], bladeA));
    ctx.fillStyle = bgd;
    ctx.beginPath(); ctx.moveTo(0, -R * 0.2); ctx.quadraticCurveTo(R * 0.08, -R * 0.78, R * 0.5, -R * 0.84); ctx.quadraticCurveTo(R * 0.52, -R * 0.36, R * 0.19, -R * 0.06); ctx.closePath(); ctx.fill();
  }
  ctx.restore();
  if (sp > 0.22) { ctx.strokeStyle = tri(MAT.bladeBlur, Number((0.18 * sp).toFixed(3))); ctx.lineWidth = R * 0.56; ctx.beginPath(); ctx.arc(mx, my, R * 0.56, 0, TAU); ctx.stroke(); }
  const hb = ctx.createRadialGradient(mx - 1.2, my - 1.2, 0.5, mx, my, mr * 0.21); hb.addColorStop(0, MAT.motorHub[0]); hb.addColorStop(1, on ? MAT.motorHub[1] : MAT.motorHub[2]);
  ctx.fillStyle = hb; ctx.beginPath(); ctx.arc(mx, my, mr * 0.2, 0, TAU); ctx.fill();
  const gh = ctx.createLinearGradient(0, my - wr2, 0, my); gh.addColorStop(0, wh(0.13)); gh.addColorStop(1, wh(0));   // light on its glass
  ctx.fillStyle = gh; ctx.beginPath(); ctx.arc(mx, my, wr2 - 1, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill();
  // the speed ring: how hard the motor is running
  const t0 = Math.PI * 0.75; const t1 = Math.PI * 2.25; const tr = mr + 9;
  ctx.lineCap = 'round'; ctx.lineWidth = 2.2; ctx.strokeStyle = wh(0.10); ctx.beginPath(); ctx.arc(mx, my, tr, t0, t1); ctx.stroke();
  if (sp > 0.012) { ctx.strokeStyle = on ? t.btc : MAT.faint; ctx.beginPath(); ctx.arc(mx, my, tr, t0, t0 + (t1 - t0) * sp); ctx.stroke(); }
  // its crank rod, from the pin on the rotor down to the crosshead the pistons hang from
  const pinX = mx + Math.sin(a) * mr * 0.48; const pinY = my - Math.cos(a) * mr * 0.48;
  ctx.strokeStyle = bk(0.45); ctx.lineWidth = 5.5; ctx.beginPath(); ctx.moveTo(pinX + 1, pinY + 2); ctx.lineTo(geo.attX + 1, geo.beamY + 2); ctx.stroke();
  ctx.strokeStyle = metal(ctx, geo.attX - 3, 0, geo.attX + 3, 0); ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(pinX, pinY); ctx.lineTo(geo.attX, geo.beamY); ctx.stroke();
  const pgd = ctx.createRadialGradient(pinX - 1.2, pinY - 1.2, 0.5, pinX, pinY, 3.8); pgd.addColorStop(0, MAT.pin[0]); pgd.addColorStop(1, MAT.pin[1]);
  ctx.fillStyle = pgd; ctx.beginPath(); ctx.arc(pinX, pinY, 3.6, 0, TAU); ctx.fill();
  ctx.lineCap = 'butt';
  if (m.rp > 0 && !reduce) {                                            // the chamber has just fired: the push runs up the rod and turns the crank
    const ru = m.rp; const rxp = geo.attX + (pinX - geo.attX) * ru; const ryp = geo.beamY + (pinY - geo.beamY) * ru;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(glowSprite(m, t.btc), rxp - 9, ryp - 9, 18, 18); ctx.restore();
  }
  // its name, and a lamp for its state: live, a price tried, a price held, or none
  ctx.font = `600 10.5px ${FONT}`; ctx.textAlign = 'center';
  const lab = s.labels.motorName;
  const lw = ctx.measureText(lab).width;
  const lx = clamp(mx + 5, lw / 2 + 12, s.W - lw / 2 - 4);
  ctx.fillStyle = MAT.muted; ctx.fillText(lab, lx, my - tr - 7);
  ctx.fillStyle = lampTone(t, s.lamp);
  ctx.beginPath(); ctx.arc(lx - lw / 2 - 6, my - tr - 10.5, 2.6 + (on && !reduce ? 0.6 * Math.sin(m.clock * 4) : 0), 0, TAU); ctx.fill();
}

/** Coinbase would sell: a red banner over the bay, with what it would sell at most. */
function drawBanner(ctx: CanvasRenderingContext2D, s: EngineScene, t: Tones, geo: Geo): void {
  if (s.labels.bannerTitle === null) return;
  const { cX, cW } = geo;
  // centred on the Coinbase tube while it is wide; once it is narrow, on the whole bay so the tape stays clear
  const bw = Math.max(150, Math.min(cW - 12, 190));
  const bh = 44;
  const bay = s.area * 0.944 + 8;
  const mid = cW >= bw ? cX + cW / 2 : s.cylX + bay / 2;
  const bx = clamp(mid - bw / 2, 4, s.W - bw - 4);
  const by = s.top + (s.bot - s.top) * 0.3;
  const bcx = bx + bw / 2;
  ctx.fillStyle = al(t.red, 0.96); rr(ctx, bx, by, bw, bh, 8); ctx.fill();
  ctx.textAlign = 'center'; ctx.fillStyle = wh(1);
  ctx.font = `700 12px ${FONT}`; ctx.fillText(s.labels.bannerTitle, bcx, s.labels.bannerCoins === null ? by + 26 : by + 18);
  if (s.labels.bannerCoins !== null) { ctx.font = `700 14px ${FONT}`; ctx.fillText(s.labels.bannerCoins, bcx, by + 35); }
}

/** The gauge: Coinbase's loan against its coins, in the Dashboard's bands, with a needle on a spring. */
function drawGauge(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, geo: Geo, reduce: boolean): void {
  const { cx, cy, r } = s.gauge;
  const gf = s.gaugeFig;
  const a0 = Math.PI * 0.75; const a1 = Math.PI * 2.25;
  const ang = (p: number): number => a0 + (a1 - a0) * clamp(p, 0, 1);
  // its tube back to the chamber
  pipe3d(ctx, [[cx + r + 8, cy], [geo.cX - 3, cy], [geo.cX - 3, s.top - 4]]);
  ctx.fillStyle = bk(0.4); ctx.beginPath(); ctx.arc(cx + 2, cy + 4, r * 1.2, 0, TAU); ctx.fill();
  const bz = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r); bz.addColorStop(0, MAT.bezel[0]); bz.addColorStop(0.5, MAT.bezel[1]); bz.addColorStop(1, MAT.bezel[2]);
  ctx.fillStyle = bz; ctx.beginPath(); ctx.arc(cx, cy, r * 1.2, 0, TAU); ctx.fill();
  const face = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r * 1.12); face.addColorStop(0, MAT.dial[0]); face.addColorStop(1, MAT.dial[1]);
  ctx.fillStyle = face; ctx.beginPath(); ctx.arc(cx, cy, r * 1.11, 0, TAU); ctx.fill();
  ctx.lineCap = 'butt'; ctx.lineWidth = r * 0.17;
  const bands: [number, number, string][] = gf.loan
    ? [[0, gf.warnAt, t.green], [gf.warnAt, gf.actAt, t.amber], [gf.actAt, gf.liqAt, t.red], [gf.liqAt, 1, al(t.red, 0.6)]]
    : [[0, 1, al(MAT.muted, 0.35)]];
  for (const [b0, b1, c] of bands) {
    if (!(b1 > b0)) continue;
    ctx.beginPath(); ctx.arc(cx, cy, r, ang(b0) + 0.014, ang(b1) - 0.014); ctx.strokeStyle = c; ctx.globalAlpha = 0.9; ctx.stroke(); ctx.globalAlpha = 1;
  }
  const aL = ang(gf.liqAt);
  if (gf.loan) {                                                        // where Coinbase sells
    ctx.strokeStyle = MAT.gaugeMark; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(aL) * r * 0.87, cy + Math.sin(aL) * r * 0.87); ctx.lineTo(cx + Math.cos(aL) * r * 1.12, cy + Math.sin(aL) * r * 1.12); ctx.stroke();
  }
  const na = ang(needleAt(gf, m.gauge, m.clock, reduce));
  ctx.lineCap = 'round'; ctx.lineWidth = 2.8; ctx.strokeStyle = bk(0.5);
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * r * 0.14 + 1.5, cy - Math.sin(na) * r * 0.14 + 2.5); ctx.lineTo(cx + Math.cos(na) * r * 0.78 + 1.5, cy + Math.sin(na) * r * 0.78 + 2.5); ctx.stroke();
  ctx.strokeStyle = t.text; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(cx - Math.cos(na) * r * 0.14, cy - Math.sin(na) * r * 0.14); ctx.lineTo(cx + Math.cos(na) * r * 0.78, cy + Math.sin(na) * r * 0.78); ctx.stroke();
  const hb = ctx.createRadialGradient(cx - 1.5, cy - 1.5, 0.5, cx, cy, r * 0.12); hb.addColorStop(0, MAT.gaugeHub[0]); hb.addColorStop(1, MAT.gaugeHub[1]);
  ctx.fillStyle = hb; ctx.beginPath(); ctx.arc(cx, cy, r * 0.11, 0, TAU); ctx.fill();
  ctx.lineCap = 'butt';
  if (gf.loan) {
    const lx = cx + Math.cos(aL) * r * 0.66; const ly = cy + Math.sin(aL) * r * 0.66;
    ctx.fillStyle = MAT.markDisc; ctx.beginPath(); ctx.arc(lx, ly, 7.5, 0, TAU); ctx.fill();
    ctx.font = `700 10.5px ${FONT}`; ctx.fillStyle = t.red; ctx.textAlign = 'center'; ctx.fillText(s.labels.gaugeLiqMark, lx, ly + 3);
  }
  ctx.font = `700 ${Math.round(r * 0.36)}px ${FONT}`; ctx.textAlign = 'center';
  ctx.fillStyle = gaugeTone(t, gf);
  ctx.fillText(s.labels.gaugeText, cx, cy + r * 0.66);
  const gh = ctx.createLinearGradient(0, cy - r * 1.1, 0, cy - r * 0.1); gh.addColorStop(0, wh(0.11)); gh.addColorStop(1, wh(0));   // light on the glass
  ctx.fillStyle = gh; ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, Math.PI * 1.08, Math.PI * 1.92); ctx.closePath(); ctx.fill();
}

/** The month's two flows: what drips into the loans and what the plan pays out, in pipes leaving the bed plate's ends. */
function drawFlows(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, geo: Geo, reduce: boolean): void {
  const y = s.flowY;
  const xl = 12;
  const xr = s.W - 12;
  const off = reduce ? 0 : m.clock * 46;
  const shIn = s.flowShares.in;
  const shOut = s.flowShares.out;
  const bedL = geo.cX - 10;
  const bedR = geo.right + 10;
  const by = s.bot + 5;
  const lx = cylLabelX(geo);
  // the names stand where the machine's own pipe drops, so the two pipes leave the plate by its ends and pass outside them
  const gl = Math.max(xl + 16, Math.min(bedL, lx.c - 42) - 10);
  const gr = Math.min(xr - 16, Math.max(bedR, geo.showS ? lx.s + 30 : lx.c + 42) + 10);
  const run = (points: [number, number][], color: string, share: number): void => {
    pipe3d(ctx, points);
    if (!(share > 0)) return;
    ctx.save(); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.setLineDash([4, 6 + (1 - share) * 14]); ctx.lineDashOffset = -off * (0.5 + share * 0.5);
    ctx.beginPath(); points.forEach((p, i) => (i === 0 ? ctx.moveTo(p[0], p[1]) : ctx.lineTo(p[0], p[1])));
    ctx.strokeStyle = al(color, 0.28); ctx.lineWidth = 6; ctx.stroke(); ctx.strokeStyle = color; ctx.lineWidth = 2.6; ctx.stroke();
    ctx.restore(); ctx.setLineDash([]); ctx.lineDashOffset = 0;
  };
  const flange = (x: number): void => {                                // the collar where a pipe meets the plate
    const g = ctx.createLinearGradient(0, by - 7, 0, by + 7); g.addColorStop(0, MAT.flange[0]); g.addColorStop(0.45, MAT.flange[1]); g.addColorStop(1, MAT.flange[2]);
    ctx.fillStyle = bk(0.4); rr(ctx, x - 2, by - 5.5, 5, 13.5, 1.5); ctx.fill();
    ctx.fillStyle = g; rr(ctx, x - 2.5, by - 7, 5, 13.5, 1.5); ctx.fill();
    ctx.fillStyle = wh(0.28); ctx.fillRect(x - 2, by - 7, 4, 1);
  };
  run([[xl, y], [gl, y], [gl, by], [bedL + 3, by]], t.amber, shIn);
  run([[bedR - 3, by], [gr, by], [gr, y], [xr, y]], t.green, shOut);
  flange(bedL - 1.5); flange(bedR + 1.5);
  ctx.textAlign = 'left'; ctx.font = `600 10px ${FONT}`; ctx.fillStyle = t.amber; ctx.fillText(s.labels.inTitle, xl, y + 17);
  ctx.font = `600 12.5px ${FONT}`; ctx.fillStyle = t.text; ctx.fillText(s.labels.inText, xl, y + 32);
  ctx.textAlign = 'right'; ctx.font = `600 10px ${FONT}`; ctx.fillStyle = t.green; ctx.fillText(s.labels.outTitle, xr, y + 17);
  ctx.font = `600 12.5px ${FONT}`; ctx.fillStyle = t.text; ctx.fillText(s.labels.outText, xr, y + 32);
}

/** The names and sizes under the tubes, drawn after the pipes, on a backing where a pipe passes behind. */
function drawCylLabels(ctx: CanvasRenderingContext2D, s: EngineScene, t: Tones, geo: Geo): void {
  const showS = geo.showS;
  const lx = cylLabelX(geo);
  const cLab = lx.c;
  const sLab = lx.s;
  const third = s.cb.owes || !showS;
  ctx.textAlign = 'center';
  ctx.fillStyle = MAT.labelBack;
  rr(ctx, cLab - 42, s.under - 12, 84, third ? 46 : 32, 8); ctx.fill();
  if (showS) { rr(ctx, sLab - 30, s.under - 12, 60, 32, 8); ctx.fill(); }
  ctx.font = `600 11.5px ${FONT}`; ctx.fillStyle = al(t.coinbase, 0.95); ctx.fillText(s.labels.cbName, cLab, s.under);
  ctx.font = `500 12px ${FONT}`; ctx.fillStyle = t.text2; ctx.fillText(s.labels.cbCoins, cLab, s.under + 14);
  if (third) { ctx.fillStyle = MAT.muted; ctx.fillText(s.labels.cbOwe, cLab, s.under + 28); }
  if (showS) {
    ctx.font = `600 11.5px ${FONT}`; ctx.fillStyle = t.strike; ctx.fillText(s.labels.skName, sLab, s.under);
    ctx.font = `500 12px ${FONT}`; ctx.fillStyle = t.text2; ctx.fillText(s.labels.skCoins, sLab, s.under + 14);
    if (sLab - cLab >= 86 || !s.sk.owes) { ctx.fillStyle = MAT.muted; ctx.fillText(s.labels.skOwe, sLab, s.under + 28); }
  }
}

/** The tags: the price rides the piston; the liquidation price sits under its line; the buffer between them, measured. */
function drawTags(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, geo: Geo, reduce: boolean): void {
  const x = s.tagX + 10;
  const yP = geo.yP;
  const hasFloor = s.cb.owes && geo.floorIn;
  const yF = geo.yF;
  const { py, ry, my } = tagHeights(yP, hasFloor ? yF : null, s.top, s.bot);
  ctx.textAlign = 'left';
  ctx.strokeStyle = wh(0.3); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(geo.right + 3, yP - 5); ctx.lineTo(x - 4, py - 3); ctx.stroke();
  ctx.font = `600 11px ${FONT}`; ctx.fillStyle = s.tried ? t.accent : MAT.muted; ctx.fillText(s.labels.priceTitle, x, py - 8);
  ctx.font = `700 14px ${FONT}`; ctx.fillStyle = t.text; ctx.fillText(s.labels.priceText, x, py + 6);
  m.tagRects.price = { x: x - 4, y: py - 20, w: s.tagW - 6, h: 30 };
  if (s.tried) {                                                        // the prototype's words; on a phone they would run off its edge, so they keep inside it
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = t.accent;
    ctx.fillText(s.labels.backHint, Math.min(x, s.W - 2 - ctx.measureText(s.labels.backHint).width), py - 26);
  } else if (!m.hinted && !reduce) {
    ctx.font = `600 11px ${FONT}`; ctx.fillStyle = al(t.accent, 0.55 + 0.4 * Math.sin(m.clock * 3.2)); ctx.fillText(s.labels.dragHint, x, py - 26);
  }
  m.tagRects.redtag = null;
  if (!hasFloor || ry === null) return;
  // a change of the loans just moved the line: the shift takes the tag's first line for a moment
  let ld = m.liqDelta;
  if (ld !== null) { ld.life -= (m.dtLast || 0.016) * 0.45; if (ld.life <= 0) { m.liqDelta = null; ld = null; } }
  if (ld !== null) {
    ctx.font = `700 11.5px ${FONT}`; ctx.fillStyle = al(ld.by < 0 ? t.green : MAT.liqRose, reduce ? 1 : Math.min(1, ld.life * 2)); ctx.fillText(liqShift(ld.by), x, ry);
  } else { ctx.font = `600 11px ${FONT}`; ctx.fillStyle = t.red; ctx.fillText(s.labels.liqTitle, x, ry); }
  ctx.font = `700 13px ${FONT}`; ctx.fillStyle = MAT.liqPink; ctx.fillText(s.labels.liqText, x, ry + 14);
  m.tagRects.redtag = { x: x - 4, y: ry - 11, w: s.tagW - 6, h: 28 };
  const tone = levelTone(t, s.cb.level);
  if (yF - yP > 8) {                                                    // the room between the two, as a measured gap
    const bx = geo.right + 6;
    ctx.strokeStyle = tone; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(bx - 3, yP + 2); ctx.lineTo(bx + 3, yP + 2); ctx.moveTo(bx, yP + 2); ctx.lineTo(bx, yF - 2); ctx.moveTo(bx - 3, yF - 2); ctx.lineTo(bx + 3, yF - 2); ctx.stroke();
  }
  if (my !== null) {
    ctx.font = `700 14px ${FONT}`; ctx.fillStyle = tone; ctx.fillText(s.labels.bufferText, x, my);
    const bwid = ctx.measureText(s.labels.bufferText).width;
    ctx.font = `500 11px ${FONT}`; ctx.fillStyle = MAT.muted;
    if (x + bwid + 5 + ctx.measureText(s.labels.bufferWord).width < s.W - 2) ctx.fillText(s.labels.bufferWord, x + bwid + 5, my);
    else if (ry - py > 62) ctx.fillText(s.labels.bufferWord, x, my + 13);
  }
}

/** A ring round the part whose card is open, and a dashed one round the part under a mouse. */
function drawRings(ctx: CanvasRenderingContext2D, s: EngineScene, m: EngineMotion, t: Tones, openPart: EnginePart | null): void {
  const rung = new Set<string>();
  for (let i = s.regions.length - 1; i >= 0; i--) {
    const hr = s.regions[i];
    if (!RING_IDS.has(hr.id) || rung.has(hr.id)) continue;
    const open = openPart !== null && hr.part === openPart;
    const hov = m.hover === hr.id && !m.held;
    if (!open && !hov) continue;
    rung.add(hr.id);
    const at = hr.id === 'price' ? m.tagRects.price ?? hr : hr.id === 'redtag' ? m.tagRects.redtag ?? hr : hr;
    ctx.strokeStyle = open ? al(t.accent, 0.9) : wh(0.28); ctx.lineWidth = open ? 1.4 : 1; ctx.setLineDash(open ? [] : [3, 3]);
    rr(ctx, at.x - 3, at.y - 3, at.w + 6, at.h + 6, 8); ctx.stroke(); ctx.setLineDash([]);
  }
}
