import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { cbMetrics, accruedCbBalance, barLevel, worseLevel, type SafetyLevel } from '../../simulation/cbMetrics';
import { NumberInput } from '../ui/NumberInput';
import { fmtUSD } from '../../utils/format';
import styles from './SafetyDashboard.module.css';

const todayISO = () => new Date().toISOString().split('T')[0];

function daysSince(asOf: string | null): number | null {
  if (!asOf) return null;
  return Math.floor(Math.max(0, (Date.now() - Date.parse(asOf)) / 86_400_000));
}

function freshnessLabel(kind: 'balance' | 'liq price', asOf: string | null): { text: string; stale: boolean } {
  const d = daysSince(asOf);
  if (d === null) return { text: `${kind} not anchored yet`, stale: true };
  if (d === 0)    return { text: `${kind} updated today`, stale: false };
  return { text: `${kind} as of ${d} day${d === 1 ? '' : 's'} ago`, stale: d > 30 };
}

const LEVEL_COLOR: Record<SafetyLevel, string> = {
  safe:  'var(--green)',
  watch: 'var(--amber)',
  act:   'var(--red)',
};

export function SafetyDashboard() {
  const btcPrice               = useStore((s) => s.btcPrice);
  const hasCbLoan              = useStore((s) => s.hasCbLoan);
  const setHasCbLoan           = useStore((s) => s.setHasCbLoan);
  const cbLoanBalance          = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc        = useStore((s) => s.cbCollateralBtc);
  const cbAprPct               = useStore((s) => s.cbAprPct);
  const cbLiquidationPrice     = useStore((s) => s.cbLiquidationPrice);
  const cbLtvTriggerPct        = useStore((s) => s.cbLtvTriggerPct);
  const cbLoanBalanceAsOf      = useStore((s) => s.cbLoanBalanceAsOf);
  const cbLiquidationPriceAsOf = useStore((s) => s.cbLiquidationPriceAsOf);
  const setCbLoanBalance       = useStore((s) => s.setCbLoanBalance);
  const setCbLiquidationPrice  = useStore((s) => s.setCbLiquidationPrice);
  const setCbLoanBalanceAsOf      = useStore((s) => s.setCbLoanBalanceAsOf);
  const setCbLiquidationPriceAsOf = useStore((s) => s.setCbLiquidationPriceAsOf);

  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const creditLine               = useStore((s) => s.creditLine);
  const strikeLiquidationLtvPct  = useStore((s) => s.strikeLiquidationLtvPct);

  const [strikeView, setStrikeView] = useState<'capacity' | 'liquidation'>('capacity');
  const [editing, setEditing]       = useState(false);
  const [draftBal, setDraftBal]     = useState(cbLoanBalance);
  const [draftLiq, setDraftLiq]     = useState(cbLiquidationPrice);

  // ── Price chart slot (Spec C fills this) ─────────────────────────────
  const priceSlot = <div className={styles.priceSlot} aria-hidden="true" />;

  // ── First-run funnel ─────────────────────────────────────────────────
  if (!hasCbLoan) {
    return (
      <div className={styles.dashboard}>
        {priceSlot}
        <div className={styles.setupCard}>
          <span className={styles.setupTitle}>Safety dashboard</span>
          <span className={styles.setupHint}>
            Track a Coinbase/Morpho loan to watch your liquidation cushion here.
          </span>
          <button className={styles.setupBtn} onClick={() => setHasCbLoan(true)}>
            Set up CB monitoring
          </button>
        </div>
      </div>
    );
  }

  // ── CB bar math (shared cbMetrics — same numbers as the CB Loan tab) ──
  const accruedBalance = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
  const m              = cbMetrics(accruedBalance, cbCollateralBtc, btcPrice, cbLtvTriggerPct);
  const activeLiqPrice = cbLiquidationPrice > 0 ? cbLiquidationPrice : m.liqPrice;
  const liqSource      = cbLiquidationPrice > 0 ? 'Coinbase' : '~est.';
  const cbLtv          = m.ltv;
  // room for BTC to FALL before each threshold — positive when safe (price above the threshold price)
  const dropToTrigger  = btcPrice > 0 ? (btcPrice - m.triggerPrice) / btcPrice : 0;
  const dropToLiq      = btcPrice > 0 ? (btcPrice - activeLiqPrice) / btcPrice : 0;

  const cbFillPct  = Math.max(0, Math.min(100, (cbLtv / CB_LLTV) * 100));
  const trigMarker = (cbLtvTriggerPct / 100 / CB_LLTV) * 100;             // trigger as % of the 0..86 track
  const cbLevel    = barLevel(cbLtv, cbLtvTriggerPct / 100, CB_LLTV * 0.93);  // act ≈ 80% LTV
  const cbFillColor = LEVEL_COLOR[cbLevel];
  const cbBadge    = cbLevel === 'safe' ? 'Safe' : cbLevel === 'watch' ? 'Fair' : 'Poor';

  // ── Strike bar math ──────────────────────────────────────────────────
  const strikeLiqLtv  = strikeLiquidationLtvPct / 100;
  const capacityUsed  = creditLine > 0 ? advisorActualBlocBalance / creditLine : 0;
  const strikeLtv     = advisorActualBtcHeld * btcPrice > 0
    ? advisorActualBlocBalance / (advisorActualBtcHeld * btcPrice) : 0;
  const strikeLevel   = barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82); // ≈65% warn / 70% margin call
  const strikeFillPct = strikeView === 'capacity'
    ? Math.max(0, Math.min(100, capacityUsed * 100))
    : Math.max(0, Math.min(100, (strikeLtv / strikeLiqLtv) * 100));
  const strikeFillColor = strikeView === 'capacity' ? 'var(--green)' : LEVEL_COLOR[strikeLevel];

  // ── State line (nearer / worse bar drives it) ────────────────────────
  const state: SafetyLevel = worseLevel(cbLevel, strikeLevel);
  const stateCopy = state === 'safe'
    ? 'Safe — nothing to do today.'
    : state === 'watch'
      ? 'Watch — your CB cushion is tightening.'
      : 'Act — pay down or add collateral now.';

  const balFresh = freshnessLabel('balance', cbLoanBalanceAsOf);
  const liqFresh = freshnessLabel('liq price', cbLiquidationPriceAsOf);

  const saveReanchor = () => {
    setCbLoanBalance(draftBal);
    setCbLiquidationPrice(draftLiq);
    setCbLoanBalanceAsOf(todayISO());
    setCbLiquidationPriceAsOf(todayISO());
    setEditing(false);
  };

  // positive drop = room to fall (↓X%); negative = price already at/past the threshold
  const pct = (n: number) => n > 0 ? `↓${(n * 100).toFixed(1)}%` : `${(Math.abs(n) * 100).toFixed(1)}% over`;

  return (
    <div className={styles.dashboard}>
      {priceSlot}

      {/* ── CB bar (primary) ───────────────────────────────────────── */}
      <div className={styles.barCard}>
        <div className={styles.barHeader}>
          <span className={styles.barLabel}>COINBASE LOAN</span>
          <span className={styles.badge} style={{ color: cbFillColor, borderColor: cbFillColor }}>{cbBadge}</span>
        </div>

        <button className={styles.barTrackBtn} onClick={() => { setDraftBal(cbLoanBalance); setDraftLiq(cbLiquidationPrice); setEditing((v) => !v); }} title="Tap to re-anchor balance + liquidation price">
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${cbFillPct}%`, background: cbFillColor }} />
            <div className={styles.marker} style={{ left: `${trigMarker}%` }}>
              <span className={styles.markerLabel}>{cbLtvTriggerPct}% · {fmtUSD(m.triggerPrice)}</span>
            </div>
            <div className={styles.marker} style={{ left: '100%' }}>
              <span className={styles.markerLabelRight}>86% · {fmtUSD(activeLiqPrice)} <em>{liqSource}</em></span>
            </div>
          </div>
        </button>

        <div className={styles.cushionRow}>
          <span className={styles.ltvNow}>{(cbLtv * 100).toFixed(1)}% LTV</span>
          <span className={styles.cushion}>{pct(dropToTrigger)} to trigger · {pct(dropToLiq)} to liquidation</span>
        </div>

        {cbLevel !== 'safe' && (
          <p className={styles.graceNote}>Morpho liquidates instantly — no margin-call window</p>
        )}

        <div className={styles.freshRow}>
          <span className={balFresh.stale ? styles.freshStale : styles.fresh}>{balFresh.text}</span>
          <span className={liqFresh.stale ? styles.freshStale : styles.fresh}>{liqFresh.text}</span>
        </div>
        {liqFresh.stale && (
          <p className={styles.staleWarn}>liq price may be low — BTC drop to liquidation is smaller than shown</p>
        )}

        {editing && (
          <div className={styles.editBox}>
            <span className={styles.editHint}>Read both from your Coinbase Loan Center, then save.</span>
            <NumberInput label="CB loan balance" value={draftBal} onChange={setDraftBal} prefix="$" min={0} step={100} />
            <NumberInput label="Liquidation price (Coinbase)" value={draftLiq} onChange={setDraftLiq} prefix="$" min={0} step={1000} />
            <div className={styles.editBtns}>
              <button className={styles.saveBtn} onClick={saveReanchor}>Save — anchors to today</button>
              <button className={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      {/* ── Strike bar (secondary; tap to flip) ────────────────────── */}
      <button className={styles.barCard} onClick={() => setStrikeView((v) => (v === 'capacity' ? 'liquidation' : 'capacity'))}>
        <div className={styles.barHeader}>
          <span className={styles.barLabel}>STRIKE BLOC</span>
          <span className={styles.flipHint}>{strikeView === 'capacity' ? 'tap for liquidation view' : 'tap for capacity view'}</span>
        </div>
        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${strikeFillPct}%`, background: strikeFillColor }} />
          {strikeView === 'liquidation' && (
            <div className={styles.marker} style={{ left: '100%' }}>
              <span className={styles.markerLabelRight}>{strikeLiquidationLtvPct}% liq</span>
            </div>
          )}
        </div>
        <div className={styles.cushionRow}>
          {strikeView === 'capacity' ? (
            <span className={styles.ltvNow}>{(capacityUsed * 100).toFixed(0)}% of credit line used</span>
          ) : (
            <span className={styles.ltvNow}>{(strikeLtv * 100).toFixed(1)}% LTV · liquidation at {strikeLiquidationLtvPct}%</span>
          )}
        </div>
      </button>

      {/* ── State line ─────────────────────────────────────────────── */}
      <div className={styles.stateLine} style={{ color: LEVEL_COLOR[state] }}>
        <span className={styles.stateDot} style={{ background: LEVEL_COLOR[state] }} />
        {stateCopy}
      </div>
    </div>
  );
}
