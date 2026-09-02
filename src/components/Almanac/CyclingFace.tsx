import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { runCyclingSim, CB_LIQUIDATION_PENALTY } from '../../simulation/cyclingSim';
import { plBandsAt, plConvergencePath, type PlBand } from '../../simulation/powerLaw';
import { accruedCbBalance, cbBarLevel } from '../../simulation/cbMetrics';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { LEVEL_COLOR } from '../../simulation/safetyView';
import { applyPriceLens, btcGained, holdingsSplit, clampMonth } from './cyclingFaceView';
import { SliderInput } from '../ui/SliderInput';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './CyclingFace.module.css';

/**
 * Almanac Cycling face — draw bills on Strike, refinance into Coinbase every N months, route every
 * purchase to the Coinbase collateral pool, stop drawing at a CB LTV cap. Verdict vs "never draw".
 *
 * 🔴 THE §2 CROSSING LIVES HERE, deliberately and visibly: this view imports the power law (a BELIEF)
 * AND the risk constants (FACTS), builds a plain `number[]` price path, and hands it to an engine that
 * has never heard of either. The same shape OutlookProjection/MonthBreakdown already use.
 *
 * READ-ONLY: zero store writes — not even a pin. Every control is seeded from the live plan and
 * overridden only in session-local state, so nothing here can touch the owner's numbers.
 */

// ⚠ FACE-LOCAL DEFAULT, NOT `cbLtvTriggerPct`. The owner's trigger (75%) is the PAYDOWN threshold — the
// point where the advisor routes income at Coinbase. This is a STOP-DRAWING cap: related policy, different
// action. Seeding from the trigger would also open the face on a run that LIQUIDATES at month 83, i.e. the
// default view would argue against the very strategy it exists to demonstrate. The owner's trigger is one
// tap away as a labelled preset instead.
const DEFAULT_CAP_PCT = 50;
const DEFAULT_CONVERGE_MONTHS = 48;   // one cycle
const DEFAULT_HORIZON_MONTHS = 60;
const DEFAULT_CYCLE_MONTHS = 3;

const BAND_META: { key: PlBand; label: string; color: string }[] = [
  { key: 'floor',   label: 'Floor',   color: 'var(--green)' },
  { key: 'fair',    label: 'Fair',    color: 'var(--btc)' },
  { key: 'ceiling', label: 'Ceiling', color: 'var(--amber)' },
];

interface Overlay {
  band?: PlBand;
  convergeMonths?: number;
  months?: number;
  income?: number;
  expenses?: number;
  cycleMonths?: number;
  cbLtvCapPct?: number;
  strikeAprPct?: number;
  cbAprPct?: number;
}

const fmtK = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? '−' : ''}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${n < 0 ? '−' : ''}$${Math.round(a / 1_000)}k`;
  return `${n < 0 ? '−' : ''}$${Math.round(a)}`;
};
const fmtSigned = (n: number): string => `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`;
const fmtBtc = (n: number): string => `${n.toFixed(4)} ₿`;
const fmtHorizon = (v: number): string => {
  const y = Math.floor(v / 12), m = v % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y}y ${m}m`;
};

interface TipItem { name?: string; dataKey?: string | number; value?: number; color?: string }
function ChartTip({ active, payload, label, money }: {
  active?: boolean; payload?: TipItem[]; label?: string | number; money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className={styles.tooltipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{money ? fmtUSD(p.value ?? 0) : `${(p.value ?? 0).toFixed(1)}%`}</strong>
        </div>
      ))}
    </div>
  );
}

export default function CyclingFace() {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    income: st.income,
    expenses: st.expenses,
    blocApr: st.blocApr,
    cbAprPct: st.cbAprPct,
    creditLine: st.creditLine,
    cbLtvTriggerPct: st.cbLtvTriggerPct,
    strikeCollateralBtc: st.getCurrentBtcHeld(),   // reading-anchored, Strike-only (v20)
    strikeBalance: st.advisorActualBlocBalance,
    cbCollateralBtc: st.cbCollateralBtc,
    cbLoanBalance: st.cbLoanBalance,
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
  })));

  const [overlay, setOverlay] = useState<Overlay>({});
  const set = <K extends keyof Overlay>(k: K, v: Overlay[K]) => setOverlay((o) => ({ ...o, [k]: v }));
  const dirty = Object.keys(overlay).length > 0;

  // Live seeds — every control reads `overlay[k] ?? live`, so nothing is ever written back.
  const band = overlay.band ?? 'fair';
  const convergeMonths = overlay.convergeMonths ?? DEFAULT_CONVERGE_MONTHS;
  const months = overlay.months ?? DEFAULT_HORIZON_MONTHS;
  const income = overlay.income ?? s.income;
  const expenses = overlay.expenses ?? s.expenses;
  const cycleMonths = overlay.cycleMonths ?? DEFAULT_CYCLE_MONTHS;
  const capPct = overlay.cbLtvCapPct ?? DEFAULT_CAP_PCT;
  const strikeAprPct = overlay.strikeAprPct ?? s.blocApr;
  const cbAprPct = overlay.cbAprPct ?? s.cbAprPct;

  // ⚠ UTC-midnight of the LOCAL calendar day — the repo's date-only convention. A local-midnight Date west
  // of UTC would land on the previous UTC day and shift every band value, making the path tz-dependent.
  const startDate = useMemo(() => new Date(todayLocalISO()), []);
  // The accrual boundary crossed HERE, so the engine stays clock-free (the EmergencyConsole pattern).
  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf],
  );

  const pricePath = useMemo(
    () => plConvergencePath(s.btcPrice, band, startDate, months, convergeMonths),
    [s.btcPrice, band, startDate, months, convergeMonths],
  );

  const sim = useMemo(() => runCyclingSim({
    pricePath,
    startYear: startDate.getUTCFullYear(),
    strikeCollateralBtc: s.strikeCollateralBtc,
    strikeBalance: s.strikeBalance,
    strikeCreditLine: s.creditLine,
    strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,
    strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,
    cbCollateralBtc: s.cbCollateralBtc,
    cbDebt,
    income, expenses, strikeAprPct, cbAprPct, cycleMonths,
    cbLtvCapPct: capPct,
  }), [
    pricePath, startDate, s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    cbDebt, income, expenses, strikeAprPct, cbAprPct, cycleMonths, capPct,
  ]);

  const { rows, last, stopMonth, liqMonth, strikeMarginMonth, creditExhaustedMonth } = sim;

  // ── Month scrubber + price lens (display-only) ────────────────────────────────────────────────
  const [selectedMonth, setSelectedMonth] = useState(rows.length - 1);
  const [lens, setLens] = useState(1);

  // ⚠ CLAMP AT RENDER TIME, NOT IN AN EFFECT. The Horizon slider is step=1, so ONE leftward tick shrinks
  // `rows` while `selectedMonth` still points past the end — rows[stale] would be undefined and
  // applyPriceLens would throw on row.price. An effect runs AFTER that render, far too late. Everything
  // below reads `monthIdx`/`selRow`; `rows[selectedMonth]` must never appear.
  const monthIdx = clampMonth(selectedMonth, rows.length);
  const selRow = rows[monthIdx] ?? last;
  const atEnd = monthIdx === rows.length - 1;
  const lensed = applyPriceLens(selRow, lens);
  const gained = btcGained(selRow, rows[0], lensed.price);

  // Write the clamped value back so re-growing the horizon doesn't snap to a stale index.
  useEffect(() => { setSelectedMonth((m) => Math.min(m, rows.length - 1)); }, [rows.length]);

  // Mirrors the sim memo's dep array — if an input is added to runCyclingSim, add it here too, or the lens
  // survives an engine change and silently reports a stress test against the wrong position. (`pricePath` is
  // memoized on btcPrice/band/months/convergeMonths/startDate, so those are subsumed.)
  useEffect(() => { setLens(1); }, [
    monthIdx,
    pricePath, cbDebt,
    s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    income, expenses, strikeAprPct, cbAprPct, cycleMonths, capPct,
  ]);

  const bands = plBandsAt(startDate);
  const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc;
  const openingDebt = cbDebt + s.strikeBalance;
  const wins = last.equity > sim.baselineEquity;
  const cagr = s.btcPrice > 0 && months > 0
    ? ((last.price / s.btcPrice) ** (12 / months) - 1) * 100
    : 0;

  // The shared CB gauge — but banded against CB_LLTV, the LTV this projection actually liquidates at.
  // (The dashboard's cbLiqFrac comes from the owner's entered liq price, a TODAY anchor that says nothing
  // about a position five years out.) The trigger boundary is still the owner's own setting.
  const cbZone = (ltv: number): string => LEVEL_COLOR[cbBarLevel(ltv, s.cbLtvTriggerPct, CB_LLTV)];

  const chartRows = useMemo(() => rows.map((r) => ({
    year: r.yearLabel,
    cbLtvPct: +(r.cbLtv * 100).toFixed(2),
    price: Math.round(r.price),
    collateral: Math.round(r.collateralValue),
    debt: Math.round(r.debt),
  })), [rows]);
  const tickEvery = Math.max(1, Math.floor(rows.length / 8));

  const milestones = [12, 24, 36, 60, 120].filter((m) => m <= months);

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Cycling</div>
        <div className={styles.framing}>Draw on Strike, refinance to Coinbase, never sell.</div>
      </div>

      <div className={styles.seedRow}>
        <span className={styles.seedLabel}>
          Seeded from your live plan · {fmtBtc(openingBtc)} against {fmtUSD(openingDebt)}
        </span>
        {dirty && (
          <button type="button" className={styles.ghostBtn} onClick={() => setOverlay({})}>Reset to live</button>
        )}
      </div>

      {/* 1 · PRICE PATH — the belief. data-gesture-exempt so a slider drag never pages the face. */}
      <section className={styles.card} data-gesture-exempt>
        <span className={styles.cardLabel}>Price path</span>
        <div className={styles.bandRow}>
          {BAND_META.map((b) => (
            <button
              key={b.key}
              type="button"
              className={`${styles.bandBtn} ${band === b.key ? styles.bandBtnOn : ''}`}
              style={band === b.key ? { borderColor: b.color, color: b.color } : undefined}
              onClick={() => set('band', b.key)}
            >
              {b.label}
            </button>
          ))}
        </div>
        <p className={styles.note}>
          Starts at today's live {fmtUSD(s.btcPrice)} and reverts toward the power-law{' '}
          <span style={{ color: BAND_META.find((b) => b.key === band)!.color }}>{band}</span> line —
          today at Floor {fmtK(bands.floor)} · Fair {fmtK(bands.fair)} · Ceiling {fmtK(bands.ceiling)}.
        </p>
        <div className={styles.sliderPair}>
          <SliderInput
            label="Reversion window" value={convergeMonths} onChange={(v) => set('convergeMonths', v)}
            min={12} max={120} step={1} display={fmtHorizon(convergeMonths)} minLabel="1 yr" maxLabel="10 yr"
          />
          <SliderInput
            label="Horizon" value={months} onChange={(v) => set('months', v)}
            min={12} max={240} step={1} display={fmtHorizon(months)} minLabel="1 yr" maxLabel="20 yr"
          />
        </div>
        <p className={styles.noteQuiet}>
          Implied <strong>{cagr.toFixed(1)}%</strong>/yr over {(months / 12).toFixed(1)} years.
        </p>
      </section>

      {/* 2 · VERDICT */}
      <div className={`${styles.verdict} ${liqMonth !== null ? styles.verdictBad : wins ? styles.verdictGood : styles.verdictWarn}`}>
        {liqMonth !== null ? (
          <>
            <div className={styles.verdictHead}>
              Liquidated at month {liqMonth} ({(liqMonth / 12).toFixed(1)} years)
            </div>
            <div className={styles.verdictSub}>
              Coinbase LTV reached {(CB_LLTV * 100).toFixed(0)}%. Morpho liquidates instantly — no cure
              window, {(CB_LIQUIDATION_PENALTY * 100).toFixed(2)}% penalty. It seized{' '}
              <strong>{fmtBtc(sim.seizedBtc ?? 0)}</strong>, leaving{' '}
              <strong>{fmtBtc(sim.survivorBtc ?? 0)}</strong>.
              {sim.deficiencyUsd !== null && (
                <> <strong className={styles.deficiency}>{fmtUSD(sim.deficiencyUsd)} of debt survives
                the liquidation.</strong> Both facilities are full-recourse.</>
              )}
            </div>
          </>
        ) : (
          <>
            <div className={styles.verdictHead}>
              {wins ? 'Cycling wins' : 'Cycling loses'} — {fmtSigned(last.equity - sim.baselineEquity)} equity
              vs paying bills from income
            </div>
            <div className={styles.verdictSub}>
              {fmtBtc(last.btcHeld)} vs {fmtBtc(sim.baselineBtc)} (
              {last.btcHeld - sim.baselineBtc >= 0 ? '+' : '−'}
              {Math.abs(last.btcHeld - sim.baselineBtc).toFixed(4)} ₿)
              {stopMonth !== null && ` · drawing stopped at month ${stopMonth}`}
            </div>
          </>
        )}
      </div>

      {/* 3 · STATS — six tiles follow the scrubber + lens; "Strike interest" cannot (see below). */}
      <div className={styles.statGrid}>
        {([
          ['BTC held', fmtBtc(selRow.btcHeld), `from ${openingBtc.toFixed(4)} ₿`, 'var(--green)'],
          ['Total debt', fmtK(selRow.debt), `from ${fmtK(openingDebt)}`, 'var(--orange)'],
          ['CB LTV', `${(lensed.cbLtv * 100).toFixed(1)}%`, `cap ${capPct}% · liq ${(CB_LLTV * 100).toFixed(0)}%`, cbZone(lensed.cbLtv)],
          ['Net equity', fmtK(lensed.equity),
            atEnd ? `never-draw: ${fmtK(sim.baselineEquity)}` : `at month ${monthIdx}`,
            atEnd ? (wins ? 'var(--green)' : 'var(--amber)') : (lensed.equity >= 0 ? 'var(--green)' : 'var(--red)')],
          ['BTC price', fmtK(lensed.price), `from ${fmtK(s.btcPrice)}`, BAND_META.find((b) => b.key === band)!.color],
          // Gross is price-independent (BTC counts); net is lensed, so it moves with the price lens.
          ['BTC gained', `${gained.gross >= 0 ? '+' : '−'}${Math.abs(gained.gross).toFixed(3)} ₿`,
            `net ${gained.net >= 0 ? '+' : '−'}${Math.abs(gained.net).toFixed(3)} ₿`,
            gained.gross >= 0 ? 'var(--green)' : 'var(--red)'],
          // ⚠ NOT month-scoped: CyclingRow carries no per-row cumulative interest, and adding one would be
          // an engine change. The sub-label says "full horizon" so it reads as the odd one out on purpose.
          ['Strike interest', fmtK(sim.totalStrikeInterest), `full horizon · ${(months / 12).toFixed(1)} yrs`, 'var(--text-secondary)'],
        ] as const).map(([label, value, sub, color]) => (
          <div key={label} className={styles.stat}>
            <span className={styles.cardLabel}>{label}</span>
            <div className={styles.statValue} style={{ color }}>{value}</div>
            <div className={styles.statSub}
              style={label === 'BTC gained' ? { color: gained.net >= 0 ? 'var(--green)' : 'var(--red)' } : undefined}>
              {sub}
            </div>
          </div>
        ))}
      </div>

      {/* 3b · SCRUBBER + LENS — ⚠ ONE gesture-exempt card: without it a horizontal slider drag pages the
          Almanac to the next face (AlmanacView's shouldStart refuses the pager only for exempt targets). */}
      <section className={styles.card} data-gesture-exempt>
        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>Inspect month</span>
          <span className={styles.scrubValue}>
            {monthIdx === 0 ? 'today' : `month ${monthIdx} · ${(monthIdx / 12).toFixed(1)} yr`}
            {selRow.postLiquidation && <span className={styles.msFlag}> post-liq</span>}
          </span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0} max={Math.max(0, rows.length - 1)} step={1} value={monthIdx}
          onChange={(e) => setSelectedMonth(Number(e.target.value))}
          aria-label="Inspect month"
        />

        <div className={styles.scrubHead}>
          <span className={styles.cardLabel}>Price stress</span>
          <span className={styles.scrubValue}>
            {lens === 1 ? 'as modeled' : (
              <>
                {fmtUSD(lensed.price)}{' '}
                <span style={{ color: lens > 1 ? 'var(--green)' : 'var(--red)' }}>
                  {lens > 1 ? '+' : '−'}{Math.abs((lens - 1) * 100).toFixed(0)}%
                </span>
              </>
            )}
          </span>
        </div>
        <input
          type="range" className={styles.scrub}
          min={0.35} max={2.2} step={0.01} value={lens}
          onChange={(e) => setLens(Number(e.target.value))}
          aria-label="Price stress multiplier"
        />
        <p className={styles.noteQuiet}>
          Re-prices this month only — the projection and the charts never move. Resets when you change the
          month or any input.
        </p>
      </section>

      {/* 3c · HOLDINGS BY VENUE — two venues; a cold-storage reserve is not modeled. */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Holdings by venue</span>
        {(() => {
          const h = holdingsSplit(selRow);
          const pct = (n: number) => (h.combined > 0 ? (n / h.combined) * 100 : 0);
          return (
            <>
              <div className={styles.venueBar}>
                <span className={styles.venueSegStrike} style={{ width: `${pct(h.strike)}%` }} />
                <span className={styles.venueSegCb} style={{ width: `${pct(h.coinbase)}%` }} />
              </div>
              <div className={styles.venueRow}>
                <span className={styles.venueDotStrike} />
                <span className={styles.venueName}>Strike</span>
                <span className={styles.venueBtc}>{h.strike.toFixed(4)} ₿</span>
                <span className={styles.venueUsd}>{fmtK(h.strike * lensed.price)}</span>
              </div>
              <div className={styles.venueRow}>
                <span className={styles.venueDotCb} />
                <span className={styles.venueName}>Coinbase</span>
                <span className={styles.venueBtc}>{h.coinbase.toFixed(4)} ₿</span>
                <span className={styles.venueUsd}>{fmtK(h.coinbase * lensed.price)}</span>
              </div>
              <div className={`${styles.venueRow} ${styles.venueCombined}`}>
                <span className={styles.venueDotNone} />
                <span className={styles.venueName}>Combined</span>
                <span className={styles.venueBtc}>{h.combined.toFixed(4)} ₿</span>
                <span className={styles.venueUsd}>{fmtK(h.combined * lensed.price)}</span>
              </div>
            </>
          );
        })()}
      </section>

      {/* 4 · CB LTV */}
      <section className={styles.card}>
        <span className={styles.cardLabel}>Coinbase LTV over time</span>
        <ResponsiveContainer width="100%" height={210}>
          <LineChart data={chartRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
            <CartesianGrid stroke="var(--line-2)" strokeDasharray="2 4" />
            <XAxis dataKey="year" stroke="var(--text-faint)" tick={{ fontSize: 9 }} interval={tickEvery} />
            <YAxis stroke="var(--text-faint)" tick={{ fontSize: 9 }} domain={[0, 100]} />
            <Tooltip content={<ChartTip />} />
            <ReferenceLine y={CB_LLTV * 100} stroke="var(--red)" strokeDasharray="4 3"
              label={{ value: `LIQ ${(CB_LLTV * 100).toFixed(0)}%`, fill: 'var(--red)', fontSize: 9, position: 'insideTopRight' }} />
            <ReferenceLine y={capPct} stroke="var(--amber)" strokeDasharray="4 3"
              label={{ value: `CAP ${capPct}%`, fill: 'var(--amber)', fontSize: 9, position: 'insideBottomRight' }} />
            {/* ⚠ The `cond && <Element/>` form is required, NOT a fragment. Recharts walks its DIRECT
                children to discover series/reference lines; a fragment wrapper makes it render axes and
                grid with no lines and no error. `&&` yields a single element or `false`, both of which
                recharts handles. Never wrap conditional chart children in <>…</>. */}
            {stopMonth !== null && <ReferenceLine x={rows[stopMonth]?.yearLabel} stroke="var(--text-faint)" strokeDasharray="2 2" />}
            {liqMonth !== null && <ReferenceLine x={rows[liqMonth]?.yearLabel} stroke="var(--red)" />}
            <Line type="monotone" dataKey="cbLtvPct" name="CB LTV" stroke="var(--btc)" strokeWidth={2}
              dot={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </section>

      {/* 5 · PAIRED CHARTS */}
      <div className={styles.pair}>
        <section className={styles.card}>
          <span className={styles.cardLabel}>BTC price path</span>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="var(--line-2)" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="var(--text-faint)" tick={{ fontSize: 9 }} interval={tickEvery} />
              <YAxis stroke="var(--text-faint)" tick={{ fontSize: 9 }} tickFormatter={fmtK} width={52} />
              <Tooltip content={<ChartTip money />} />
              <Line type="monotone" dataKey="price" name="BTC" isAnimationActive={false} dot={false}
                strokeWidth={2} stroke={BAND_META.find((b) => b.key === band)!.color} />
            </LineChart>
          </ResponsiveContainer>
        </section>
        <section className={styles.card}>
          <span className={styles.cardLabel}>Collateral value vs debt</span>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartRows} margin={{ top: 10, right: 8, left: -14, bottom: 0 }}>
              <CartesianGrid stroke="var(--line-2)" strokeDasharray="2 4" />
              <XAxis dataKey="year" stroke="var(--text-faint)" tick={{ fontSize: 9 }} interval={tickEvery} />
              <YAxis stroke="var(--text-faint)" tick={{ fontSize: 9 }} tickFormatter={fmtK} width={52} />
              <Tooltip content={<ChartTip money />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Line type="monotone" dataKey="collateral" name="Collateral" stroke="var(--green)"
                strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="debt" name="Debt" stroke="var(--red)"
                strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </section>
      </div>

      {/* 6 · CONTROLS */}
      <div className={styles.pair}>
        <section className={styles.card} data-gesture-exempt>
          <span className={styles.cardLabel}>Cash flow</span>
          <div className={styles.sliderStack}>
            <SliderInput label="Monthly income" value={income} onChange={(v) => set('income', v)}
              min={0} max={20000} step={100} display={fmtUSD(income)} minLabel="$0" maxLabel="$20k" />
            <SliderInput label="Monthly bills (drawn)" value={expenses} onChange={(v) => set('expenses', v)}
              min={0} max={20000} step={100} display={fmtUSD(expenses)} minLabel="$0" maxLabel="$20k" />
          </div>
          <p className={styles.noteQuiet}>Surplus {fmtUSD(Math.max(0, income - expenses))}/mo buys bitcoin.</p>
        </section>
        <section className={styles.card} data-gesture-exempt>
          <span className={styles.cardLabel}>Strategy</span>
          <div className={styles.sliderStack}>
            <SliderInput label="Refinance cycle" value={cycleMonths} onChange={(v) => set('cycleMonths', v)}
              min={1} max={12} step={1} display={`${cycleMonths} mo`} minLabel="1 mo" maxLabel="12 mo" />
            <SliderInput label="CB LTV stop" value={capPct} onChange={(v) => set('cbLtvCapPct', v)}
              min={20} max={85} step={1} display={`${capPct}%`} minLabel="20%" maxLabel="85%" />
          </div>
          <div className={styles.presetRow}>
            <button type="button" className={styles.ghostBtn} onClick={() => set('cbLtvCapPct', s.cbLtvTriggerPct)}>
              Use my paydown trigger ({s.cbLtvTriggerPct}%)
            </button>
          </div>
          <p className={styles.noteQuiet}>
            Your trigger is when the advisor routes income at Coinbase — a different action from stopping
            the draw, so this cap starts at {DEFAULT_CAP_PCT}%.
          </p>
        </section>
      </div>

      <section className={styles.card} data-gesture-exempt>
        <span className={styles.cardLabel}>Rates (both variable in reality)</span>
        <div className={styles.sliderPair}>
          <SliderInput label="Strike APR" value={strikeAprPct} onChange={(v) => set('strikeAprPct', v)}
            min={0} max={25} step={0.25} display={`${strikeAprPct}%`} minLabel="0%" maxLabel="25%" />
          <SliderInput label="Coinbase APR" value={cbAprPct} onChange={(v) => set('cbAprPct', v)}
            min={0} max={20} step={0.25} display={`${cbAprPct}%`} minLabel="0%" maxLabel="20%" />
        </div>
      </section>

      {/* 7 · CONSTRAINTS + MILESTONES */}
      {(creditExhaustedMonth !== null || strikeMarginMonth !== null) && (
        <div className={styles.constraints}>
          {creditExhaustedMonth !== null && (
            <div>
              Strike credit exhausted at month {creditExhaustedMonth} —{' '}
              {fmtUSD(rows[creditExhaustedMonth].strikeShortfall)}/mo of bills funded from income thereafter.
            </div>
          )}
          {strikeMarginMonth !== null && (
            <div>
              Strike LTV crosses {(STRIKE_MARGIN_CALL_LTV * 100).toFixed(0)}% at month {strikeMarginMonth} —
              margin-call territory on the Strike leg.
            </div>
          )}
        </div>
      )}

      <section className={styles.card}>
        <span className={styles.cardLabel}>Milestones</span>
        <div className={styles.msWrap} data-gesture-exempt>
          <table className={styles.msTable}>
            <thead>
              <tr>
                <th className={`${styles.msTh} ${styles.msYear}`}>Year</th>
                <th className={styles.msTh}>Price</th>
                <th className={styles.msTh}>BTC</th>
                <th className={styles.msTh}>Debt</th>
                <th className={styles.msTh}>CB LTV</th>
                <th className={styles.msTh}>Equity</th>
                <th className={styles.msTh}>BTC gained</th>
              </tr>
            </thead>
            <tbody>
              {milestones.map((m) => {
                const r = rows[m];
                if (!r) return null;
                // UNLENSED — the table is not a lensed surface; only the tile above follows the lens.
                const g = btcGained(r, rows[0]);
                return (
                  <tr key={m} className={r.postLiquidation ? styles.msPost : undefined}>
                    <td className={`${styles.msTd} ${styles.msYear}`}>
                      {Number.isInteger(m / 12) ? m / 12 : (m / 12).toFixed(1)}
                      {r.postLiquidation && <span className={styles.msFlag}> post-liq</span>}
                    </td>
                    <td className={styles.msTd}>{fmtK(r.price)}</td>
                    <td className={styles.msTd}>
                      <span className={styles.btcPre}>₿</span>{r.btcHeld.toFixed(3)}
                    </td>
                    <td className={styles.msTd}>{fmtK(r.debt)}</td>
                    <td className={styles.msTd} style={{ color: cbZone(r.cbLtv) }}>
                      {(r.cbLtv * 100).toFixed(1)}%
                    </td>
                    <td className={`${styles.msTd} ${styles.msEquity}`}>{fmtK(r.equity)}</td>
                    {/* Gross = BTC accumulated. Net = what survives the debt. On a post-liquidation row
                        net drops hard — shown, never clamped. */}
                    <td className={styles.msTd}>
                      <div className={styles.gainGross}>
                        {g.gross >= 0 ? '+' : '−'}{Math.abs(g.gross).toFixed(3)}
                      </div>
                      <div className={styles.gainNet}
                        style={{ color: g.net >= 0 ? 'var(--green)' : 'var(--red)' }}>
                        {g.net >= 0 ? '+' : '−'}{Math.abs(g.net).toFixed(3)} net
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className={styles.disclaimer}>
        <strong>A pattern, not a forecast.</strong> The power law is a historical regression, not a
        guarantee. Personal ₿LOC deliberately firewalls it from all risk math — liquidation thresholds never
        import projection data. Treat the bands as scenarios to stress-test against, never as expected
        outcomes. Both facilities are full-recourse; Morpho liquidates instantly at{' '}
        {(CB_LLTV * 100).toFixed(0)}% LLTV with no cure window. Not financial advice.
      </div>
    </div>
  );
}
