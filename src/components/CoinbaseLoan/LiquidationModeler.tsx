import { useState } from 'react';
import { computeLiquidationAnalysis, CB_LIF } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';
import styles from './LiquidationModeler.module.css';

interface LiquidationModelerProps {
  loanBalance:      number;
  collateralBtc:    number;
  btcPrice:         number;
  liquidationPrice: number;
}

const REPAY_LABELS = ['25% REPAID', '50% REPAID', '75% REPAID', '100% REPAID ← full wipe'] as const;

export function LiquidationModeler({ loanBalance, collateralBtc, btcPrice, liquidationPrice }: LiquidationModelerProps) {
  const [showDetail, setShowDetail] = useState(false);

  if (liquidationPrice === 0 || btcPrice === 0) {
    return (
      <div className={styles.emptyCard}>
        <span className={styles.emptyTitle}>LIQUIDATION MATH</span>
        <span className={styles.emptyHint}>Enter your Coinbase liquidation price in the sidebar to see scenarios.</span>
      </div>
    );
  }

  const analysis = computeLiquidationAnalysis(loanBalance, collateralBtc, btcPrice, liquidationPrice);
  const dropPct  = ((btcPrice - liquidationPrice) / btcPrice * 100).toFixed(1);

  return (
    <div className={styles.modeler}>
      {/* Header */}
      <div className={styles.headerRow}>
        <span className={styles.sectionTitle}>LIQUIDATION MATH</span>
        <span className={styles.lifPill}>LIF {analysis.lifPct.toFixed(2)}%</span>
      </div>

      {/* Context line */}
      {analysis.isAlreadyLiquidatable ? (
        <p className={styles.contextWarning}>
          ⚠ BTC IS AT OR BELOW YOUR LIQUIDATION PRICE — LIQUIDATION MAY BE ACTIVE
        </p>
      ) : (
        <p className={styles.contextLine}>
          At your Coinbase liquidation price of {fmtUSD(liquidationPrice)} — a {dropPct}% drop from current
        </p>
      )}

      {/* Scenario cards */}
      <div className={styles.scenarioRow}>
        {analysis.scenarios.map((s, i) => (
          <div
            key={s.repayPct}
            className={`${styles.scenarioCard} ${i === 3 ? styles.scenarioCardFull : ''}`}
          >
            <span className={styles.scenarioLabel}>{REPAY_LABELS[i]}</span>
            <div className={styles.youKeepSection}>
              <span className={styles.youKeepTag}>YOU KEEP</span>
              <span className={styles.youKeepBtc}>{s.remainingCollateralBtc.toFixed(5)} ₿</span>
              <span className={styles.youKeepUsd}>{fmtUSD(s.remainingCollateralUsd)}</span>
            </div>
            <div className={styles.cardDivider} />
            <div className={styles.cardRow}>
              <span>Debt left</span>
              <span>{fmtUSD(s.remainingDebt)}</span>
            </div>
            <div className={`${styles.cardRow} ${styles.cardRowRed}`}>
              <span>Liq. bonus</span>
              <span>{fmtUSD(s.lifBonus)}</span>
            </div>
            <div className={`${styles.cardRow} ${s.stillLiquidatable ? styles.cardRowRed : styles.cardRowGreen}`}>
              <span>New LTV</span>
              <span>{(s.newLtv * 100).toFixed(1)}%{s.stillLiquidatable ? ' ⚠' : ' ✓'}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Detail table toggle (mobile) */}
      <button className={styles.toggleBtn} onClick={() => setShowDetail((v) => !v)}>
        {showDetail ? 'Hide details' : 'Show details'}
      </button>

      {/* Detail table — always in DOM; class controls mobile visibility */}
      <div className={!showDetail ? styles.tableCollapsed : styles.tableWrap}>
        <div className={styles.tableScroll}>
          <table className={styles.detailTable}>
            <thead>
              <tr>
                <th>Metric</th>
                <th>25%</th>
                <th>50%</th>
                <th>75%</th>
                <th className={styles.colFull}>100%</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: 'Debt repaid',            fmt: (s: typeof analysis.scenarios[0]) => fmtUSD(s.debtRepaid) },
                { label: 'Collateral seized (USD)', fmt: (s: typeof analysis.scenarios[0]) => fmtUSD(s.collateralSeizedUsd) },
                { label: 'Collateral seized (BTC)', fmt: (s: typeof analysis.scenarios[0]) => s.collateralSeizedBtc.toFixed(5) + ' ₿' },
                { label: 'LIF penalty',             fmt: (s: typeof analysis.scenarios[0]) => fmtUSD(s.lifBonus) },
                { label: 'Remaining debt',          fmt: (s: typeof analysis.scenarios[0]) => fmtUSD(s.remainingDebt) },
                { label: 'Remaining BTC',           fmt: (s: typeof analysis.scenarios[0]) => s.remainingCollateralBtc.toFixed(5) + ' ₿', green: true },
                { label: 'Remaining USD',           fmt: (s: typeof analysis.scenarios[0]) => fmtUSD(s.remainingCollateralUsd) },
                { label: 'New LTV',                 fmt: (s: typeof analysis.scenarios[0]) => (s.newLtv * 100).toFixed(1) + '%' },
              ].map(({ label, fmt, green }) => (
                <tr key={label}>
                  <td className={styles.rowLabel}>{label}</td>
                  {analysis.scenarios.map((s, i) => (
                    <td
                      key={i}
                      className={`${i === 3 ? styles.colFull : ''} ${green ? styles.cellGreen : ''}`}
                    >
                      {fmt(s)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footnote */}
      <p className={styles.footnote}>
        Liquidation price supplied by Coinbase. Effective price used: {fmtUSD(analysis.effectivePrice)}.{' '}
        CB_LIF = {CB_LIF.toFixed(5)} (Morpho formula at 86% LLTV).
      </p>
    </div>
  );
}
