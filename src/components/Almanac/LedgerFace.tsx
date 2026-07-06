import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { buildLedgerCsv } from '../../lib/ledgerCsv';
import { CB_LLTV } from '../../simulation/runCoinbaseLoan';
import { cbBarLevel } from '../../simulation/cbMetrics';
import { deriveSafetyView, selectSafetyViewInputs, LEVEL_COLOR } from '../../simulation/safetyView';
import { todayLocalISO } from '../../utils/format';
import styles from './LedgerFace.module.css';

/**
 * Almanac Ledger face (M-L1) — a READ-ONLY accounting table of the owner's `monthlyLog` + CSV export.
 * WRITES NOTHING (the "one Ledger writes actuals" invariant is the Daily surface, not this view).
 * Data-presence gated by AlmanacView (`ledgerFaceAvailable`) → mounts only with ≥1 logged month.
 *
 * Ink hierarchy (spec): flow columns --text-primary, stock columns --text-secondary, the ₿ prefix is
 * the only ornament. Strike LTV is zone-colored by fixed thresholds (Strike-only); CB LTV is colored by
 * the app's SHARED CB gauge logic (cbBarLevel + LEVEL_COLOR) so it matches the SafetyDashboard exactly.
 */

// Strike LTV zone thresholds (Strike-only — NOT applied to CB). green < 10%, amber 10–13%, red > 13%.
const LTV_AMBER_AT = 0.10;
const LTV_RED_AT = 0.13;
// The Strike micro-meter fills to the 15% operating ceiling; the CB meter fills to CB_LLTV (0.86).
const STRIKE_METER_CEIL = 0.15;

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
const fmtUsd0 = (n: number): string => Math.round(n).toLocaleString();
const fmtBtc = (n: number): string => n.toFixed(5);
const fmtPct = (ltv: number): string => `${(ltv * 100).toFixed(1)}%`;

function strikeZoneColor(ltv: number): string {
  if (ltv > LTV_RED_AT) return 'var(--red)';
  if (ltv >= LTV_AMBER_AT) return 'var(--amber)';
  return 'var(--green)';
}

export default function LedgerFace() {
  const monthlyLog = useStore((s) => s.monthlyLog);
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  const showMining = useStore((s) => s.showMiningInLog);
  const cbLtvTriggerPct = useStore((s) => s.cbLtvTriggerPct);
  // CB cell coloring reuses the live CB gauge boundary — cbLiqFrac from the same derivation SafetyDashboard uses.
  const cbLiqFrac = deriveSafetyView(useStore(useShallow(selectSafetyViewInputs))).cbLiqFrac;

  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'err'>('idle');

  const rows = useMemo(() => [...monthlyLog].sort((a, b) => a.month - b.month), [monthlyLog]);
  const csv = useMemo(
    () => buildLedgerCsv(monthlyLog, { hasCbLoan, showMining }),
    [monthlyLog, hasCbLoan, showMining],
  );

  const cbZoneColor = (cbLtv: number): string => LEVEL_COLOR[cbBarLevel(cbLtv, cbLtvTriggerPct, cbLiqFrac)];

  async function copyCsv() {
    try {
      await navigator.clipboard.writeText(csv);
      setCopyState('ok');
    } catch {
      setCopyState('err');
    }
    setTimeout(() => setCopyState('idle'), 2000);
  }

  // Blob + <a download> — mirrors downloadPlanBackup. NOTE: iOS-PWA standalone can open-instead-of-save;
  // Copy CSV is the always-present reliable fallback there.
  function downloadCsv() {
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `personal-bloc-ledger-${todayLocalISO()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const colCount = 7 + (hasCbLoan ? 2 : 0) + (showMining ? 1 : 0);
  const anyNote = rows.some((e) => e.ndpPaid != null || e.strikeMinPaid != null);

  // Totals — FLOWS are SUMMED (income/paydown/btcBought/miningSats accumulate over the period);
  // STOCKS SHOW LATEST (balances/collateral/LTVs are point-in-time, so the last month's value stands).
  const latest = rows[rows.length - 1];
  const totIncome = rows.reduce((s, e) => s + e.income, 0);
  const totPaydown = rows.reduce((s, e) => s + e.paydown, 0);
  const totBought = rows.reduce((s, e) => s + e.btcBought, 0);
  const totMining = rows.reduce((s, e) => s + (e.miningSats ?? 0), 0);

  const copyLabel = copyState === 'ok' ? 'Copied ✓' : copyState === 'err' ? 'Copy failed' : 'Copy CSV';

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Ledger</div>
        <div className={styles.framing}>Your logged months, top to bottom.</div>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.actionBtn} onClick={copyCsv}>{copyLabel}</button>
        <button type="button" className={styles.actionBtn} onClick={downloadCsv}>Download .csv</button>
      </div>

      {rows.length === 0 ? (
        <div className={styles.empty}>No months logged yet.</div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={`${styles.th} ${styles.moCell}`}>Mo</th>
                <th className={styles.th}>Income→BTC</th>
                <th className={styles.th}>Paydown</th>
                <th className={styles.th}>BTC bought</th>
                <th className={styles.th}>Strike bal</th>
                <th className={styles.th}>Strike col</th>
                <th className={styles.th}>Strike LTV</th>
                {hasCbLoan && <th className={styles.th}>CB bal</th>}
                {hasCbLoan && <th className={styles.th}>CB LTV</th>}
                {showMining && <th className={styles.th}>Mining</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((e, i) => {
                const rowNote = e.ndpPaid != null || e.strikeMinPaid != null;
                const sc = strikeZoneColor(e.strikeLtv);
                return (
                  <tr
                    key={e.month}
                    className={e.confirmed === false ? styles.rowReview : undefined}
                    style={{ animationDelay: `${i * 15}ms` }}
                  >
                    <td className={`${styles.td} ${styles.moCell} ${e.provisional ? styles.moProvisional : ''}`}>
                      {e.month}
                    </td>
                    <td className={`${styles.td} ${styles.flow}`}>{fmtUsd0(e.income)}</td>
                    <td className={`${styles.td} ${styles.flow}`}>
                      {fmtUsd0(e.paydown)}
                      {rowNote && <sup className={styles.note}>†</sup>}
                    </td>
                    <td className={`${styles.td} ${styles.flow}`}>
                      <span className={styles.btcPre}>₿</span>{fmtBtc(e.btcBought)}
                    </td>
                    <td className={`${styles.td} ${styles.stock}`}>{fmtUsd0(e.strikeBal)}</td>
                    <td className={`${styles.td} ${styles.stock}`}>
                      <span className={styles.btcPre}>₿</span>{fmtBtc(e.btcHeld)}
                    </td>
                    <td className={styles.td}>
                      <div className={styles.ltvCell}>
                        <span style={{ color: sc }}>{fmtPct(e.strikeLtv)}</span>
                        <span className={styles.meterTrack}>
                          <span
                            className={styles.meterFill}
                            style={{ width: `${clamp01(e.strikeLtv / STRIKE_METER_CEIL) * 100}%`, background: sc }}
                          />
                        </span>
                      </div>
                    </td>
                    {hasCbLoan && (
                      <td className={`${styles.td} ${styles.stock}`}>{e.cbBal != null ? fmtUsd0(e.cbBal) : '—'}</td>
                    )}
                    {hasCbLoan && (
                      <td className={styles.td}>
                        {e.cbLtv != null ? (
                          <div className={styles.ltvCell}>
                            <span style={{ color: cbZoneColor(e.cbLtv) }}>{fmtPct(e.cbLtv)}</span>
                            <span className={styles.meterTrack}>
                              <span
                                className={styles.meterFill}
                                style={{ width: `${clamp01(e.cbLtv / CB_LLTV) * 100}%`, background: cbZoneColor(e.cbLtv) }}
                              />
                            </span>
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                    )}
                    {showMining && (
                      <td className={`${styles.td} ${styles.stock}`}>
                        {e.miningSats != null ? e.miningSats.toLocaleString() : '—'}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {/* Double hairline — the accounting close (two 1px --line rules, 3px apart). */}
              <tr className={styles.closeRule}>
                <td colSpan={colCount} />
              </tr>
              <tr>
                <td className={`${styles.totalTd} ${styles.moCell} ${styles.totalLabel}`}>Total</td>
                <td className={styles.totalTd}>{fmtUsd0(totIncome)}</td>
                <td className={styles.totalTd}>{fmtUsd0(totPaydown)}</td>
                <td className={styles.totalTd}><span className={styles.btcPre}>₿</span>{fmtBtc(totBought)}</td>
                <td className={styles.totalTd}>{fmtUsd0(latest.strikeBal)}</td>
                <td className={styles.totalTd}><span className={styles.btcPre}>₿</span>{fmtBtc(latest.btcHeld)}</td>
                <td className={styles.totalTd}>{fmtPct(latest.strikeLtv)}</td>
                {hasCbLoan && <td className={styles.totalTd}>{latest.cbBal != null ? fmtUsd0(latest.cbBal) : '—'}</td>}
                {hasCbLoan && <td className={styles.totalTd}>{latest.cbLtv != null ? fmtPct(latest.cbLtv) : '—'}</td>}
                {showMining && <td className={styles.totalTd}>{totMining.toLocaleString()}</td>}
              </tr>
            </tfoot>
          </table>

          {anyNote && (
            <div className={styles.footnote}>† includes a non-draw / minimum payment.</div>
          )}
        </div>
      )}
    </div>
  );
}
