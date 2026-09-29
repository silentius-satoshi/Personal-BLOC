import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { plBandsAt } from '../../simulation/powerLaw';
import { crashPlaybook } from '../../simulation/crashPlaybook';
import {
  classifyStage,
  wall3Sale,
  wall4External,
  type EmergencyState,
  type LadderStage,
} from '../../simulation/emergencyModel';
import {
  playbookInputFromLive,
  playbookCard,
  strikeHoldFrom,
  waitingCard,
  type PlaybookCard,
} from './crashPlaybookView';
import { fmtUSD, todayLocalISO, fmtLtvPct } from '../../utils/format';
import styles from './EmergencyConsole.module.css';

const STAGE_LABEL: Record<LadderStage, string> = {
  normal: 'Normal', watch: 'Watch', prepare: 'Prepare', execute: 'Execute',
  lastResort: 'Last Resort', liquidated: 'Liquidated',
};
const STAGE_CLASS: Record<LadderStage, string> = {
  normal: styles.stageSafe, watch: styles.stageWatch, prepare: styles.stageWatch,
  execute: styles.stageAct, lastResort: styles.stageAct, liquidated: styles.stageAct,
};
const FILL_COLOR: Record<LadderStage, string> = {
  normal: 'var(--green)', watch: 'var(--amber)', prepare: 'var(--amber)',
  execute: 'var(--red)', lastResort: 'var(--red)', liquidated: 'var(--red)',
};
const OUTCOME_CLASS: Record<NonNullable<PlaybookCard['outcome']>['kind'], string> = {
  held: styles.outcomeHeld, short: styles.outcomeShort, doom: styles.doomWarn,
};

const DAY_MS = 86_400_000;

function fmtAge(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// Order-neutral: the playbook names the order on the day (a shift-first day draws before any collateral moves).
const CHECKLIST = [
  'Confirm the live Coinbase LTV in your Loan Center',
  "Work the playbook's steps in the order it lists them",
  'Cold coins: send the named amount into your Coinbase collateral',
  'Strike collateral: release the named amount — Strike allows it only at or under 40% LTV, down to under 50%, and never within 60 days of a deposit',
  'Debt shift: draw the named amount on Strike and pay Coinbase down with it',
  'Re-check both LTVs and the new Strike margin-call price',
  "If the playbook says Coinbase can't clear 86%, the last resorts above are the only ways out",
];

/**
 * The crash-day page for `ltvTriggered` CB mode — READ-ONLY (no dayLog writes). Its card is `crashPlaybook` on the live
 * position and the owner's real cold, at the effective price, built through crashPlaybookView — so the console and the
 * engine give ONE answer. The power-law support crossing stays here; the model and the view module stay belief-free.
 */
export function EmergencyConsole() {
  const cbLoanBalance   = useStore((s) => s.cbLoanBalance);
  const cbAprPct        = useStore((s) => s.cbAprPct);
  const cbLoanBalanceAsOf = useStore((s) => s.cbLoanBalanceAsOf);
  const cbCollateralBtc = useStore((s) => s.cbCollateralBtc);
  const cbLtvTargetPct  = useStore((s) => s.cbLtvTargetPct);    // the line the playbook restores
  const cbLtvTriggerPct = useStore((s) => s.cbLtvTriggerPct);   // the line it fires at — between the two, the plan waits
  const livePrice       = useStore((s) => s.btcPrice);
  const btcPriceMode    = useStore((s) => s.btcPriceMode);
  const btcPriceUpdatedAt = useStore((s) => s.btcPriceUpdatedAt);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);   // the LIVE Strike balance
  const currentBtcHeld           = useStore((s) => s.getCurrentBtcHeld());   // reading-anchored current Strike collateral (v20)
  const coldBtc         = useStore((s) => s.getCurrentColdBtc());   // the live cold total
  const creditLine      = useStore((s) => s.creditLine);
  const dayLog          = useStore((s) => s.dayLog);   // Strike's 60-day hold reads the logged Strike deposits

  const [openWall, setOpenWall]     = useState<number | null>(null);
  const [saleTargetLiq, setSaleTargetLiq] = useState(35_000);
  const [cashUsd, setCashUsd]       = useState(0);
  const [checked, setChecked]       = useState<Record<number, boolean>>({});
  const [simPrice, setSimPrice]     = useState<number | null>(null);   // session-only what-if; never persisted/synced

  if (cbLoanBalance === 0 || cbCollateralBtc === 0) {
    return <div className={styles.emptyPrompt}>Enter your CB loan details in the CB Loan tab to use the Emergency Console.</div>;
  }

  const price = simPrice ?? livePrice;   // the effective price every model consumer + readout below uses
  const toggleSim = () => setSimPrice((sp) => (sp === null ? livePrice : null));

  // The accrual boundary — the model consumes the ALREADY-accrued CB debt.
  const cbDebt = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
  const s: EmergencyState = { cbDebt, cbCollateralBtc, price };

  // The power-law SUPPORT line — the fitted deep-drawdown floor. The view crosses into the power law here
  // (the model stays §7-clean); a simulation below it is flagged, never blocked.
  const support = plBandsAt(new Date(todayLocalISO())).floor;
  const stage = classifyStage(s);

  // The crash playbook on the live position: between the target and the trigger the plan waits; otherwise
  // crashPlaybook's answer, restoring the target.
  const today = todayLocalISO();
  const hold = strikeHoldFrom(dayLog, today);
  const input = playbookInputFromLive({
    price, support, cbDebt, cbCollateralBtc,
    strikeBalance: advisorActualBlocBalance, strikeCollateralBtc: currentBtcHeld, creditLine, coldBtc,
    cbLtvTargetPct, dayLog, todayISO: today,
  });
  const card = waitingCard(input, cbLtvTriggerPct) ?? playbookCard(crashPlaybook(input), input, hold);

  // ── Staleness ──────────────────────────────────────────────────────────────────
  const now = Date.now();
  const priceAgeMs  = btcPriceUpdatedAt ? now - btcPriceUpdatedAt : null;
  const loanAgeDays = cbLoanBalanceAsOf ? (now - Date.parse(cbLoanBalanceAsOf)) / DAY_MS : null;
  const priceStale  = btcPriceMode === 'manual' || (priceAgeMs !== null && priceAgeMs > 15 * 60_000);
  const loanStale   = loanAgeDays !== null && loanAgeDays > 35;
  const showBanner  = priceStale || loanStale;

  // Rail range for the stage price bar — adapts to the live figures, and always includes the support line
  // so its tick is visible wherever it sits relative to the ladder.
  const railLo = Math.min(stage.liqPrice, price, support) * 0.92;
  const railHi = Math.max(price, stage.bandPrices.watch, support) * 1.05;
  const railPos = (p: number) => Math.min(Math.max((p - railLo) / (railHi - railLo) * 100, 0), 100);

  return (
    <div className={styles.container}>

      {/* 1 — Staleness banner */}
      {showBanner && (
        <div className={styles.staleBanner}>
          <strong>⚠ Figures may be stale — verify before acting.</strong>
          <div className={styles.staleRow}>
            <span>Price: {btcPriceMode === 'manual' ? 'manual entry' : priceAgeMs !== null ? `${fmtAge(priceAgeMs)} old` : 'unknown'}</span>
            <span>CB balance: {loanAgeDays !== null ? `${Math.floor(loanAgeDays)}d since re-anchor` : 'never re-anchored'}</span>
            <span>BTC price: {fmtUSD(livePrice)}</span>
          </div>
        </div>
      )}

      {/* 1b — Simulate-price banner (session-only what-if; distinct amber from the red staleness banner) */}
      {simPrice !== null && (
        <div className={styles.simBanner}>
          <span><strong>SIMULATING {fmtUSD(simPrice)}</strong> — live {fmtUSD(livePrice)}</span>
          <button className={styles.simExitBtn} onClick={() => setSimPrice(null)}>Exit</button>
        </div>
      )}

      {/* 2 — Stage header */}
      <div className={styles.stageCard}>
        <div className={styles.stageTop}>
          <span className={`${styles.stageChip} ${STAGE_CLASS[stage.stage]}`}>{STAGE_LABEL[stage.stage]}</span>
          <div className={styles.stageTopRight}>
            <span className={styles.stageLtv}>{fmtLtvPct(stage.cbLtv, 1)} CB LTV</span>
            <button className={`${styles.simBtn} ${simPrice !== null ? styles.simBtnActive : ''}`} onClick={toggleSim}>
              {simPrice !== null ? 'Exit sim' : 'Simulate'}
            </button>
          </div>
        </div>
        <div className={styles.stageStats}>
          <div className={styles.stat}><span className={styles.statLabel}>Liq price</span><span className={styles.statValue}>{fmtUSD(stage.liqPrice)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Distance</span><span className={styles.statValue}>{fmtLtvPct(stage.distancePct, 1)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>{simPrice !== null ? 'BTC SIM' : 'BTC now'}</span><span className={styles.statValue}>{fmtUSD(price)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Support line</span><span className={styles.statValue}>{fmtUSD(support)}</span></div>
        </div>
        <p className={styles.hint}>
          {stage.liqPrice > 0 && stage.liqPrice < support
            ? `Liquidation sits below the power-law support line — the fitted floor would hold first.`
            : `Liquidation sits above the power-law support line — the position would liquidate before the fitted floor.`}
          {' '}The band is a historical regression, not a guarantee.
        </p>
        <div className={styles.rail}>
          <div className={styles.railFill} style={{ width: `${railPos(price)}%`, background: FILL_COLOR[stage.stage] }} />
          {(['lastResort', 'execute', 'prepare', 'watch'] as const).map((k) => (
            <div key={k} className={styles.railTick} style={{ left: `${railPos(stage.bandPrices[k])}%`, background: 'var(--amber)' }} title={`${k}`} />
          ))}
          <div className={styles.railTick} style={{ left: `${railPos(stage.liqPrice)}%`, background: 'var(--red)' }} title="liquidation" />
          <div className={styles.railTick} style={{ left: `${railPos(support)}%`, background: 'var(--green)' }} title={`support ${fmtUSD(support)}`} />
          <span className={styles.railDiamond} style={{ left: `${railPos(price)}%` }}>◆</span>
        </div>
        <div className={styles.railLegend}><span>{fmtUSD(railLo)}</span><span>liq · bands · now · support</span><span>{fmtUSD(railHi)}</span></div>
        {simPrice !== null && (
          <div className={styles.simScrub}>
            <input
              type="range"
              className={styles.slider}
              min={Math.round(stage.liqPrice * 0.90)}
              max={Math.round(livePrice * 1.10)}
              step={100}
              value={simPrice}
              onChange={(e) => setSimPrice(Number(e.target.value))}
            />
            <span className={styles.simScrubValue}>{fmtUSD(simPrice)}</span>
          </div>
        )}
        {simPrice !== null && simPrice < support && (
          <p className={styles.hint} style={{ color: 'var(--amber)' }}>
            Below the power-law support line ({fmtUSD(support)}) — outside the fitted drawdown envelope.
            The model keeps running; nothing calibrates this depth.
          </p>
        )}
      </div>

      {/* 3 — Crash playbook (crashPlaybook on the live position, at the effective price) */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Crash playbook</span>
          <span className={styles.orderBadge}>{card.badge}</span>
        </div>
        {card.pastLiquidation && <p className={styles.pastLiq}>{card.pastLiquidation}</p>}
        <p className={styles.playbookText}>{card.depth}</p>
        {card.steps.length > 0 && (
          <ol className={styles.steps}>
            {card.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        )}
        {card.gap && <p className={styles.hint}>{card.gap}</p>}
        {card.strikeNote && <p className={styles.hint}>{card.strikeNote}</p>}
        {card.after && <p className={styles.afterLine}>{card.after}</p>}
        {card.outcome && <p className={OUTCOME_CLASS[card.outcome.kind]}>{card.outcome.text}</p>}
      </div>

      {/* 4 — Last resorts (paydown-numerator walls) */}
      <div className={styles.card}>
        <span className={styles.cardTitle}>Last resorts</span>

        <Wall n={3} title="Sell to pay down" open={openWall === 3} onToggle={() => setOpenWall(openWall === 3 ? null : 3)}>
          <label className={styles.wallLabel}>Target liq price
            <input type="number" className={styles.numInput} value={saleTargetLiq} onChange={(e) => setSaleTargetLiq(Number(e.target.value))} />
          </label>
          <p className={styles.wallBody}>Paydown needed {fmtUSD(wall3Sale(s, saleTargetLiq).paydownNeeded)} → sell {wall3Sale(s, saleTargetLiq).btcToSell.toFixed(5)} ₿.</p>
        </Wall>

        <Wall n={4} title="Outside cash" open={openWall === 4} onToggle={() => setOpenWall(openWall === 4 ? null : 4)}>
          <label className={styles.wallLabel}>Cash injected
            <input type="number" className={styles.numInput} value={cashUsd} onChange={(e) => setCashUsd(Number(e.target.value))} />
          </label>
          <p className={styles.wallBody}>Inject {fmtUSD(cashUsd)} → liq {fmtUSD(wall4External(s, cashUsd).liqAfter)}.</p>
        </Wall>
      </div>

      {/* 5 — Crash-day checklist (session-only) */}
      <div className={styles.card}>
        <span className={styles.cardTitle}>Crash-day checklist</span>
        {CHECKLIST.map((item, i) => (
          <label key={i} className={styles.checkRow}>
            <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))} />
            <span className={checked[i] ? styles.checkDone : ''}>{item}</span>
          </label>
        ))}
        <p className={styles.hint}>Session-only — resets when you leave.</p>
      </div>

    </div>
  );
}

function Wall({ title, open, onToggle, children }: {
  n: number; title: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className={styles.wall}>
      <button className={styles.wallHead} onClick={onToggle} aria-expanded={open}>
        <span>{title}</span><span className={styles.wallChevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && <div className={styles.wallContent}>{children}</div>}
    </div>
  );
}
