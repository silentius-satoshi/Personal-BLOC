import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { cbMetrics, accruedCbBalance, barLevel, worseLevel, type SafetyLevel } from '../../simulation/cbMetrics';
import { computeStrikeLtv } from '../../simulation/strikeCredit';
import { useMorphoRate } from '../../hooks/useMorphoRate';
import { PriceChart } from './PriceChart';
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
  const { rate: morphoRate, loading: morphoLoading } = useMorphoRate();   // live cbBTC/USDC Base rate — reference only
  const cbLiquidationPrice     = useStore((s) => s.cbLiquidationPrice);
  const cbLtvTriggerPct        = useStore((s) => s.cbLtvTriggerPct);
  const cbLoanBalanceAsOf      = useStore((s) => s.cbLoanBalanceAsOf);
  const cbLiquidationPriceAsOf = useStore((s) => s.cbLiquidationPriceAsOf);
  const setCbLoanBalance       = useStore((s) => s.setCbLoanBalance);
  const setCbLiquidationPrice  = useStore((s) => s.setCbLiquidationPrice);
  const setCbLoanBalanceAsOf      = useStore((s) => s.setCbLoanBalanceAsOf);
  const setCbLiquidationPriceAsOf = useStore((s) => s.setCbLiquidationPriceAsOf);

  const advisorActualBlocBalance    = useStore((s) => s.advisorActualBlocBalance);
  const setAdvisorActualBlocBalance = useStore((s) => s.setAdvisorActualBlocBalance);
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());   // reality read (baseline + logged buys + pending)
  const creditLine               = useStore((s) => s.creditLine);
  const setCreditLine            = useStore((s) => s.setCreditLine);
  const strikeLiquidationLtvPct  = useStore((s) => s.strikeLiquidationLtvPct);
  const setStrikeLiquidationLtvPct = useStore((s) => s.setStrikeLiquidationLtvPct);

  const [strikeView, setStrikeView] = useState<'capacity' | 'liquidation'>('capacity');
  const [editing, setEditing]       = useState(false);
  const [draftBal, setDraftBal]     = useState(cbLoanBalance);
  const [draftLiq, setDraftLiq]     = useState(cbLiquidationPrice);

  // Strike inline editor — own state (CB's editing/draftBal/draftLiq are CB-specific)
  const [strikeEditing, setStrikeEditing]   = useState(false);
  const [draftStrikeBal, setDraftStrikeBal] = useState(advisorActualBlocBalance);
  const [draftCreditLine, setDraftCreditLine] = useState(creditLine);
  const [draftLiqLtv, setDraftLiqLtv]       = useState(strikeLiquidationLtvPct);

  // ── Price chart slot — BTC candles (1H/1D/1W), top of the dashboard ──
  const priceSlot = <PriceChart />;

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
  const strikeLtv     = computeStrikeLtv(advisorActualBlocBalance, currentBtcHeld, btcPrice);
  const strikeLevel   = barLevel(strikeLtv, strikeLiqLtv * 0.76, strikeLiqLtv * 0.82); // ≈65% warn / 70% margin call
  const strikeFillPct = strikeView === 'capacity'
    ? Math.max(0, Math.min(100, capacityUsed * 100))
    : Math.max(0, Math.min(100, (strikeLtv / strikeLiqLtv) * 100));
  const strikeFillColor = strikeView === 'capacity' ? 'var(--green)' : LEVEL_COLOR[strikeLevel];

  // ── State line (nearer / worse bar drives it; Strike-only when no CB loan) ──
  const state: SafetyLevel = hasCbLoan ? worseLevel(cbLevel, strikeLevel) : strikeLevel;
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

  // Whole-CB-card tap-to-anchor (mirrors the Strike card's whole-container tap).
  const toggleEdit = () => {
    if (!editing) { setDraftBal(cbLoanBalance); setDraftLiq(cbLiquidationPrice); }   // seed drafts on open
    setEditing((v) => !v);
  };
  const neverAnchored = !cbLoanBalanceAsOf && !cbLiquidationPriceAsOf;

  // Strike card: body tap flips the view; the edit control opens a view-aware inline editor.
  const flipStrike = () => setStrikeView((v) => (v === 'capacity' ? 'liquidation' : 'capacity'));
  const openStrikeEdit = () => {
    if (!strikeEditing) {
      setDraftStrikeBal(advisorActualBlocBalance);
      setDraftCreditLine(creditLine);
      setDraftLiqLtv(strikeLiquidationLtvPct);
    }
    setStrikeEditing((v) => !v);
  };
  const saveStrike = () => {
    setAdvisorActualBlocBalance(draftStrikeBal);
    if (strikeView === 'capacity') setCreditLine(draftCreditLine);
    else setStrikeLiquidationLtvPct(draftLiqLtv);
    setStrikeEditing(false);
  };

  // positive drop = room to fall (↓X%); negative = price already at/past the threshold
  const pct = (n: number) => n > 0 ? `↓${(n * 100).toFixed(1)}%` : `${(Math.abs(n) * 100).toFixed(1)}% over`;

  return (
    <div className={styles.dashboard}>
      {/* ── State line (headline verdict) ──────────────────────────── */}
      <div className={styles.stateLine} style={{ color: LEVEL_COLOR[state] }}>
        <span className={styles.stateDot} style={{ background: LEVEL_COLOR[state] }} />
        {stateCopy}
      </div>

      {priceSlot}

      {/* ── CB bar (primary) — or CB-setup prompt in the CB slot when no loan ── */}
      {hasCbLoan ? (
      <div
        className={styles.barCard}
        onClick={toggleEdit}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleEdit(); } }}
      >
        <div className={styles.barHeader}>
          <span className={styles.barLabel}>COINBASE LOAN</span>
          <span className={styles.badge} style={{ color: cbFillColor, borderColor: cbFillColor }}>{cbBadge}</span>
        </div>
        <span className={styles.flipHint}>
          {editing ? 'editing…' : neverAnchored ? 'tap to set your balance & liquidation price' : 'tap to update'}
        </span>

        <div className={styles.barTrack}>
          <div className={styles.barFill} style={{ width: `${cbFillPct}%`, background: cbFillColor }} />
          <div className={styles.marker} style={{ left: `${trigMarker}%` }}>
            <span className={styles.markerLabel}>{cbLtvTriggerPct}%</span>
          </div>
          <div className={styles.marker} style={{ left: '100%' }}>
            <span className={styles.markerLabelRight}>86%</span>
          </div>
        </div>

        <div className={styles.cushionRow}>
          <span className={styles.ltvNow}>{(cbLtv * 100).toFixed(1)}% LTV</span>
          <span className={styles.cushion}>{pct(dropToTrigger)} to trigger · {pct(dropToLiq)} to liquidation</span>
        </div>
        <p className={styles.priceNote}>trigger {fmtUSD(m.triggerPrice)} · liq {fmtUSD(activeLiqPrice)} ({liqSource})</p>

        {cbLevel !== 'safe' && (
          <p className={styles.graceNote}>Morpho liquidates instantly — no margin-call window</p>
        )}

        {neverAnchored ? (
          <p className={styles.anchorNudge}>Tap to anchor your Coinbase balance &amp; liquidation price for accurate cushion.</p>
        ) : (
          <>
            <div className={styles.freshRow}>
              <span className={balFresh.stale ? styles.freshStale : styles.fresh}>{balFresh.text}</span>
              <span className={liqFresh.stale ? styles.freshStale : styles.fresh}>{liqFresh.text}</span>
            </div>
            {liqFresh.stale && (
              <p className={styles.staleWarn}>liq price may be low — BTC drop to liquidation is smaller than shown</p>
            )}
          </>
        )}

        {editing && (
          <div className={styles.editBox} onClick={(e) => e.stopPropagation()}>
            <span className={styles.editHint}>Read both from your Coinbase Loan Center, then save.</span>
            <NumberInput label="CB loan balance" value={draftBal} onChange={setDraftBal} prefix="$" min={0} step={100} />
            <NumberInput label="Liquidation price (Coinbase)" value={draftLiq} onChange={setDraftLiq} prefix="$" min={0} step={1000} />
            {morphoRate.borrowApy !== null ? (
              <>
                <span className={styles.editHint}>
                  Morpho cbBTC/USDC (Base) market rate: {morphoRate.borrowApy.toFixed(2)}% (live)
                </span>
                {Math.abs(morphoRate.borrowApy - cbAprPct) > 1 && (
                  <span className={styles.editHint}>Your APR differs — Coinbase may add a margin.</span>
                )}
              </>
            ) : (
              <span className={styles.editHint}>
                {morphoLoading ? 'checking Morpho rate…' : 'Morpho market rate unavailable'}
              </span>
            )}
            <div className={styles.editBtns}>
              <button className={styles.saveBtn} onClick={saveReanchor}>Save — anchors to today</button>
              <button className={styles.cancelBtn} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
      ) : (
        <div className={styles.setupCard}>
          <span className={styles.setupTitle}>COINBASE LOAN</span>
          <span className={styles.setupHint}>
            Track a Coinbase/Morpho loan to watch your liquidation cushion here.
          </span>
          <button className={styles.setupBtn} onClick={() => setHasCbLoan(true)}>
            Set up CB monitoring
          </button>
        </div>
      )}

      {/* ── Strike bar (secondary; body tap flips, edit control opens inline editor) ── */}
      <div
        className={styles.barCard}
        onClick={flipStrike}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flipStrike(); } }}
      >
        <div className={styles.barHeader}>
          <span className={styles.barLabel}>STRIKE BLOC</span>
          <span className={styles.barHeaderRight}>
            <span className={styles.flipHint}>
              {strikeEditing ? 'editing…' : strikeView === 'capacity' ? 'tap for liquidation view' : 'tap for capacity view'}
            </span>
            <button
              className={styles.editLink}
              onClick={(e) => { e.stopPropagation(); openStrikeEdit(); }}
            >
              edit
            </button>
          </span>
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

        {strikeEditing && (
          <div className={styles.editBox} onClick={(e) => e.stopPropagation()}>
            <span className={styles.editHint}>
              {strikeView === 'capacity' ? 'Adjust your drawn balance & approved credit line.' : 'Adjust your drawn balance & liquidation LTV.'}
            </span>
            <NumberInput label="BLOC balance" value={draftStrikeBal} onChange={setDraftStrikeBal} prefix="$" min={0} step={100} />
            {strikeView === 'capacity' ? (
              <NumberInput label="Credit line" value={draftCreditLine} onChange={setDraftCreditLine} prefix="$" min={0} step={1000} />
            ) : (
              <NumberInput label="Liquidation LTV" value={draftLiqLtv} onChange={setDraftLiqLtv} suffix="%" min={0} max={100} step={1} />
            )}
            <div className={styles.editBtns}>
              <button className={styles.saveBtn} onClick={saveStrike}>Save</button>
              <button className={styles.cancelBtn} onClick={() => setStrikeEditing(false)}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
