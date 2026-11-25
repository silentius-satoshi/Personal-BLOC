import { describe, it, expect, vi, afterEach } from 'vitest';
import { LEVEL_COLOR, deriveSafetyView, type SafetyViewInputs } from '../../../simulation/safetyView';
import { MAT, wh } from '../enginePalette';
import { TAPE_MS, engineScene, type EngineFacts, type EngineMonthRow, type TapePoint } from '../engineScene';
import { drawFrame, gaugeTone, needleAt, newMotion, readBoxX, readPoint, type Tones } from '../engineDraw';
import { readoutPrice, readoutTime } from '../engineView';

/**
 * ⚠ The Engine · Micro's drawing (BL61, step 1; v1.5). It computes no figure of the loans (engineWiring LAYERS), but two
 * of its choices are the Dashboard's to make, so they are pinned here: where the gauge's needle points, and the colour of
 * its figure — as functions and as drawn. And every state of the loans draws: no infinite or NaN number reaches the
 * canvas, moving or still. A canvas that draws nothing and notes each call stands in for the real one. Synthetic, round
 * figures (this repo is public). Each assertion carries its tag.
 */

/** $50,000 on 1 ₿ at Coinbase (10% APR, no as-of date, so nothing accrues), $10,000 on 0.5 ₿ at Strike, $100,000. */
const INPUTS: SafetyViewInputs = {
  advisorActualBlocBalance: 10_000, creditLine: 25_000, currentBtcHeld: 0.5, btcPrice: 100_000,
  strikeLiquidationLtvPct: 85, hasCbLoan: true, cbLoanBalance: 50_000, cbAprPct: 10, cbLoanBalanceAsOf: null,
  cbCollateralBtc: 1, cbLtvTriggerPct: 75, cbLiquidationPrice: 0, cbLiquidationPriceAsOf: null,
  cbLimitAtSupport: 0.45, supportToday: 60_000,
};
const ROW: EngineMonthRow = {
  strikeInterestUsd: 100, strikeDrawn: 3_000, strikeRepaidUsd: 200, cbRepaidUsd: 300, strikeMinPaidUsd: 40, cashToCureUsd: 0,
  refinancedFeeUsd: 0,
};
const NOW = Date.UTC(2026, 10, 23);   // 23 Nov 2026
const CANDLES = Array.from({ length: 61 }, (_, i) => ({ t: NOW - (60 - i) * 60_000, price: 99_000 + i * 20 }));
const facts = (s: Partial<SafetyViewInputs> = {}, o: Partial<EngineFacts> = {}): EngineFacts => ({
  safety: { ...INPUTS, ...s }, month: ROW, moveBringsCbWithin: false, cycle: null, candles: CANDLES, feed: 'manual',
  livePrice: null, liveAt: null, ...o,
});
const TONES: Tones = {
  green: '#00ff00', amber: '#ffaa00', red: '#ff0000', btc: '#ff9900', text: '#ffffff', text2: '#aaaaaa', accent: '#ff6600',
  coinbase: '#0055ff', strike: '#aa00ff', card: '#111111', border: '#222222',
};

/** Every state a loan can be in, today or tried — among them the ones that broke the gauge and the charge in v1.4. */
const STATES: [name: string, safety: Partial<SafetyViewInputs>, tried: number | null, o?: Partial<EngineFacts>][] = [
  ['today', {}, null],
  ['live', {}, null, { feed: 'live', livePrice: 100_100, liveAt: NOW + 90_000 }],
  ['tried under the line', {}, 53_000],
  ['tried far under it (a level near 12)', {}, 4_000],
  ['tried far over it', {}, 1_700_000],
  ['no coins behind the debt', { cbCollateralBtc: 0 }, null],
  ['no coins, a liquidation price entered', { cbCollateralBtc: 0, cbLiquidationPrice: 60_000 }, null],
  ['nothing owed', { cbLoanBalance: 0 }, null],
  ['no loan', { hasCbLoan: false }, null],
  ['Strike owed, no Strike coins', { currentBtcHeld: 0 }, null],
  ['nothing anywhere', { cbLoanBalance: 0, cbCollateralBtc: 0, currentBtcHeld: 0, advisorActualBlocBalance: 0 }, null],
];

interface Call { k: string; args: readonly unknown[]; fill: unknown; stroke: unknown; width: unknown }

/** A canvas that draws nothing and notes every call: a number that isn't finite, or a colour made of one, is a fault;
 *  with a log, each call is kept with the fill, stroke and line width it was made under. */
function recorder(faults: string[], count: { n: number }, log?: Call[]): CanvasRenderingContext2D {
  const props: Record<string, unknown> = {};
  const note = (k: string, args: readonly unknown[]): void => {
    count.n++;
    log?.push({ k, args, fill: props.fillStyle, stroke: props.strokeStyle, width: props.lineWidth });
    for (const a of args) {
      if ((typeof a === 'number' && !Number.isFinite(a)) || (typeof a === 'string' && /NaN|Infinity/.test(a))) {
        faults.push(`${k}(${args.map((x) => (typeof x === 'object' ? 'object' : String(x))).join(', ')})`);
        return;
      }
    }
  };
  const gradient = { addColorStop: (...a: unknown[]): void => note('addColorStop', a) };
  return new Proxy(props, {
    get(target, k) {
      if (typeof k !== 'string') return undefined;
      if (k in target) return target[k];
      if (k === 'measureText') return (text: string) => ({ width: String(text).length * 6 });
      if (k.startsWith('create')) return (...a: unknown[]) => { note(k, a); return gradient; };
      return (...a: unknown[]): void => note(k, a);
    },
    set(target, k, v) {
      if (typeof k === 'string') { note(`${k} =`, [v]); target[k] = v; }
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}
const offscreen = (faults: string[], count: { n: number }): void => {
  vi.stubGlobal('document', { createElement: () => ({ width: 0, height: 0, getContext: () => recorder(faults, count) }) });
};

describe('⭐ the drawing\'s two choices and its numbers', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('⭐ GAUGE — the needle rests on its dial and trembles within it; its figure wears the Dashboard\'s bar colour, in every state — as drawn too (v1.5)', () => {
    // the canvas reads these from the tokens the Dashboard's LEVEL_COLOR names (engineWiring TOKENS)
    const VARS: Tones = { ...TONES, green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)' };
    const clocks = Array.from({ length: 61 }, (_, i) => i / 60);   // a second at 60 frames, from the first (clock 0)
    const reached = new Set<string>();
    for (const [name, s, tried, o] of STATES) {
      const sc = engineScene(facts(s, o), 390, tried);
      const v = deriveSafetyView({ ...INPUTS, ...s, btcPrice: sc.price });
      const gf = sc.gaugeFig;
      // the needle: moving, within (rest − 0.6) × 0.012 of its rest past 60%, and so on the dial; still, at its rest.
      // Mutation: the tremble on the level itself (v1.4) → red: NaN at clock 0 with no coins, a swing far past the dial
      const amp = gf.needle > 0.6 ? (gf.needle - 0.6) * 0.012 : 0;
      for (const c of clocks) {
        const p = needleAt(gf, gf.needle, c, false);
        expect(Number.isFinite(p) && Math.abs(p - gf.needle) <= amp + 1e-12, `GAUGE ${name}: the needle trembles on its dial at ${c} s`).toBe(true);
        expect(needleAt(gf, gf.needle, c, true), `GAUGE ${name}: still under reduced motion`).toBe(gf.needle);
      }
      // the figure: the Dashboard's bar colour — SafetyDashboard's LEVEL_COLOR[cbLevel] — whenever the loan is on; grey
      // with none. Mutation: an infinite level's figure green, whatever the bar says → red
      expect(gaugeTone(VARS, gf), `GAUGE ${name}: the bar's colour`).toBe(gf.loan ? LEVEL_COLOR[v.cbLevel] : MAT.muted);

      // …and the drawing draws them: after a few frames, the figure in that colour and the needle's tip where needleAt
      // puts it. Mutation: drawGauge's own colour (v1.4's `s.cb.owes ? … : t.green`) or its own tremble (v1.4's) → red
      const faults: string[] = [];
      const count = { n: 0 };
      offscreen(faults, count);
      const m = newMotion();
      let log: Call[] = [];
      for (let f = 0; f < 10; f++) {
        log = [];
        drawFrame(recorder(faults, count, log), sc, m, TONES, { ts: 1_000 + f * 17, now: NOW + 60_000, dpr: 2, reduce: false, openPart: null });
      }
      const { cx, cy, r } = sc.gauge;
      const fig = log.filter((c) => c.k === 'fillText' && c.args[0] === sc.labels.gaugeText && c.args[1] === cx && c.args[2] === cy + r * 0.66);
      expect(fig.map((c) => c.fill), `GAUGE ${name}: the figure, drawn once, in the bar's colour`).toEqual([gaugeTone(TONES, gf)]);
      const tip = log.filter((c) => c.k === 'lineTo' && c.stroke === TONES.text && c.width === 2.6);
      expect(tip.length, `GAUGE ${name} premise: the needle drawn once`).toBe(1);
      const a0 = Math.PI * 0.75;
      const na = a0 + (Math.PI * 2.25 - a0) * Math.max(0, Math.min(1, needleAt(gf, m.gauge, m.clock, false)));
      expect(m.clock, `GAUGE ${name} premise: the picture has moved`).toBeGreaterThan(0.1);
      expect(tip[0].args[0] as number, `GAUGE ${name}: the needle's tip, x`).toBeCloseTo(cx + Math.cos(na) * r * 0.78, 9);
      expect(tip[0].args[1] as number, `GAUGE ${name}: the needle's tip, y`).toBeCloseTo(cy + Math.sin(na) * r * 0.78, 9);

      if (!Number.isFinite(v.cbLtv)) reached.add('infinite');
      if (Number.isFinite(v.cbLtv) && v.cbLtv > 1) reached.add('past the dial');
      if (gf.loan && !sc.cb.owes && v.cbLevel === 'act') reached.add('Poor with no line');
      if (!gf.loan) reached.add('no loan');
    }
    expect([...reached].sort(), 'GAUGE premise: the states that broke in v1.4 are reached, and the loan off')
      .toEqual(['Poor with no line', 'infinite', 'no loan', 'past the dial'].sort());
  });

  it('⭐ FINITE — every state draws: no infinite or NaN number, nor a colour made of one, reaches the canvas, moving or still (v1.5)', () => {
    for (const [name, s, tried, o] of STATES) {
      for (const reduce of [false, true]) {
        for (const warm of [false, true]) {
          const faults: string[] = [];
          const count = { n: 0 };
          offscreen(faults, count);
          const today = engineScene(facts(), 390, null);
          const sc = engineScene(facts(s, o), 390, tried);
          const m = newMotion();
          const ctx = recorder(faults, count);
          // from the first frame (clock 0), or from today's picture half a second in — the loans moving to this state; the
          // tape read out under a mouse from the second half second, and a finger's readout pinned from the third
          for (let f = 0; f < 90; f++) {
            if (f === 30) m.read = { x: sc.tape.x + sc.tape.w / 2, at: null };
            if (f === 60) m.read = { x: sc.tape.x + 20, at: NOW + 60_000 - 10 * 60_000 };
            drawFrame(ctx, warm && f < 30 ? today : sc, m, TONES, { ts: 1_000 + f * 17, now: NOW + 60_000 + f * 17, dpr: 2, reduce, openPart: null });
          }
          const how = `${name}${reduce ? ', reduced motion' : ''}${warm ? ', from today' : ''}`;
          expect(count.n, `FINITE premise: ${how} draws`).toBeGreaterThan(1_000);
          // Mutation: the needle's tremble on the level (v1.4) → NaN on the first frame with no coins → red; the charge's
          // shake on an infinite level (v1.4) → its particles at ±∞ with no coins and a liquidation price entered → red
          expect(faults.slice(0, 3), `FINITE ${how}: no infinite or NaN number reaches the canvas`).toEqual([]);
        }
      }
    }
  });

  it('⭐ READOUT — the tape reads out as the Dashboard\'s chart: the nearest price, a line, a dot and a box beside it; a finger\'s stays on its moment as the tape moves on (2026-11-25)', () => {
    // the snap: the nearest of the tape's prices from its left edge on, and the pen; none before the edge
    const P: TapePoint[] = [{ t: 0, p: 1 }, { t: 60, p: 2 }, { t: 120, p: 3 }];
    const pen = { t: 200, p: 9 };
    expect([29, 31, 89, 95, 161, 170, 260].map((at) => readPoint(P, pen, at, 0)?.p), 'READOUT the nearest, the pen too').toEqual([1, 2, 2, 3, 9, 9, 9]);
    expect(readPoint(P, pen, 70, 61)?.p, 'READOUT none left of the edge: the next').toBe(3);
    expect(readPoint(P, pen, 40, 61), 'READOUT a moment the tape has moved past: none').toBe(null);
    expect(readPoint([], pen, 50, 0)?.p, 'READOUT the pen alone').toBe(9);
    // the box: 10 px right of its line, or left of it where the chart ends, inside the chart either way
    expect([readBoxX(100, 80, 8, 300), readBoxX(250, 80, 8, 300), readBoxX(20, 280, 8, 300)], 'READOUT the box beside its line').toEqual([110, 160, 12]);

    // as drawn: a mouse a little right of a minute's close, over the tape's middle
    const sc = engineScene(facts(), 390, null);
    const now = NOW + 60_000;
    const faults: string[] = [];
    const count = { n: 0 };
    offscreen(faults, count);
    const m = newMotion();
    const frame = (at: number): Call[] => {
      const log: Call[] = [];
      drawFrame(recorder(faults, count, log), sc, m, TONES, { ts: 1_000 + (at - now) / 10, now: at, dpr: 2, reduce: false, openPart: null });
      return log;
    };
    for (let f = 0; f < 3; f++) frame(now);
    const c = m.chart!;
    expect(c, 'READOUT premise: the chart as drawn').not.toBe(null);
    expect(frame(now).some((q) => q.k === 'fillText' && String(q.args[0]).startsWith('BTC : ')), 'READOUT premise: none until asked').toBe(false);
    const x = c.x0 + (c.x1 - c.x0) / 2 + 3;
    m.read = { x, at: null };
    const want = c.t0 + (x - c.x0) / (c.x1 - c.x0) * c.span;
    const pts = sc.tapePrices.closes.filter((q) => q.t >= now - TAPE_MS - 90e3);
    const q = readPoint(pts, { t: now, p: sc.realPrice }, want, c.t0)!;
    expect(Math.abs(q.t - want), 'READOUT premise: off the close by seconds, not on it').toBeGreaterThan(5_000);
    const qx = c.x0 + (q.t - c.t0) / c.span * (c.x1 - c.x0);
    const lineTone = MAT.faint;   // a manual price: the tape's line is the paint's faint grey, as the prototypes draw it held
    expect(sc.feed, 'READOUT premise: a held price').toBe('manual');
    const drawn = (log: Call[]) => ({
      line: log.filter((k) => k.k === 'moveTo' && k.stroke === wh(0.7)).map((k) => k.args[0] as number),
      dot: log.filter((k) => k.k === 'arc' && k.args[2] === 4 && k.fill === lineTone && k.stroke === wh(1)).map((k) => k.args[0] as number),
      text: log.filter((k) => k.k === 'fillText' && (k.args[0] === readoutTime(q.t) || k.args[0] === readoutPrice(q.p))).map((k) => [k.args[0], k.fill]),
      box: log.filter((k) => k.k === 'fill' && k.fill === TONES.card).length,
    });
    // Mutation: the line at the pointer, not the price → red; the time or the price off the snapped point → red
    const a = drawn(frame(now));
    expect(a.line.length, 'READOUT one line').toBe(1);
    expect(a.line[0], 'READOUT the line at the nearest price, not under the pointer').toBeCloseTo(qx, 9);
    expect(a.dot, 'READOUT the dot on it, in the line\'s colour, ringed').toHaveLength(1);
    expect(a.dot[0], 'READOUT the dot\'s place').toBeCloseTo(qx, 9);
    expect(a.text, 'READOUT the box: the moment, then the price in the line\'s colour').toEqual([[readoutTime(q.t), TONES.text], [readoutPrice(q.p), lineTone]]);
    expect(a.box, 'READOUT the box on the card\'s colour').toBe(1);
    // a finger lets go there: pinned to its moment, it rides the tape as it moves on — five minutes on, further left by
    // five minutes of tape. Mutation: a pinned readout drawn where the finger was → red
    m.read = { x, at: q.t };
    const later = now + 5 * 60_000;
    const b = drawn(frame(later));
    const c2 = m.chart!;
    expect(b.text, 'READOUT pinned: the same price').toEqual(a.text);
    expect(b.line[0], 'READOUT pinned: it rides the tape').toBeCloseTo(c2.x0 + (q.t - c2.t0) / c2.span * (c2.x1 - c2.x0), 9);
    expect(a.line[0] - b.line[0], 'READOUT pinned: five minutes further left').toBeGreaterThan(20);
    // …until its moment leaves the tape: gone. Mutation: kept → red
    frame(q.t + TAPE_MS + 5 * 60_000);
    expect(m.read, 'READOUT past the tape\'s left edge: gone').toBe(null);
    // the box flips at the chart's right end, inside the chart. Mutation: always to the right → red
    m.read = { x: c.x1 - 2, at: null };
    const edge = frame(now).filter((k) => k.k === 'fillText' && String(k.args[0]).startsWith('BTC : '));
    expect(edge, 'READOUT premise: at the right end').toHaveLength(1);
    expect(edge[0].args[1] as number, 'READOUT the box flips left of its line').toBeLessThan(c.x1 - 20);
    expect(faults, 'READOUT no infinite or NaN number').toEqual([]);
  });
});
