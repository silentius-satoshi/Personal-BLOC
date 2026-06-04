import { useState } from 'react';
import { useStore } from '../../store/useStore';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { fmtUSD } from '../../utils/format';
import styles from './LiqSimulator.module.css';

const SK_CEILING = 50;
const BTC_MAX    = 150_000;
const TARGETS    = [30000, 32000, 34000, 35000, 38000, 40000] as const;

function ltvClass(ltv: number) {
  if (ltv < 0.50) return styles.ltvFillGreen;
  if (ltv < 0.70) return styles.ltvFillAmber;
  return styles.ltvFillRed;
}

export function LiqSimulator() {
  const cbLoanBalance            = useStore((s) => s.cbLoanBalance);
  const cbCollateralBtc          = useStore((s) => s.cbCollateralBtc);
  const cbAprPct                 = useStore((s) => s.cbAprPct);
  const advisorActualBlocBalance = useStore((s) => s.advisorActualBlocBalance);
  const advisorActualBtcHeld     = useStore((s) => s.advisorActualBtcHeld);
  const blocApr                  = useStore((s) => s.blocApr);
  const storePrice               = useStore((s) => s.btcPrice);

  const [btcSlider,  setBtcSlider]  = useState(() => storePrice || 80_000);
  const [drawSlider, setDrawSlider] = useState(0);

  if (cbLoanBalance === 0 || cbCollateralBtc === 0) {
    return (
      <div className={styles.emptyPrompt}>
        Enter your CB loan details in the CB Loan tab to use this tool.
      </div>
    );
  }

  // Derived constants
  const cb_div    = cbCollateralBtc * CB_LLTV;
  const sk_factor = advisorActualBtcHeld * (SK_CEILING / 100);

  // Live derived values
  const sk_value         = advisorActualBtcHeld * btcSlider;
  const sk_credit_limit  = sk_value * (SK_CEILING / 100);
  const available_credit = Math.max(0, sk_credit_limit - advisorActualBlocBalance);
  const effective_draw   = Math.min(drawSlider, available_credit);

  const cb_value_now   = cbCollateralBtc * btcSlider;
  const cb_ltv_now     = cb_value_now > 0 ? cbLoanBalance / cb_value_now : 0;
  const cb_liq_now     = cb_div > 0 ? cbLoanBalance / cb_div : 0;

  const cb_balance_new = cbLoanBalance - effective_draw;
  const cb_ltv_new     = cb_value_now > 0 ? cb_balance_new / cb_value_now : 0;
  const cb_liq_new     = cb_div > 0 ? cb_balance_new / cb_div : 0;

  const sk_drawn_new   = advisorActualBlocBalance + effective_draw;
  const sk_ltv_new     = sk_value > 0 ? sk_drawn_new / sk_value : 0;

  const liq_drop         = cb_liq_now - cb_liq_new;
  const crash_buffer_now = btcSlider > 0 ? (btcSlider - cb_liq_now) / btcSlider * 100 : 0;
  const crash_buffer_new = btcSlider > 0 ? (btcSlider - cb_liq_new) / btcSlider * 100 : 0;
  const rate_delta       = blocApr - cbAprPct;
  const net_monthly_cost = effective_draw * (rate_delta / 100) / 12;

  const handleBtcSlider = (v: number) => {
    setBtcSlider(v);
    const newAvail = Math.max(0, advisorActualBtcHeld * v * (SK_CEILING / 100) - advisorActualBlocBalance);
    if (drawSlider > newAvail) setDrawSlider(newAvail);
  };

  // Progress bar scale: maps BTC price to % position across [20k, 100k] range
  const pos = (p: number) => Math.min(Math.max((p - 20_000) / 80_000 * 100, 0), 98);

  const targetMin = Math.min(...TARGETS);
  const targetMax = Math.max(...TARGETS);

  return (
    <div className={styles.container}>

      {/* A — Slider card */}
      <div className={styles.sliderCard}>
        <div className={styles.sliderLabel}>
          <span>BTC PRICE</span>
          <span className={styles.sliderValue}>${btcSlider.toLocaleString()}</span>
        </div>
        <input
          type="range"
          className={styles.sliderInput}
          min={1000}
          max={BTC_MAX}
          step={500}
          value={btcSlider}
          onChange={(e) => handleBtcSlider(Number(e.target.value))}
        />
        <div className={styles.sliderFooter}>
          <span>$1k</span>
          <span>Strike limit: {fmtUSD(sk_credit_limit)}</span>
          <span>$150k</span>
        </div>

        <div className={styles.sliderSep} />

        <div className={styles.sliderLabel}>
          <span>STRIKE DRAW → CB PAYDOWN</span>
          <span className={styles.sliderValue}>{fmtUSD(effective_draw)}</span>
        </div>
        <input
          type="range"
          className={styles.sliderInput}
          min={0}
          max={Math.max(available_credit, 1)}
          step={100}
          value={Math.min(drawSlider, available_credit)}
          disabled={available_credit === 0}
          onChange={(e) => setDrawSlider(Number(e.target.value))}
        />
        <div className={styles.sliderFooter}>
          <span>$0</span>
          <span>{fmtUSD(available_credit)} available</span>
        </div>
      </div>

      {/* B — Hero card */}
      <div className={`${styles.heroCard} ${effective_draw > 0 ? styles.heroCardActive : ''}`}>
        <span className={styles.heroCardLabel}>COINBASE LIQUIDATION PRICE</span>
        <div className={styles.heroRow}>
          {effective_draw > 0 ? (
            <>
              <span className={`${styles.heroNow} ${styles.heroStruck}`}>${Math.round(cb_liq_now).toLocaleString()}</span>
              <span className={styles.heroAfter}>→ ${Math.round(cb_liq_new).toLocaleString()}</span>
              <span className={styles.heroDrop}>↓ {fmtUSD(liq_drop)}</span>
            </>
          ) : (
            <span className={styles.heroNow}>${Math.round(cb_liq_now).toLocaleString()}</span>
          )}
        </div>

        {/* Progress bar */}
        <div className={styles.progressWrap}>
          <div className={styles.progressZone} style={{
            left:  `${pos(targetMin)}%`,
            width: `${pos(targetMax) - pos(targetMin)}%`,
          }} />
          <div className={styles.progressTick} style={{ left: `${pos(cb_liq_now)}%`, background: 'var(--text-ghost)' }} />
          {effective_draw > 0 && (
            <div className={styles.progressTick} style={{ left: `${pos(cb_liq_new)}%`, background: 'var(--amber)' }} />
          )}
          <span className={styles.progressDiamond} style={{ left: `${pos(btcSlider)}%` }}>◆</span>
        </div>
        <div className={styles.progressLegend}>
          <span>$20k</span>
          <span>Target zone</span>
          <span>$100k</span>
        </div>
      </div>

      {/* C — Position cards */}
      <div className={styles.cardsRow}>
        {/* Coinbase */}
        <div className={styles.posCard}>
          <span className={styles.posLabel}>COINBASE</span>
          <div className={styles.posRow}>
            <span className={styles.posKey}>Balance</span>
            <span className={styles.posValue}>
              {fmtUSD(cbLoanBalance)}
              {effective_draw > 0 && <span className={styles.posArrow}> → {fmtUSD(cb_balance_new)}</span>}
            </span>
          </div>
          <div className={styles.posRow}>
            <span className={styles.posKey}>Collateral</span>
            <span className={styles.posValue}>{fmtUSD(cb_value_now)}</span>
          </div>
          <div className={styles.posRow}>
            <span className={styles.posKey}>LTV</span>
            <span className={styles.posValue}>
              {(cb_ltv_now * 100).toFixed(1)}%
              {effective_draw > 0 && <span className={styles.posArrow}> → {(cb_ltv_new * 100).toFixed(1)}%</span>}
            </span>
          </div>
          <div className={styles.ltvBar}>
            <div className={`${styles.ltvFill} ${ltvClass(cb_ltv_now)}`} style={{ width: `${Math.min(cb_ltv_now * 100, 100)}%` }} />
          </div>
          <div className={styles.posRow}>
            <span className={styles.posKey}>Liq price</span>
            <span className={styles.posValue}>
              ${Math.round(cb_liq_now).toLocaleString()}
              {effective_draw > 0 && <span className={styles.posArrow}> → ${Math.round(cb_liq_new).toLocaleString()}</span>}
            </span>
          </div>
        </div>

        {/* Strike */}
        <div className={styles.posCard}>
          <span className={styles.posLabel}>STRIKE LOC</span>
          <div className={styles.posRow}>
            <span className={styles.posKey}>Collateral</span>
            <span className={styles.posValue}>{fmtUSD(sk_value)}</span>
          </div>
          <div className={styles.posRow}>
            <span className={styles.posKey}>Drawn</span>
            <span className={styles.posValue}>
              {fmtUSD(advisorActualBlocBalance)}
              {effective_draw > 0 && <span className={styles.posArrow}> → {fmtUSD(sk_drawn_new)}</span>}
            </span>
          </div>
          <div className={styles.posRow}>
            <span className={styles.posKey}>Available</span>
            <span className={styles.posValue}>{fmtUSD(available_credit)}</span>
          </div>
          <div className={styles.posRow}>
            <span className={styles.posKey}>LTV</span>
            <span className={styles.posValue}>{(sk_ltv_new * 100).toFixed(1)}%</span>
          </div>
          <div className={styles.ltvBar}>
            <div className={`${styles.ltvFill} ${ltvClass(sk_ltv_new)}`} style={{ width: `${Math.min(sk_ltv_new * 100, 100)}%` }} />
            <div className={styles.ceilingMark} style={{ left: `${SK_CEILING}%` }} />
          </div>
          <span className={styles.posHint}>50% ceiling</span>
        </div>
      </div>

      {/* D — Summary row */}
      <div className={styles.summaryRow}>
        <div className={styles.summaryCell}>
          <span className={styles.summaryLabel}>CRASH BUFFER</span>
          <span className={styles.summaryValue}>
            {crash_buffer_now.toFixed(1)}%
            {effective_draw > 0 && <span className={styles.posArrow}> → {crash_buffer_new.toFixed(1)}%</span>}
          </span>
        </div>
        <div className={styles.summaryCell}>
          <span className={styles.summaryLabel}>NET MONTHLY COST</span>
          <span className={`${styles.summaryValue} ${net_monthly_cost > 0 ? styles.summaryAmber : styles.summaryGhost}`}>
            {net_monthly_cost === 0 ? '—' : `$${Math.abs(net_monthly_cost).toFixed(0)}/mo`}
          </span>
        </div>
        <div className={styles.summaryCell}>
          <span className={styles.summaryLabel}>RATE DELTA</span>
          <span className={`${styles.summaryValue} ${rate_delta > 0 ? styles.summaryAmber : styles.summaryGhost}`}>
            {rate_delta > 0 ? '+' : ''}{rate_delta.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* E — Target guide table */}
      {TARGETS.some((T) => cbLoanBalance - T * cb_div > 0) && (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Target Liq</th>
                <th className={styles.th}>Draw Needed</th>
                <th className={styles.th}>SK LTV</th>
                <th className={styles.th}>BTC Needed</th>
                <th className={styles.th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {TARGETS.map((T) => {
                const paydown_needed = cbLoanBalance - T * cb_div;
                if (paydown_needed <= 0) return null;
                const sk_ltv_at_T  = sk_value > 0 ? (advisorActualBlocBalance + paydown_needed) / sk_value : 0;
                const btc_needed   = sk_factor > 0 ? (paydown_needed + advisorActualBlocBalance) / sk_factor : 0;
                const is_available = available_credit >= paydown_needed;
                return (
                  <tr key={T}>
                    <td className={styles.td}>${T.toLocaleString()}</td>
                    <td className={styles.td}>{fmtUSD(paydown_needed)}</td>
                    <td className={styles.td}>{(sk_ltv_at_T * 100).toFixed(1)}%</td>
                    <td className={styles.td}>${(btc_needed / 1000).toFixed(0)}k</td>
                    <td className={styles.td}>
                      {is_available
                        ? <span className={`${styles.chip} ${styles.chipGreen}`}>Available now</span>
                        : <span className={`${styles.chip} ${styles.chipAmber}`}>BTC ≥ ${(btc_needed / 1000).toFixed(0)}k</span>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className={styles.footnote}>'BTC ≥ $Xk' = min BTC price for Strike credit to fund this paydown.</p>
        </div>
      )}

    </div>
  );
}
