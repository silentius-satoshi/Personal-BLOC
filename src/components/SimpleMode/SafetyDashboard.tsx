import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { useShallow } from 'zustand/react/shallow';
import { CB_LLTV, CB_WARN_LTV } from '../../simulation/runCoinbaseLoan';
import { worseLevel, type SafetyLevel } from '../../simulation/cbMetrics';
import { deriveSafetyView, selectSafetyViewInputs } from '../../simulation/safetyView';
import { useMorphoRate } from '../../hooks/useMorphoRate';
import { PriceChart } from './PriceChart';
import { NumberInput } from '../ui/NumberInput';
import { fmtUSD, todayLocalISO } from '../../utils/format';
import styles from './SafetyDashboard.module.css';

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
  const creditLine               = useStore((s) => s.creditLine);
  const setCreditLine            = useStore((s) => s.setCreditLine);
  const strikeLiquidationLtvPct  = useStore((s) => s.strikeLiquidationLtvPct);
  const setStrikeLiquidationLtvPct = useStore((s) => s.setStrikeLiquidationLtvPct);

  const viewerMode = useStore((s) => s.viewerMode);   // read-only viewer → inline editors disabled (view-flip still allowed)
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

  // ── Safety math — single source of truth (deriveSafetyView, shared with the viewer home) ──────
  // selectSafetyViewInputs is the ONE store→inputs mapping (no drift). useShallow re-renders only when
  // one of the 12 mapped values changes (incl. getCurrentBtcHeld() + cbCollateralBtc) → value-identical
  // reactivity, incl. recompute-on-price-tick, without listing every field a second time here.
  const view = deriveSafetyView(useStore(useShallow(selectSafetyViewInputs)));
  // creditLevel is intentionally NOT destructured — the owner's capacity bar is ALWAYS green (the
  // viewer colors it via creditLevel; wiring it up here is the single most likely future regression).
  const {
    capacityUsed, strikeLtv, strikeLevel, crashLtv,
    cbLtv, cbLevel, accruedBalance, cbLiqPrice, cbLiqFrac,
  } = view;
  const activeLiqPrice = cbLiqPrice; // alias → downstream JSX names unchanged

  // ── CB bar display (from view) ────────────────────────────────────────
  // P4c-3c — distance-to-liquidation (display-only). From btcPrice → the authoritative activeLiqPrice.
  const liqDropUsd = Math.max(0, btcPrice - activeLiqPrice);                    // $ cushion to liquidation
  const liqDropPct = btcPrice > 0 ? (btcPrice - activeLiqPrice) / btcPrice : 0; // % drop to liquidation
  const cbFillPct  = Math.max(0, Math.min(100, (cbLtv / cbLiqFrac) * 100));
  const trigMarker = (cbLtvTriggerPct / 100 / cbLiqFrac) * 100;           // trigger as % of the 0..liquidation track
  const cbFillColor = LEVEL_COLOR[cbLevel];
  const cbBadge    = cbLevel === 'safe' ? 'Safe' : cbLevel === 'watch' ? 'Fair' : 'Poor';
  // ── Strike bar display (from view) ────────────────────────────────────
  const strikeLiqLtv  = strikeLiquidationLtvPct / 100;
  const strikeFillPct = strikeView === 'capacity'
    ? Math.max(0, Math.min(100, capacityUsed * 100))
    : Math.max(0, Math.min(100, (strikeLtv / strikeLiqLtv) * 100));
  const strikeFillColor = strikeView === 'capacity' ? 'var(--green)' : LEVEL_COLOR[strikeLevel];

  // ── State line — CREDIT-EXCLUDED (unlike deriveViewerOverall, which folds creditLevel). The owner
  // state = the nearer of the two bars actually shown (Strike, +CB when present); capacity is
  // always-green so it never drives. Strike-only when no CB loan. ──
  const state: SafetyLevel = hasCbLoan ? worseLevel(cbLevel, strikeLevel) : strikeLevel;
  const stateCopy = state === 'safe'
    ? 'Safe — nothing to do today'
    : state === 'watch'
      ? 'Watch — your CB cushion is tightening'
      : 'Act — pay down or add collateral now';

  const balFresh = freshnessLabel('balance', cbLoanBalanceAsOf);
  const liqFresh = freshnessLabel('liq price', cbLiquidationPriceAsOf);

  const saveReanchor = () => {
    setCbLoanBalance(draftBal);
    setCbLiquidationPrice(draftLiq);
    setCbLoanBalanceAsOf(todayLocalISO());
    setCbLiquidationPriceAsOf(todayLocalISO());
    setEditing(false);
  };

  // Whole-CB-card tap-to-anchor (mirrors the Strike card's whole-container tap).
  const toggleEdit = () => {
    if (viewerMode) return;   // read-only viewer — no anchoring
    if (!editing) { setDraftBal(cbLoanBalance); setDraftLiq(cbLiquidationPrice); }   // seed drafts on open
    setEditing((v) => !v);
  };
  const neverAnchored = !cbLoanBalanceAsOf && !cbLiquidationPriceAsOf;

  // Strike card: body tap flips the view; the edit control opens a view-aware inline editor.
  const flipStrike = () => setStrikeView((v) => (v === 'capacity' ? 'liquidation' : 'capacity'));
  const openStrikeEdit = () => {
    if (viewerMode) return;   // read-only viewer — no inline edit
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

  return (
    <div className={styles.dashboard}>
      {priceSlot}

      <div className={styles.safetyCard}>
      {/* ── Verdict eyebrow (card title) ───────────────────────────── */}
      <div className={styles.eyebrow}>
        <span className={styles.eyebrowLabel}>Safety ·</span>{' '}
        <span className={styles.eyebrowVerdict} style={{ color: LEVEL_COLOR[state] }}>{stateCopy}</span>
      </div>

      {/* ── Strike bar (primary; body tap flips, edit control opens inline editor) ── */}
      <div
        className={styles.barRow}
        onClick={flipStrike}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); flipStrike(); } }}
      >
        <div className={styles.barHeader}>
          <span className={styles.barHeaderLeft}>
            <span className={styles.barLabel}>STRIKE BLOC</span>
            <span className={styles.barValue}>
              {strikeView === 'capacity' ? `${(capacityUsed * 100).toFixed(0)}% used` : `${(strikeLtv * 100).toFixed(1)}% LTV`}
            </span>
            <span className={styles.badge} style={{ color: LEVEL_COLOR[strikeLevel], borderColor: LEVEL_COLOR[strikeLevel] }}>
              {strikeLevel === 'safe' ? 'Safe' : strikeLevel === 'watch' ? 'Fair' : 'Poor'}
            </span>
          </span>
          <button
            className={styles.editLink}
            onClick={(e) => { e.stopPropagation(); openStrikeEdit(); }}
          >
            edit
          </button>
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
            <span className={styles.ltvNow}>{(capacityUsed * 100).toFixed(0)}% of credit line used · avail {fmtUSD(Math.max(0, creditLine - advisorActualBlocBalance))}</span>
          ) : (
            <span className={styles.ltvNow}>{(strikeLtv * 100).toFixed(1)}% LTV · liq {strikeLiquidationLtvPct}% · 80% crash → {(crashLtv * 100).toFixed(0)}%</span>
          )}
          <span className={styles.flipHint}>
            {strikeEditing ? 'editing…' : strikeView === 'capacity' ? '⇄ liquidation' : '⇄ capacity'}
          </span>
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

      <div className={styles.barDiv} />

      {/* ── CB bar (secondary) — or CB-setup prompt in the CB slot when no loan ── */}
      {hasCbLoan ? (
      <div
        className={styles.barRow}
        onClick={toggleEdit}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleEdit(); } }}
      >
        <div className={styles.barHeader}>
          <span className={styles.barHeaderLeft}>
            <span className={styles.barLabel}>COINBASE LOAN</span>
            <span className={styles.barValue}>{(cbLtv * 100).toFixed(1)}% LTV</span>
            <span className={styles.badge} style={{ color: cbFillColor, borderColor: cbFillColor }}>{cbBadge}</span>
          </span>
          <span className={styles.chevron}>›</span>
        </div>

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
          <span className={styles.cushion}>{fmtUSD(liqDropUsd)} above liq · {(liqDropPct * 100).toFixed(0)}% drop away</span>
        </div>
        {neverAnchored && (
          <p className={styles.anchorNudge}>Tap to anchor your Coinbase balance &amp; liquidation price for accurate cushion.</p>
        )}

        {editing && (
          <div className={styles.editBox} onClick={(e) => e.stopPropagation()}>
            {!neverAnchored && (
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
            {activeLiqPrice > 0 && (
              <div className={styles.cbDistance} style={{ borderColor: cbFillColor }}>
                <div className={styles.cbDistanceMain} style={{ color: cbFillColor }}>
                  {fmtUSD(liqDropUsd)} <span className={styles.cbDistanceSub}>above liquidation</span>
                </div>
                <div className={styles.cbDistanceNote}>
                  a <b>{(liqDropPct * 100).toFixed(0)}% drop</b> away from {fmtUSD(activeLiqPrice)} liquidation price
                </div>
              </div>
            )}
            <div className={styles.cbDetail}>
              <div className={styles.cbDetailRow}>
                <span className={styles.cbDetailLabel}>CB loan balance</span>
                <span className={styles.cbDetailVal}>{fmtUSD(accruedBalance)}</span>
              </div>
              <div className={styles.cbDetailRow}>
                <span className={styles.cbDetailLabel}>Warn · liquidate</span>
                <span className={styles.cbDetailVal}>
                  <span style={{ color: 'var(--amber)' }}>{(CB_WARN_LTV * 100).toFixed(0)}%</span> · {(CB_LLTV * 100).toFixed(0)}%
                </span>
              </div>
            </div>
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
      </div>
    </div>
  );
}
