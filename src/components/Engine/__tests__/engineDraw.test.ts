import { describe, it, expect, vi, afterEach } from 'vitest';
import { LEVEL_COLOR, deriveSafetyView, type SafetyViewInputs } from '../../../simulation/safetyView';
import { MAT } from '../enginePalette';
import { engineScene, type EngineFacts, type EngineMonthRow } from '../engineScene';
import { drawFrame, gaugeTone, needleAt, newMotion, type Tones } from '../engineDraw';

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
  coinbase: '#0055ff', strike: '#aa00ff',
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
          // from the first frame (clock 0), or from today's picture half a second in — the loans moving to this state
          for (let f = 0; f < 90; f++) {
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
});
