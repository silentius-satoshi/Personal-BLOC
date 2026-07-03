import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { accruedCbBalance } from '../../simulation/cbMetrics';
import { deriveCurrentPosition } from '../../simulation/logUtils';
import { BLOC_OPERATING_CEILING } from '../../simulation/strikeCredit';
import {
  classifyStage,
  firepower,
  drawToLtv,
  floorTable,
  direSwitch,
  wall3Sale,
  wall4External,
  surplus,
  type EmergencyState,
  type LadderStage,
} from '../../simulation/emergencyModel';
import { fmtUSD } from '../../utils/format';
import styles from './EmergencyConsole.module.css';

const STAGE_LABEL: Record<LadderStage, string> = {
  normal: 'Normal', watch: 'Watch', prepare: 'Prepare', execute: 'Execute',
  lastResort: 'Last Resort', liquidated: 'Liquidated',
};
const STAGE_CLASS: Record<LadderStage, string> = {
  normal: styles.stageSafe, watch: styles.stageWatch, prepare: styles.stageWatch,
  execute: styles.stageAct, lastResort: styles.stageAct, liquidated: styles.stageAct,
};

const DAY_MS = 86_400_000;

function fmtAge(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const CHECKLIST = [
  'Confirm the live Coinbase LTV in your Loan Center',
  'Draw from Strike and buy the top-up BTC',
  'Pledge the BTC to Coinbase (watch the new floor land)',
  'Re-check the new Strike margin-call price — you are now more exposed there',
  'If the floor is still breached, execute Wall 2 (Dire Switch paydown)',
];

export function EmergencyConsole() {
  const cbLoanBalance   = useStore((s) => s.cbLoanBalance);
  const cbAprPct        = useStore((s) => s.cbAprPct);
  const cbLoanBalanceAsOf = useStore((s) => s.cbLoanBalanceAsOf);
  const cbCollateralBtc = useStore((s) => s.cbCollateralBtc);
  const ceilingPct      = useStore((s) => s.cbEmergencyCeilingPct);
  const price           = useStore((s) => s.btcPrice);
  const btcPriceMode    = useStore((s) => s.btcPriceMode);
  const btcPriceUpdatedAt = useStore((s) => s.btcPriceUpdatedAt);
  const income          = useStore((s) => s.income);
  const expenses        = useStore((s) => s.expenses);
  const blocApr         = useStore((s) => s.blocApr);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const pendingCollateralAdjustment = useStore((s) => s.pendingCollateralAdjustment);
  const monthlyLog      = useStore((s) => s.monthlyLog);

  const [assumption, setAssumption] = useState<'cured' | 'stuck'>('stuck');
  const [targetLtv, setTargetLtv]   = useState(ceilingPct);
  const [openWall, setOpenWall]     = useState<number | null>(1);
  const [paydownUsd, setPaydownUsd] = useState(0);
  const [saleTargetLiq, setSaleTargetLiq] = useState(35_000);
  const [cashUsd, setCashUsd]       = useState(0);
  const [checked, setChecked]       = useState<Record<number, boolean>>({});

  if (cbLoanBalance === 0 || cbCollateralBtc === 0) {
    return <div className={styles.emptyPrompt}>Enter your CB loan details in the CB Loan tab to use the Emergency Console.</div>;
  }

  const { btcHeld: skCollateralBtc, blocBalance: skDrawn } =
    deriveCurrentPosition(monthlyLog, advisorActualBtcHeld, advisorActualBlocBalance, pendingCollateralAdjustment);

  // The accrual boundary — the model consumes the ALREADY-accrued CB debt.
  const cbDebt = accruedCbBalance(cbLoanBalance, cbAprPct, cbLoanBalanceAsOf);
  const s: EmergencyState = { cbDebt, cbCollateralBtc, skCollateralBtc, skDrawn, price, ceilingPct };

  const stage = classifyStage(s);
  const fp    = firepower(s);
  const draw  = drawToLtv(s, targetLtv);
  const rows  = floorTable(s);
  const executePrice = stage.bandPrices.execute;

  // Monthly surplus available to service the emergency (interest on the drawn-to-ceiling Strike balance).
  const skDrawnAtCeiling = (ceilingPct / 100) * skCollateralBtc * price;
  const monthlySurplus = surplus(income, expenses, skDrawnAtCeiling, blocApr);

  // ── Staleness ──────────────────────────────────────────────────────────────────
  const now = Date.now();
  const priceAgeMs  = btcPriceUpdatedAt ? now - btcPriceUpdatedAt : null;
  const loanAgeDays = cbLoanBalanceAsOf ? (now - Date.parse(cbLoanBalanceAsOf)) / DAY_MS : null;
  const priceStale  = btcPriceMode === 'manual' || (priceAgeMs !== null && priceAgeMs > 15 * 60_000);
  const loanStale   = loanAgeDays !== null && loanAgeDays > 35;
  const showBanner  = priceStale || loanStale;

  // Rail range for the stage price bar — adapts to the live figures.
  const railLo = Math.min(stage.liqPrice, price) * 0.92;
  const railHi = Math.max(price, stage.bandPrices.watch) * 1.05;
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
            <span>BTC price: {fmtUSD(price)}</span>
          </div>
        </div>
      )}

      {/* 2 — Stage header */}
      <div className={styles.stageCard}>
        <div className={styles.stageTop}>
          <span className={`${styles.stageChip} ${STAGE_CLASS[stage.stage]}`}>{STAGE_LABEL[stage.stage]}</span>
          <span className={styles.stageLtv}>{(stage.cbLtv * 100).toFixed(1)}% CB LTV</span>
        </div>
        <div className={styles.stageStats}>
          <div className={styles.stat}><span className={styles.statLabel}>Liq price</span><span className={styles.statValue}>{fmtUSD(stage.liqPrice)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Distance</span><span className={styles.statValue}>{(stage.distancePct * 100).toFixed(1)}%</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>BTC now</span><span className={styles.statValue}>{fmtUSD(price)}</span></div>
        </div>
        <div className={styles.rail}>
          {(['lastResort', 'execute', 'prepare', 'watch'] as const).map((k) => (
            <div key={k} className={styles.railTick} style={{ left: `${railPos(stage.bandPrices[k])}%`, background: 'var(--amber)' }} title={`${k}`} />
          ))}
          <div className={styles.railTick} style={{ left: `${railPos(stage.liqPrice)}%`, background: 'var(--red)' }} title="liquidation" />
          <span className={styles.railDiamond} style={{ left: `${railPos(price)}%` }}>◆</span>
        </div>
        <div className={styles.railLegend}><span>{fmtUSD(railLo)}</span><span>liq → bands → now</span><span>{fmtUSD(railHi)}</span></div>
      </div>

      {/* 3 — Firepower */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Firepower — collateral you can raise</span>
          <div className={styles.toggle}>
            <button className={`${styles.toggleBtn} ${assumption === 'stuck' ? styles.toggleActive : ''}`} onClick={() => setAssumption('stuck')}>Stuck</button>
            <button className={`${styles.toggleBtn} ${assumption === 'cured' ? styles.toggleActive : ''}`} onClick={() => setAssumption('cured')}>Cured</button>
          </div>
        </div>
        <div className={styles.fpGrid}>
          <div className={styles.fpCell}>
            <span className={styles.fpWhen}>At current price ({fmtUSD(price)})</span>
            <span className={styles.fpBtc}>{(assumption === 'cured' ? fp.slowBtc : fp.fastBtc(price)).toFixed(5)} ₿</span>
            <span className={styles.fpUsd}>{fmtUSD(assumption === 'cured' ? fp.slowUsd(price) : fp.fastUsd(price))}</span>
          </div>
          <div className={styles.fpCell}>
            <span className={styles.fpWhen}>At execute band ({fmtUSD(executePrice)})</span>
            <span className={styles.fpBtc}>{(assumption === 'cured' ? fp.slowBtc : fp.fastBtc(executePrice)).toFixed(5)} ₿</span>
            <span className={styles.fpUsd}>{fmtUSD(assumption === 'cured' ? fp.slowUsd(executePrice) : fp.fastUsd(executePrice))}</span>
          </div>
        </div>
        <p className={styles.hint}>
          {assumption === 'cured'
            ? 'Cured: assumes Strike was first paid down to the 15% operating ceiling — the whole band is free headroom.'
            : 'Stuck: uses your live Strike draw. Slower — you carry the current balance into the emergency.'}
          {' '}Monthly surplus to service: {fmtUSD(monthlySurplus)}.
        </p>
      </div>

      {/* 4 — Action calculator */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <span className={styles.cardTitle}>Draw to {targetLtv}% Strike LTV</span>
          {draw.capped && <span className={styles.capFlag}>capped at 50% line</span>}
        </div>
        <input
          type="range"
          className={styles.slider}
          min={Math.round(BLOC_OPERATING_CEILING * 100)}
          max={50}
          step={1}
          value={targetLtv}
          onChange={(e) => setTargetLtv(Number(e.target.value))}
        />
        <div className={styles.calcGrid}>
          <div className={styles.stat}><span className={styles.statLabel}>Draw</span><span className={styles.statValue}>{fmtUSD(draw.drawUsd)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>BTC added</span><span className={styles.statValue}>{draw.btcAdded.toFixed(5)} ₿</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>New floor</span><span className={styles.statValueGreen}>{fmtUSD(draw.newLiqPrice)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Floor ↓</span><span className={styles.statValueGreen}>{fmtUSD(draw.liqDrop)}</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>New Strike LTV</span><span className={styles.statValue}>{(draw.newSkLtv * 100).toFixed(1)}%</span></div>
          <div className={styles.stat}><span className={styles.statLabel}>Strike MC price</span><span className={styles.statValueAmber}>{fmtUSD(draw.newSkMarginCallPrice)}</span></div>
        </div>
        <p className={styles.hint}>Available on the 50% Strike line: {fmtUSD(draw.availableCredit)}. Top-up is the primary lever — it lowers the CB floor without paying down debt.</p>
      </div>

      {/* 5 — Floor table */}
      <div className={styles.card}>
        <span className={styles.cardTitle}>How low can the floor go</span>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th className={styles.th}>Ceiling</th><th className={styles.th}>BTC added</th><th className={styles.th}>Floor</th><th className={styles.th}>vs standing</th><th className={styles.th}>SK survives</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.standing ? 'standing' : r.ceilingPct} className={!r.standing && r.ceilingPct === ceilingPct ? styles.rowActive : ''}>
                  <td className={styles.td}>{r.standing ? 'Standing' : `${r.ceilingPct}%`}</td>
                  <td className={styles.td}>{r.standing ? '—' : `${r.btcAdded.toFixed(5)} ₿`}</td>
                  <td className={styles.td}>{fmtUSD(r.floor)}</td>
                  <td className={styles.td}>{r.standing ? '—' : `↓ ${fmtUSD(r.deltaVsStanding)}`}</td>
                  <td className={styles.td}>{(r.strikeSurvivesFurtherPct * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 6 — Ladder accordion (Walls 1–4) */}
      <div className={styles.card}>
        <span className={styles.cardTitle}>Walls — the response ladder</span>

        <Wall n={1} title="Wall 1 · Collateral top-up (primary)" open={openWall === 1} onToggle={() => setOpenWall(openWall === 1 ? null : 1)}>
          <p className={styles.wallBody}>Draw to {ceilingPct}% → add {draw.btcAdded.toFixed(5)} ₿ → floor {fmtUSD(draw.newLiqPrice)}.</p>
          <p className={styles.coupling}>⚠ Coupling: this raises your Strike margin-call price to {fmtUSD(draw.newSkMarginCallPrice)}. You are now more exposed on Strike.</p>
        </Wall>

        <Wall n={2} title="Wall 2 · Dire Switch (paydown)" open={openWall === 2} onToggle={() => setOpenWall(openWall === 2 ? null : 2)}>
          <input type="range" className={styles.slider} min={0} max={Math.max(1, Math.round(cbDebt))} step={100} value={paydownUsd} onChange={(e) => setPaydownUsd(Number(e.target.value))} />
          <p className={styles.wallBody}>Pay down {fmtUSD(paydownUsd)} → liq {fmtUSD(direSwitch(s, paydownUsd).liqAfter)}.</p>
        </Wall>

        <Wall n={3} title="Wall 3 · Sell to pay down" open={openWall === 3} onToggle={() => setOpenWall(openWall === 3 ? null : 3)}>
          <label className={styles.wallLabel}>Target liq price
            <input type="number" className={styles.numInput} value={saleTargetLiq} onChange={(e) => setSaleTargetLiq(Number(e.target.value))} />
          </label>
          <p className={styles.wallBody}>Paydown needed {fmtUSD(wall3Sale(s, saleTargetLiq).paydownNeeded)} → sell {wall3Sale(s, saleTargetLiq).btcToSell.toFixed(5)} ₿.</p>
        </Wall>

        <Wall n={4} title="Wall 4 · External cash" open={openWall === 4} onToggle={() => setOpenWall(openWall === 4 ? null : 4)}>
          <label className={styles.wallLabel}>Cash injected
            <input type="number" className={styles.numInput} value={cashUsd} onChange={(e) => setCashUsd(Number(e.target.value))} />
          </label>
          <p className={styles.wallBody}>Inject {fmtUSD(cashUsd)} → liq {fmtUSD(wall4External(s, cashUsd).liqAfter)}.</p>
        </Wall>
      </div>

      {/* 7 — Crash-day checklist (session-only) */}
      <div className={styles.card}>
        <span className={styles.cardTitle}>Crash-day checklist</span>
        {CHECKLIST.map((item, i) => (
          <label key={i} className={styles.checkRow}>
            <input type="checkbox" checked={!!checked[i]} onChange={(e) => setChecked((c) => ({ ...c, [i]: e.target.checked }))} />
            <span className={checked[i] ? styles.checkDone : ''}>{item}</span>
          </label>
        ))}
        <p className={styles.hint}>Session-only — resets when you leave. Live target: draw {fmtUSD(draw.drawUsd)} → buy {draw.btcAdded.toFixed(5)} ₿ → floor {fmtUSD(draw.newLiqPrice)}.</p>
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
