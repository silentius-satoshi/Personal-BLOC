import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore, buildViewerSnapshotPayload } from '../../store/useStore';
import { selectSafetyViewInputs, previewSafeSnapFromPayload } from '../../simulation/safetyView';
import { ViewerHomeView } from './ViewerHomeView';
import styles from './ViewerPreview.module.css';

const noop = () => {};

/**
 * Owner-only "Preview as viewer" — renders the REAL ViewerHomeView from the ACTUAL viewer-snapshot pipeline,
 * faithful to the current privacy mode. Safe mode: build the real payload → previewSafeSnapFromPayload → inject
 * the SafeSnapshot (ViewerHomeView scales it to live price). Trusted mode: inject null → the live-derive path
 * (what a trusted viewer's hydrated store shows). Fidelity ≡ wire payload by construction. Gated to the owner
 * simple-mode branch in AppShell; `viewerPreview` is transient (never persisted).
 */
export function ViewerPreview() {
  const trusted = useStore((s) => s.viewerPrivacyTrusted);
  const label   = useStore((s) => s.viewerLabel);
  const setViewerPreview = useStore((s) => s.setViewerPreview);
  const inputs    = useStore(useShallow(selectSafetyViewInputs));   // stable ref while values unchanged
  const btcPrice  = useStore((s) => s.btcPrice);
  const hasCbLoan = useStore((s) => s.hasCbLoan);
  const previewSnap = useMemo(
    () => (trusted ? null : previewSafeSnapFromPayload(buildViewerSnapshotPayload(useStore.getState()))),
    [trusted, inputs, btcPrice, hasCbLoan],   // bound slices — preview recomputes on owner edits
  );

  return (
    <div>
      <div className={styles.previewBar}>
        <span className={styles.previewLabel}>
          PREVIEW · what {label || 'your viewer'} sees — {trusted ? 'Trusted mode' : 'Safe mode'}
        </span>
        <button className={styles.exitBtn} onClick={() => setViewerPreview(false)}>✕ Exit preview</button>
      </div>
      <ViewerHomeView previewSafeSnap={previewSnap} hideSettingsNav onOpenSettings={noop} />
    </div>
  );
}
