import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { buildViewerSnapshotPayload } from '../../store/payloads';
import { selectSafetyViewInputs, previewSafeSnapFromPayload } from '../../simulation/safetyView';
import { ViewerHomeView } from './ViewerHomeView';
import styles from './ViewerPreview.module.css';

const noop = () => {};

/**
 * Owner-only "Preview as viewer" — renders the REAL ViewerHomeView from the ACTUAL viewer-snapshot pipeline.
 * A preview-LOCAL Safe/Trusted override (a pure what-if lens — NEVER writes a viewer's tier) lets the owner
 * sanity-check the other mode. Safe: force the real payload down its safe branch (buildViewerSnapshotPayload(
 * state, 'safe')) → previewSafeSnapFromPayload → inject the SafeSnapshot (ViewerHomeView scales it
 * to live price). Trusted: inject null → the live-derive path (what a trusted viewer's hydrated store shows).
 * Fidelity ≡ wire payload by construction. Gated to the owner simple-mode branch in AppShell; `viewerPreview` is
 * transient (never persisted).
 */
export function ViewerPreview() {
  const trusted = useStore((s) => s.viewers[0]?.tier === 'trusted');   // M1: slot 0
  const label   = useStore((s) => s.viewers[0]?.label ?? null);
  const setViewerPreview = useStore((s) => s.setViewerPreview);
  const inputs    = useStore(useShallow(selectSafetyViewInputs));   // stable ref while values unchanged
  const btcPrice  = useStore((s) => s.btcPrice);
  const hasCbLoan = useStore((s) => s.hasCbLoan);

  const [override, setOverride] = useState<boolean | null>(null);   // null = follow the actual setting
  const effectiveTrusted = override ?? trusted;

  const previewSnap = useMemo(
    () => (effectiveTrusted
      ? null
      // force the SAFE branch through the REAL builder (fidelity ≡ wire payload under the hypothetical setting) —
      // M2: pass the tier explicitly ('safe') to the builder (the slot-0 read moved into the fan-out loop)
      : previewSafeSnapFromPayload(buildViewerSnapshotPayload(useStore.getState(), 'safe'))),
    [effectiveTrusted, inputs, btcPrice, hasCbLoan],   // bound slices — preview recomputes on owner edits
  );

  const drifting = override !== null && override !== trusted;

  return (
    <div className={styles.previewRoot}>
      <div className={styles.previewBar}>
        <div className={styles.previewBarTop}>
          <span className={styles.previewLabel}>
            PREVIEW · what {label || 'your viewer'} sees — {effectiveTrusted ? 'Trusted mode' : 'Safe mode'}
          </span>
          <button className={styles.exitBtn} onClick={() => setViewerPreview(false)}>✕ Exit preview</button>
        </div>
        <div className={styles.previewBarBottom}>
          <div className={styles.modeToggle} role="group" aria-label="Preview privacy mode">
            <button
              className={`${styles.modeBtn} ${!effectiveTrusted ? styles.modeBtnActive : ''}`}
              aria-pressed={!effectiveTrusted}
              onClick={() => setOverride(false)}
            >
              Safe
            </button>
            <button
              className={`${styles.modeBtn} ${effectiveTrusted ? styles.modeBtnActive : ''}`}
              aria-pressed={effectiveTrusted}
              onClick={() => setOverride(true)}
            >
              Trusted
            </button>
          </div>
          <span className={drifting ? styles.driftCaption : styles.actualCaption}>
            {drifting ? `previewing — actual: ${trusted ? 'Trusted' : 'Safe'}` : 'actual setting'}
          </span>
        </div>
      </div>
      <ViewerHomeView previewSafeSnap={previewSnap} preview onOpenSettings={noop} />
    </div>
  );
}
