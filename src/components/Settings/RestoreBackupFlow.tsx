import { useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { validatePlanBackup, type ImportSummary } from '../../lib/backup/validatePlanBackup';
import type { PlanBackup } from '../../lib/backup/exportPlan';
import { fmtUSD } from '../../utils/format';
import styles from './RestoreBackupFlow.module.css';

// Plan Import/Restore — a self-contained ceremony-style overlay (mirrors RecoveryKeyCeremony; owns the screen so no
// back-chain/edge-swipe escapes mid-restore). Owner-only by construction: mounted only from the SettingsMain Backup
// subpage, which is behind !viewerMode. pick → validate → summary+confirm → atomic apply → done.

type Step = 'pick' | 'validating' | 'summary' | 'applying' | 'done' | 'error';

const MAX_FILE_BYTES = 10 * 1024 * 1024;   // 10 MB — reject before parse

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function RestoreBackupFlow({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>('pick');
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const backupRef = useRef<PlanBackup | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fail = (message: string) => { setError(message); setStep('error'); };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';   // reset so re-picking the same file re-fires onChange
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) { fail('That file is too large to be a plan backup.'); return; }
    setStep('validating');
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try { parsed = JSON.parse(String(reader.result)); }
      catch { fail('This file isn’t valid JSON — it may be corrupted.'); return; }
      const result = validatePlanBackup(parsed);
      if (!result.ok) { fail(result.reason.message); return; }
      backupRef.current = result.backup;
      setSummary(result.summary);
      setStep('summary');
    };
    reader.onerror = () => fail('Couldn’t read that file.');
    reader.readAsText(file);
  };

  const doApply = () => {
    const backup = backupRef.current;
    if (!backup) return;
    setStep('applying');
    // yield a frame so "Restoring…" paints before the synchronous atomic setState
    setTimeout(() => {
      useStore.getState().applyPlanBackup(backup);
      setStep('done');
    }, 30);
  };

  return (
    <div className={styles.overlay}>
      <div className={styles.modal} role="dialog" aria-modal="true">
        <div className={styles.brandRing}>↺</div>

        {step === 'pick' && (
          <>
            <h2 className={styles.title}>Restore from backup</h2>
            <p className={styles.body}>
              Load a plan backup file you exported from Personal ₿LOC. We’ll check it and show you what’s inside
              before anything changes.
            </p>
            <input
              ref={fileRef}
              className={styles.fileInput}
              type="file"
              accept="application/json,.json"
              onChange={onFileChange}
            />
            <button className={styles.primary} onClick={() => fileRef.current?.click()}>Choose backup file</button>
            <button className={styles.ghost} onClick={onClose}>Cancel</button>
          </>
        )}

        {step === 'validating' && (
          <>
            <h2 className={styles.title}>Checking backup…</h2>
            <span className={styles.spinner}>Validating the file</span>
          </>
        )}

        {step === 'summary' && summary && (
          <>
            <h2 className={styles.title}>Restore this backup?</h2>
            <div className={styles.summaryCard}>
              <span className={styles.summaryDate}>Backup from {fmtDate(summary.exportedAt)}</span>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Months logged</span>
                <span className={styles.summaryValue}>{summary.months}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>Day events</span>
                <span className={styles.summaryValue}>{summary.dayEvents}</span>
              </div>
              {summary.settingsPreview.income != null && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Income · expenses</span>
                  <span className={styles.summaryValue}>{fmtUSD(summary.settingsPreview.income)} · {fmtUSD(summary.settingsPreview.expenses ?? 0)}</span>
                </div>
              )}
              {summary.settingsPreview.advisorActualBlocBalance != null && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Strike BLOC balance</span>
                  <span className={styles.summaryValue}>{fmtUSD(summary.settingsPreview.advisorActualBlocBalance)}</span>
                </div>
              )}
              {summary.settingsPreview.cbLoanBalance != null && summary.settingsPreview.cbLoanBalance > 0 && (
                <div className={styles.summaryRow}>
                  <span className={styles.summaryLabel}>Coinbase loan balance</span>
                  <span className={styles.summaryValue}>{fmtUSD(summary.settingsPreview.cbLoanBalance)}</span>
                </div>
              )}
            </div>
            <p className={styles.body}>
              Replace this device’s plan with the backup from {fmtDate(summary.exportedAt)}?
            </p>
            <p className={styles.warn}>
              Settings are replaced. Events logged after this backup will merge back from your relays. This device’s
              current unsynced changes are lost.
            </p>
            <button className={styles.danger} onClick={doApply}>Restore this backup</button>
            <button className={styles.ghost} onClick={onClose}>Cancel</button>
          </>
        )}

        {step === 'applying' && (
          <>
            <h2 className={styles.title}>Restoring…</h2>
            <span className={styles.spinner}>Replacing your plan</span>
          </>
        )}

        {step === 'done' && (
          <>
            <div className={styles.brandRing}>✓</div>
            <h2 className={styles.title}>Restored</h2>
            <p className={styles.body}>
              Your plan was restored{summary ? ` from ${fmtDate(summary.exportedAt)}` : ''}. Sync has resumed — any
              events logged after this backup will merge back on the next pull.
            </p>
            <button className={styles.primary} onClick={onClose}>Done</button>
          </>
        )}

        {step === 'error' && (
          <>
            <h2 className={styles.title}>Can’t restore this file</h2>
            <p className={styles.error}>{error}</p>
            <button className={styles.primary} onClick={() => { setError(''); setStep('pick'); }}>Try another file</button>
            <button className={styles.ghost} onClick={onClose}>Cancel</button>
          </>
        )}
      </div>
    </div>
  );
}
