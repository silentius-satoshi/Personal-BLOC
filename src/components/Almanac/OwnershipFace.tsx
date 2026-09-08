import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, Legend,
} from 'recharts';
import { useStore } from '../../store/useStore';
import { runCyclingSim, CB_LIQUIDATION_PENALTY, type CyclingMode } from '../../simulation/cyclingSim';
import { plBandsAt, plConvergencePath, PL_BAND_LABEL, type PlBand } from '../../simulation/powerLaw';
import { accruedCbBalance, cbBarLevel, barLevel } from '../../simulation/cbMetrics';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { STRIKE_MAX_DRAW_LTV, strikeAvailableCredit } from '../../simulation/strikeCredit';
import { STRIKE_MARGIN_CALL_LTV } from '../../simulation/emergencyModel';
import { LEVEL_COLOR, CREDIT_WARN_USED, CREDIT_ACT_USED } from '../../simulation/safetyView';
import { deriveOwnership } from '../../simulation/ownership';
import { deriveCbCollateral } from '../../simulation/logUtils';
import { applyPriceLens, clampMonth, holdingsSplit } from './cyclingFaceView';
import { ownershipGained, chartOwnershipRows } from './ownershipFaceView';
import { SliderInput } from '../ui/SliderInput';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './OwnershipFace.module.css';

/**
 * Almanac Ownership face (S3) — the same engine as the Cycling face, under the ownership wrapper:
 * the hero is YOURS in bitcoin, and every surface reads held · owed · yours rather than LTV first.
 *
 * READ-ONLY by construction: zero store writes. Every control is seeded from the live plan and
 * overridden only in session-local `overlay` state (the CyclingFace pattern).
 *
 * 🔴 THE §2 CROSSING LIVES HERE (as in CyclingFace): this view imports the power law (a BELIEF) AND the
 * risk constants (FACTS), builds a plain number[] price path, and hands it to an engine that has heard
 * of neither. Neither wall moves.
 *
 * C2: when the stop-draw cap sits at/below the OPENING CB LTV the draw never runs — "cycling"
 * degenerates into refinancing the legacy Strike balance at the cheaper rate (pure rate arbitrage), so a
 * mode comparison at that cap measures the refinance, not the strategy. The notice surfaces it.
 *
 * C1: in a no-draw mode with expenses > income, the deficit is funded by NOTHING (no coins sold, no
 * debt grown) — the deliberate approximation, surfaced as a constraint notice rather than modeled away.
 *
 * C3: `hold` IS the never-draw baseline, so no baseline comparison renders in that mode.
 */

// ⚠ REVIEW-AUTHORITATIVE DEFAULT: 50 — below the opening CB LTV of the live seed (50.58%), so the C2
// degenerate notice shows at default and clears once the cap is raised above it.
const DEFAULT_CAP_PCT = 50;
const DEFAULT_CONVERGE_MONTHS = 60;
const DEFAULT_HORIZON_MONTHS = 24;
const DEFAULT_CYCLE_MONTHS = 1;      // monthly refinance — the review's "monthly cadence"
const DEFAULT_PATH: 'fair' = 'fair';

const BAND_META: { key: PlBand; label: string; color: string }[] = [
  { key: 'floor',   label: `To ${PL_BAND_LABEL.floor.toLowerCase()}`,   color: 'var(--green)' },
  { key: 'fair',    label: `To ${PL_BAND_LABEL.fair.toLowerCase()}`,    color: 'var(--btc)' },
  { key: 'ceiling', label: `To ${PL_BAND_LABEL.ceiling.toLowerCase()}`, color: 'var(--amber)' },
];

const MODE_NOTE: Record<CyclingMode, string> = {
  cycle: 'Bills drawn on Strike, refinanced into Coinbase every N months, purchases routed to the Coinbase pool.',
  hold: 'No draw, no refinance. Surplus buys into the Coinbase pool. ⚠ This IS the never-draw baseline — there is no second curve to compare against.',
  clearStrike: 'No draw. Surplus retires Strike, then buys.',
  clearBoth: 'No draw. Surplus retires Strike, then Coinbase, then buys.',
};

interface Overlay {
  pathKind?: PlBand;
  convergeMonths?: number;
  months?: number;
  income?: number;
  expenses?: number;
  cycleMonths?: number;
  cbLtvCapPct?: number;
  strikeAprPct?: number;
  cbAprPct?: number;
  mode?: CyclingMode;
}

const fmtK = (n: number): string => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${n < 0 ? '−' : ''}$${(a / 1_000_000).toFixed(1)}M`;
  if (a >= 1_000) return `${n < 0 ? '−' : ''}$${Math.round(a / 1_000)}k`;
  return `${n < 0 ? '−' : ''}$${Math.round(a)}`;
};
const fmtSigned = (n: number): string => `${n >= 0 ? '+' : '−'}${fmtUSD(Math.abs(n))}`;
const fmtBtc = (n: number): string => `${n.toFixed(4)} ₿`;
const sBtc = (n: number): string => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(3)} ₿`;
const pct1 = (n: number): string => `${(n * 100).toFixed(1)}%`;
const fmtHorizon = (v: number): string => {
  const y = Math.floor(v / 12), m = v % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y}y ${m}m`;
};

interface TipItem { name?: string; dataKey?: string | number; value?: number; color?: string }
function ChartTip({ active, payload, label, kind }: {
  active?: boolean; payload?: TipItem[]; label?: string | number; kind?: 'pct' | 'btc' | 'money';
}) {
  if (!active || !payload?.length) return null;
  const fmt = (v: number): string => {
    if (kind === 'btc') return `${v.toFixed(3)} ₿`;
    if (kind === 'money') return fmtUSD(v);
    return `${v.toFixed(1)}%`;
  };
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{label}</div>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className={styles.tooltipRow}>
          <span style={{ color: p.color }}>{p.name}</span>
          <strong>{fmt(p.value ?? 0)}</strong>
        </div>
      ))}
    </div>
  );
}

/**
 * Bar pins at 100%; the figure is free to read past it (from the v5 prototype). The fill is the gauge
 * colour; an over-100% figure turns the number + fill red while the bar stays full.
 */
function SafetyLine({ label, value, warn, act, right, flag }: {
  label: string; value: number; warn: number; act: number; right?: string; flag?: string | null;
}) {
  const lv = barLevel(value, warn, act);
  const over = value > 1;
  const color = over ? 'var(--red)' : LEVEL_COLOR[lv];
  return (
    <div className={styles.safetyLine}>
      <div className={styles.slHead}>
        <span className={styles.slLabel}>{label}</span>
        <span className={styles.slValue} style={{ color }}>
          {pct1(value)}
          {right && <span className={styles.slRight}>{right}</span>}
        </span>
      </div>
      <div className={styles.slTrack}>
        <div className={styles.slFill} style={{ width: `${Math.max(1.5, Math.min(100, (value / act) * 100))}%`, background: color }} />
      </div>
      {flag && <div className={styles.slFlag}>{flag}</div>}
    </div>
  );
}

export default function OwnershipFace() {
  const s = useStore(useShallow((st) => ({
    btcPrice: st.btcPrice,
    income: st.income,
    expenses: st.expenses,
    blocApr: st.blocApr,
    cbAprPct: st.cbAprPct,
    creditLine: st.creditLine,
    cbLtvTriggerPct: st.cbLtvTriggerPct,
    strikeLiquidationLtvPct: st.strikeLiquidationLtvPct,
    strikeCollateralBtc: st.getCurrentBtcHeld(),   // reading-anchored, Strike-only (v20)
    strikeBalance: st.advisorActualBlocBalance,
    // Derive INSIDE the selector (C6 precedent) so the value stays a primitive — neither dep array changes.
    cbCollateralBtc: deriveCbCollateral(st.dayLog, st.cbCollateralBtc),
    cbLoanBalance: st.cbLoanBalance,
    cbLoanBalanceAsOf: st.cbLoanBalanceAsOf,
  })));

  const [overlay, setOverlay] = useState<Overlay>({});
  const set = <K extends keyof Overlay>(k: K, v: Overlay[K]) => setOverlay((o) => ({ ...o, [k]: v }));
  const dirty = Object.keys(overlay).length > 0;

  const pathKind = overlay.pathKind ?? DEFAULT_PATH;
  const convergeMonths = overlay.convergeMonths ?? DEFAULT_CONVERGE_MONTHS;
  const months = overlay.months ?? DEFAULT_HORIZON_MONTHS;
  const income = overlay.income ?? s.income;
  const expenses = overlay.expenses ?? s.expenses;
  const cycleMonths = overlay.cycleMonths ?? DEFAULT_CYCLE_MONTHS;
  const capPct = overlay.cbLtvCapPct ?? DEFAULT_CAP_PCT;
  const strikeAprPct = overlay.strikeAprPct ?? s.blocApr;
  const cbAprPct = overlay.cbAprPct ?? s.cbAprPct;
  const mode: CyclingMode = overlay.mode ?? 'cycle';

  // ⚠ UTC-midnight of the LOCAL calendar day — the repo's date-only convention (see CyclingFace:123).
  const startDate = useMemo(() => new Date(todayLocalISO()), []);
  const cbDebt = useMemo(
    () => accruedCbBalance(s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf),
    [s.cbLoanBalance, s.cbAprPct, s.cbLoanBalanceAsOf],
  );

  const pricePath = useMemo(
    () => plConvergencePath(s.btcPrice, pathKind, startDate, months, convergeMonths),
    [s.btcPrice, pathKind, startDate, months, convergeMonths],
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
    mode,
  }), [
    pricePath, startDate, s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    cbDebt, income, expenses, strikeAprPct, cbAprPct, cycleMonths, capPct, mode,
  ]);

  const { rows, last } = sim;
  const liqMonth = sim.liqMonth;

  const [selectedMonth, setSelectedMonth] = useState(rows.length - 1);
  const [lens, setLens] = useState(1);
  const [view, setView] = useState<'ownership' | 'ltv' | 'price'>('ownership');

  // ⚠ CLAMP AT RENDER TIME (the crash fix) — `rows[selectedMonth]` must never appear.
  const monthIdx = clampMonth(selectedMonth, rows.length);
  const selRow = rows[monthIdx] ?? last;
  const atEnd = monthIdx === rows.length - 1;
  const lensed = applyPriceLens(selRow, lens);
  const gained = ownershipGained(selRow, rows[0], lensed.price);
  const off = Math.abs(lens - 1) > 0.005;

  useEffect(() => { setSelectedMonth((m) => Math.min(m, rows.length - 1)); }, [rows.length]);

  // ⚠ C7 — mirrors the sim memo's dep array, INCLUDING `mode`: a stale lens would stress-test the wrong
  // strategy. If an input is added to runCyclingSim, add it here too.
  useEffect(() => { setLens(1); }, [
    monthIdx,
    pricePath, cbDebt,
    s.strikeCollateralBtc, s.strikeBalance, s.creditLine, s.cbCollateralBtc,
    income, expenses, strikeAprPct, cbAprPct, cycleMonths, capPct, mode,
  ]);

  // ── the ownership wrapper ──
  const ownership = deriveOwnership(selRow.btcHeld, selRow.debt, lensed.price);
  const owedBtc = ownership.lendersBtc;
  const yoursBtc = Math.max(0, ownership.yoursBtc);   // hero clamp — display only
  const netToday = deriveOwnership(rows[0].btcHeld, rows[0].debt, rows[0].price).yoursBtc;
  const delta = ownership.yoursBtc - netToday;
  const yoursShare = ownership.yoursShare;

  // The share bar reads the CLAMPED shares directly (they sum to 1 when hasData — B3), never 1 − yours.
  const lendersShare = ownership.lendersShare;

  const openingBtc = s.strikeCollateralBtc + s.cbCollateralBtc;
  const openingDebt = cbDebt + s.strikeBalance;

  const bands = plBandsAt(startDate);
  const strikeLiqLtv = s.strikeLiquidationLtvPct > 0 ? s.strikeLiquidationLtvPct / 100 : 0.85;
  const strikeLiq = selRow.strikeCollateralBtc > 0 && strikeLiqLtv > 0
    ? selRow.strikeBalance / (selRow.strikeCollateralBtc * strikeLiqLtv) : 0;
  const cbLiq = selRow.cbCollateralBtc > 0 ? selRow.cbDebt / (selRow.cbCollateralBtc * CB_LLTV) : 0;
  const nearestLiq = Math.max(strikeLiq, cbLiq);
  const liqDist = nearestLiq > 0 && lensed.price > 0 ? 1 - nearestLiq / lensed.price : 1;

  // ⚠ capacityUsed matches deriveSafetyView: balance ÷ creditLine, price-free (A10).
  const creditUsed = s.creditLine > 0 ? selRow.strikeBalance / s.creditLine : 0;
  const cap = strikeAvailableCredit(s.creditLine, selRow.strikeCollateralBtc, lensed.price, selRow.strikeBalance);
  const overLine = selRow.strikeBalance > s.creditLine;

  // C2 — the degenerate case: the cap never lets the draw run. rows[0] is the opening position.
  const degenerateCap = mode === 'cycle' && rows[0].cbLtv * 100 <= capPct;
  // C1 — a no-draw mode with a deficit: the bills are funded by nothing.
  const deficitMode = mode !== 'cycle' && expenses > income;

  const cbZone = (ltv: number): string => LEVEL_COLOR[cbBarLevel(ltv, s.cbLtvTriggerPct, CB_LLTV)];

  const chartRows = useMemo(() => chartOwnershipRows(rows, CB_LLTV), [rows]);
  const milestones = [12, 24, 36, 60, 120].filter((m) => m <= months);

  const verdict = (() => {
    if (liqMonth !== null) {
      return {
        color: 'var(--red)' as const,
        text: `Liquidated in month ${liqMonth} at ${pct1(rows[liqMonth].cbLtv)}. Morpho seizes ${fmtBtc(sim.seizedBtc ?? 0)} at a ${(CB_LIQUIDATION_PENALTY * 100).toFixed(2)}% penalty, leaving ${fmtBtc(sim.survivorBtc ?? 0)}.`
          + (sim.deficiencyUsd !== null ? ` ${fmtUSD(sim.deficiencyUsd)} of debt survives — both facilities are full recourse.` : ''),
      };
    }
    if (sim.strikeMarginMonth !== null) {
      return {
        color: 'var(--red)' as const,
        text: `Strike margin call in month ${sim.strikeMarginMonth}. 72-hour cure window, unlike Coinbase.`,
      };
    }
    if (sim.creditExhaustedMonth !== null) {
      return {
        color: 'var(--amber)' as const,
        text: `Strike line stops funding the full bill in month ${sim.creditExhaustedMonth}. Income covers the shortfall, so fewer sats get bought — self-limiting, not a hard stop.`,
      };
    }
    if (sim.stopMonth !== null) {
      return {
        color: 'var(--amber)' as const,
        text: `Drawing stops in month ${sim.stopMonth} at the ${capPct}% Coinbase cap. Bills come from income after that.`,
      };
    }
    const d = last.btcHeld - last.debt / last.price - netToday;
    return {
      color: d >= 0 ? ('var(--green)' as const) : ('var(--amber)' as const),
      text: `Survives ${months} months. Net ownership ends ${sBtc(d)} against today — ${d >= 0 ? 'the debt grew slower than the stack' : 'the debt outran the stack'}.`,
    };
  })();

  const pathNote =
    `Converges from today's ${fmtUSD(s.btcPrice)} toward the ${PL_BAND_LABEL[pathKind].toLowerCase()} line over ${convergeMonths} months. `
    + `Today: ${PL_BAND_LABEL.floor.toLowerCase()} ${fmtK(bands.floor)} · ${PL_BAND_LABEL.fair.toLowerCase()} ${fmtK(bands.fair)} · ${PL_BAND_LABEL.ceiling.toLowerCase()} ${fmtK(bands.ceiling)}.`;

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Ownership</div>
        <div className={styles.framing}>Held · owed · yours — never sell.</div>
      </div>

      <div className={styles.seedRow}>
        <span className={styles.seedLabel}>
          Seeded from your live plan · {fmtBtc(openingBtc)} against {fmtUSD(openingDebt)}
        </span>
        {dirty && (
          <button type="button" className={styles.ghostBtn} onClick={() => setOverlay({})}>Reset to live</button>
        )}
      </div>

      <div className={styles.shell}>
        <div className={styles.main}>
          {/* ── HERO — the ownership wrapper ── */}
          <div className={styles.heroEyebrow}>
            Yours in bitcoin · {monthIdx === 0 ? 'today' : `+${monthIdx} mo`}
          </div>
          <div className={`${styles.heroValue} ${off ? styles.heroLensed : ''}`}>
            {yoursBtc.toFixed(4)} ₿
          </div>
          <div className={styles.heroLine}>
            {selRow.btcHeld.toFixed(3)} held − {owedBtc.toFixed(3)} owed at {fmtUSD(lensed.price)} ·{' '}
            <span style={{ color: delta >= 0 ? 'var(--green)' : 'var(--red)' }}>{sBtc(delta)} vs today</span>
          </div>

          <div
            role="img"
            aria-label={`${Math.round(yoursShare * 100)} percent yours, ${Math.round(lendersShare * 100)} percent owed`}
            className={styles.segBar}
          >
            <span aria-hidden="true" className={styles.segYours} style={{ width: `${yoursShare * 100}%` }} />
            <span aria-hidden="true" className={styles.segLenders} style={{ width: `${lendersShare * 100}%` }} />
          </div>

          <div className={styles.verdict} style={verdict.color === 'var(--green)'
            ? undefined
            : { borderColor: verdict.color, color: verdict.color }}>
            {verdict.text}
          </div>

          {/* ── SCRUBBERS — ONE gesture-exempt card (A1) ── */}
          <section className={`${styles.card} ${styles.scrubCard}`} data-gesture-exempt>
            <div className={styles.scrubHead}>
              <span className={styles.cardLabel}>Month</span>
              <span className={styles.scrubValue}>
                {monthIdx === 0 ? 'today' : `${monthIdx} · ${(monthIdx / 12).toFixed(1)} yr`}
                {selRow.postLiquidation && <span className={styles.msFlag}> post-liq</span>}
              </span>
            </div>
            <input
              type="range" className={styles.scrub}
              min={0} max={Math.max(0, rows.length - 1)} step={1} value={monthIdx}
              onChange={(e) => setSelectedMonth(Number(e.target.value))}
              aria-label="Month"
            />
            <div className={styles.scrubHead}>
              <span className={styles.cardLabel}>Price lens</span>
              <span className={styles.scrubValue}>
                {fmtUSD(lensed.price)}
                {off ? ` · ${lens < 1 ? '−' : '+'}${Math.abs((lens - 1) * 100).toFixed(0)}%` : ' · as modeled'}
              </span>
            </div>
            <input
              type="range" className={styles.scrub}
              min={0.2} max={2.2} step={0.01} value={lens}
              onChange={(e) => setLens(Number(e.target.value))}
              aria-label="Price lens"
            />
            <p className={styles.noteQuiet}>
              Display only — never re-runs the engine, never moves the charts. Resets on any input change.
            </p>
          </section>

          {/* ── STAT GRID ── */}
          <div className={styles.statGrid}>
            {([
              ['Held', fmtBtc(selRow.btcHeld), `from ${fmtBtc(rows[0].btcHeld)}`, 'var(--green)'],
              ['Owed', fmtBtc(owedBtc), `${fmtK(selRow.debt)} of debt`, 'var(--text-muted)'],
              ['Coinbase LTV', pct1(lensed.cbLtv), `liq ${fmtK(cbLiq)} · 86% instant`, cbZone(lensed.cbLtv)],
              ['Strike LTV', pct1(lensed.strikeLtv), `liq ${fmtK(strikeLiq)} · 85%, 72h cure`,
                LEVEL_COLOR[barLevel(lensed.strikeLtv, STRIKE_MAX_DRAW_LTV, strikeLiqLtv)]],
              ['Net ownership', sBtc(gained.yours), `gross ${sBtc(gained.gross)}`,
                gained.yours >= 0 ? 'var(--green)' : 'var(--red)'],
              ['Net equity', fmtK(lensed.equity),
                atEnd ? `strike interest ${fmtK(sim.totalStrikeInterest)}` : `at month ${monthIdx}`,
                atEnd ? (lensed.equity >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--text-primary)'],
            ] as const).map(([label, value, sub, color]) => (
              <div key={label} className={styles.stat}>
                <span className={styles.statLabel}>{label}</span>
                <div className={styles.statValue} style={{ color }}>{value}</div>
                <div className={styles.statSub}>{sub}</div>
              </div>
            ))}
          </div>

          {/* ── SAFETY SECTION ── */}
          <section className={styles.safety}>
            <div className={styles.safetyTitle}>Where the position stands at month {monthIdx}</div>
            <SafetyLine label="Coinbase LTV" value={lensed.cbLtv} warn={0.65} act={CB_LLTV} right={`liq ${fmtK(cbLiq)}`} />
            <SafetyLine label="Strike LTV" value={lensed.strikeLtv} warn={STRIKE_MAX_DRAW_LTV} act={strikeLiqLtv} right={`liq ${fmtK(strikeLiq)}`} />
            <SafetyLine label="Strike credit used" value={creditUsed} warn={CREDIT_WARN_USED} act={CREDIT_ACT_USED}
              right={`${fmtK(cap.available)} open`}
              flag={overLine ? `Balance is ${fmtK(selRow.strikeBalance - s.creditLine)} past the line — the draw is capped but the interest on it is not.` : null} />
            <div className={styles.nearest}>
              Nearest liquidation {fmtK(nearestLiq)}, {pct1(Math.max(0, liqDist))} below {fmtUSD(lensed.price)}.
              Limit is bound by {cap.binding === 'collateral' ? 'collateral' : 'the credit line'}
              {cap.binding === 'collateral' ? ` — the full line is backed again above ${fmtK(cap.fullyBackedPrice)}.` : '.'}
            </div>
          </section>

          {/* ── HOLDINGS BY VENUE — Strike = --text-primary (white), Coinbase = --coinbase (blue): the
              v5 prototype palette, restored by owner decision (was provisionally --btc/--green under A2). */}
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

          {/* ── CHART — each series a DIRECT child; never wrap conditional chart children in fragments
              (recharts walks its children to find series and silently renders an empty grid). */}
          <section className={`${styles.card} ${styles.chartCard}`}>
            <div className={styles.chartSeg}>
              {([
                ['ownership', 'Held · owed'],
                ['ltv', 'LTV'],
                ['price', 'Price & liq'],
              ] as const).map(([k, label]) => (
                <button key={k} type="button"
                  className={`${styles.chartSegBtn} ${view === k ? styles.chartSegOn : ''}`}
                  aria-pressed={view === k}
                  onClick={() => setView(k)}>
                  {label}
                </button>
              ))}
            </div>
            <div className={styles.chartBox}>
              {view === 'ownership' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                    <CartesianGrid stroke="var(--line-2)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" width={44}
                      tickFormatter={(x) => `${x.toFixed(1)}₿`} />
                    <Tooltip content={<ChartTip kind="btc" />} />
                    <Legend wrapperStyle={{ fontSize: 10.5, color: 'var(--text-muted)' }} />
                    <ReferenceLine x={monthIdx} stroke="var(--line-2)" />
                    <Line type="monotone" dataKey="held" name="Held" stroke="var(--text-muted)" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="yours" name="Yours" stroke="var(--btc)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="owed" name="Owed" stroke="var(--text-faint)" strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {view === 'ltv' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                    <CartesianGrid stroke="var(--line-2)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" width={40}
                      domain={[0, 95]} tickFormatter={(x) => `${x}%`} />
                    <Tooltip content={<ChartTip />} />
                    <ReferenceLine y={86} stroke="var(--red)" strokeDasharray="4 4"
                      label={{ value: 'CB liquidation', fill: 'var(--red)', fontSize: 9.5, position: 'insideTopLeft' }} />
                    <ReferenceLine y={50} stroke="var(--text-primary)" strokeDasharray="4 4"
                      label={{ value: 'Strike draw cap', fill: 'var(--text-primary)', fontSize: 9.5, position: 'insideBottomLeft' }} />
                    <ReferenceLine x={monthIdx} stroke="var(--line-2)" />
                    {/* Venue palette: Strike white, Coinbase blue (--coinbase) — matches the venue section. */}
                    <Line type="monotone" dataKey="cbLtv" name="Coinbase" stroke="var(--coinbase)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="strikeLtv" name="Strike" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
              {view === 'price' && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartRows} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                    <CartesianGrid stroke="var(--line-2)" vertical={false} />
                    <XAxis dataKey="m" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" />
                    <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} stroke="var(--line-2)" width={48}
                      tickFormatter={(x) => `$${Math.round(x / 1000)}k`} />
                    <Tooltip content={<ChartTip kind="money" />} />
                    <ReferenceLine x={monthIdx} stroke="var(--line-2)" />
                    <Line type="monotone" dataKey="price" name="Bitcoin" stroke="var(--text-primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="liq" name="CB liquidation" stroke="var(--red)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>
        </div>

        {/* ── CONTROLS + MILESTONES ── */}
        <div className={styles.side}>
          <div className={styles.controlCard}>
            <span className={styles.cardLabel}>Strategy</span>
            <div className={styles.segRow}>
              {([
                ['cycle', 'Cycle'], ['hold', 'Hold'],
                ['clearStrike', 'Clear Strike'], ['clearBoth', 'Clear both'],
              ] as const).map(([k, label]) => (
                <button key={k} type="button"
                  className={`${styles.segBtn} ${mode === k ? styles.segBtnOn : ''}`}
                  aria-pressed={mode === k}
                  onClick={() => set('mode', k)}>
                  {label}
                </button>
              ))}
            </div>
            <p className={styles.noteQuiet}>{MODE_NOTE[mode]}</p>

            <SliderInput label="Monthly income" value={income} onChange={(v) => set('income', v)}
              min={0} max={12000} step={100} display={fmtUSD(income)} minLabel="$0" maxLabel="$12k" />
            <SliderInput label="Monthly expenses" value={expenses} onChange={(v) => set('expenses', v)}
              min={0} max={12000} step={100} display={fmtUSD(expenses)} minLabel="$0" maxLabel="$12k" />

            <div className={styles.surplusNote} style={{ color: income - expenses >= 0 ? 'var(--text-muted)' : 'var(--amber)' }}>
              Surplus {fmtSigned(income - expenses)}/mo against {fmtUSD(
                (selRow.cbDebt * cbAprPct / 100 + selRow.strikeBalance * strikeAprPct / 100) / 12,
              )}/mo of interest at month {monthIdx}.
              {selRow.strikeShortfall > 0 && ` Income is covering ${fmtUSD(selRow.strikeShortfall)} of the bill this month.`}
            </div>

            <span className={styles.cardLabel}>Price path</span>
            <div className={styles.segRow}>
              {BAND_META.map((b) => (
                <button key={b.key} type="button"
                  className={`${styles.segBtn} ${pathKind === b.key ? styles.segBtnOn : ''}`}
                  aria-pressed={pathKind === b.key}
                  onClick={() => set('pathKind', b.key)}>
                  {b.label}
                </button>
              ))}
            </div>
            <p className={styles.noteQuiet}>{pathNote}</p>

            <SliderInput label="Convergence" value={convergeMonths} onChange={(v) => set('convergeMonths', v)}
              min={6} max={120} step={1} display={fmtHorizon(convergeMonths)} minLabel="6 mo" maxLabel="10 yr" />

            <SliderInput label="Coinbase draw cap" value={capPct} onChange={(v) => set('cbLtvCapPct', v)}
              min={20} max={85} step={1} display={`${capPct}%`} minLabel="20%" maxLabel="85%" />
            <div className={styles.presetRow}>
              <button type="button" className={styles.ghostBtn} onClick={() => set('cbLtvCapPct', s.cbLtvTriggerPct)}>
                Use my paydown trigger ({s.cbLtvTriggerPct}%)
              </button>
            </div>
            <SliderInput label="Horizon" value={months} onChange={(v) => set('months', v)}
              min={12} max={240} step={1} display={fmtHorizon(months)} minLabel="1 yr" maxLabel="20 yr" />
            <SliderInput label="Refinance cadence" value={cycleMonths} onChange={(v) => set('cycleMonths', v)}
              min={1} max={12} step={1} display={`${cycleMonths} mo`} minLabel="1 mo" maxLabel="12 mo" />
            <SliderInput label="Strike APR" value={strikeAprPct} onChange={(v) => set('strikeAprPct', v)}
              min={0} max={25} step={0.25} display={`${strikeAprPct}%`} minLabel="0%" maxLabel="25%" />
            <SliderInput label="Coinbase APR" value={cbAprPct} onChange={(v) => set('cbAprPct', v)}
              min={0} max={20} step={0.25} display={`${cbAprPct}%`} minLabel="0%" maxLabel="20%" />
          </div>

          {/* ⚠ C1 + C2 — the constraint notices (read like the credit-exhausted case). */}
          {(degenerateCap || deficitMode) && (
            <div className={styles.constraints}>
              {degenerateCap && (
                <div>
                  CB LTV opens at {pct1(rows[0].cbLtv)} — at or above the {capPct}% stop-draw cap, so this run
                  never draws. It measures the refinance, not the strategy. Raise the cap to model the draw.
                </div>
              )}
              {deficitMode && (
                <div>
                  Expenses exceed income and this mode never draws — the deficit is funded by nothing. BTC held
                  stays flat and debt only accrues; the curve is optimistic exactly here.
                </div>
              )}
            </div>
          )}

          {/* MILESTONES — clickable rows jump the scrubber. UNLENSED: only the tiles follow the lens. */}
          <div className={styles.msWrap} data-gesture-exempt>
            <table className={styles.msTable}>
              <thead>
                <tr>
                  <th className={`${styles.msTh} ${styles.msYear}`}>Year</th>
                  <th className={styles.msTh}>Price</th>
                  <th className={styles.msTh}>Held</th>
                  <th className={styles.msTh}>Owed</th>
                  <th className={styles.msTh}>Yours</th>
                  <th className={styles.msTh}>CB LTV</th>
                  <th className={styles.msTh}>Net gain</th>
                </tr>
              </thead>
              <tbody>
                {milestones.map((m) => {
                  const r = rows[m];
                  if (!r) return null;
                  const g = ownershipGained(r, rows[0]);
                  const y = deriveOwnership(r.btcHeld, r.debt, r.price).yoursBtc;
                  return (
                    <tr key={m} role="button" tabIndex={0}
                      onClick={() => setSelectedMonth(m)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedMonth(m); } }}
                      className={`${styles.msRow} ${m === monthIdx ? styles.msRowOn : ''} ${r.postLiquidation ? styles.msPost : ''}`}>
                      <td className={`${styles.msTd} ${styles.msYear}`}>
                        {Number.isInteger(m / 12) ? m / 12 : (m / 12).toFixed(1)}
                        {r.postLiquidation && <span className={styles.msFlag}> ⚑</span>}
                      </td>
                      <td className={styles.msTd}>{fmtK(r.price)}</td>
                      <td className={styles.msTd}>{r.btcHeld.toFixed(3)}</td>
                      <td className={styles.msTd}>{(r.debt / r.price).toFixed(3)}</td>
                      <td className={`${styles.msTd} ${styles.msYours}`}>{y.toFixed(3)}</td>
                      <td className={styles.msTd} style={{ color: cbZone(r.cbLtv) }}>{pct1(r.cbLtv)}</td>
                      <td className={styles.msTd}>
                        <div className={styles.gainNet} style={{ color: g.yours >= 0 ? 'var(--green)' : 'var(--red)' }}>
                          {sBtc(g.yours)}
                        </div>
                        <div className={styles.gainGross}>{sBtc(g.gross)} gross</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.disclaimer}>
            Opening position {fmtBtc(openingBtc)} — Strike {strikeAprPct.toFixed(0)}% APR, line capped at 50% of
            posted collateral, margin call at 70%, liquidation at {Math.round(strikeLiqLtv * 100)}% with a 72-hour
            cure. Coinbase {cbAprPct.toFixed(2)}% variable, liquidation at 86% with no cure window and a{' '}
            {(CB_LIQUIDATION_PENALTY * 100).toFixed(2)}% penalty. The two collateral pools are never combined —
            Strike collateral is fixed and every purchase lands on Coinbase. Held is display only and is never a
            denominator. Power law bands are a pattern, not a forecast.
          </div>
        </div>
      </div>
    </div>
  );
}
