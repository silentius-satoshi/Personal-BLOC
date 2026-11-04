import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { buildViewerSnapshotPayload } from '../../store/payloads';
import { selectSafetyViewInputs, previewSafeSnapFromPayload } from '../../simulation/safetyView';
import { ViewerHomeView } from './ViewerHomeView';
import { toPageTop } from '../../utils/pageTop';
import styles from './ViewerPreview.module.css';

const noop = () => {};

/** BL50 — the preview's own label: the same words over its home and over the Almanac it opens. */
export function previewLabel(trusted: boolean): string {
  return `PREVIEW · what your viewer sees — ${trusted ? 'Trusted mode' : 'Safe mode'}`;
}

/** BL50 — over the Almanac a trusted preview opens: the label alone (the header's "← Preview" is the way back). */
export function PreviewLabel({ trusted }: { trusted: boolean }) {
  return (
    <div className={styles.previewLabelBar}>
      <span className={styles.previewLabel}>{previewLabel(trusted)}</span>
    </div>
  );
}

export interface ViewerPreviewProps {
  trusted:       boolean;                         // the roster's first viewer's tier (AppShell's one read, M1: slot 0)
  override:      boolean | null;                  // the preview's Safe/Trusted choice; null = follow `trusted`
  setOverride:   (v: boolean | null) => void;     // BL50 — AppShell keeps it, so it outlives a visit to the Almanac
  onOpenAlmanac: () => void;                      // BL50 — a trusted preview's bar opens the Almanac as he reads it
}

/**
 * Owner-only "Preview as viewer" — renders the REAL ViewerHomeView from the ACTUAL viewer-snapshot pipeline.
 * A preview Safe/Trusted override (a pure what-if lens — NEVER writes a viewer's tier; AppShell keeps it while the
 * preview lasts — BL50) lets the owner sanity-check the other mode. Safe: force the real payload down its safe branch
 * (buildViewerSnapshotPayload(state, 'safe')) → previewSafeSnapFromPayload → inject the SafeSnapshot (ViewerHomeView
 * scales it to live price). Trusted: inject null → the live-derive path (what a trusted viewer's hydrated store
 * shows). Fidelity ≡ wire payload by construction. BL50 — his bar too: Home · Almanac · Settings in Trusted mode (its
 * "Almanac" opens the hub as he reads it), Home · Settings in Safe mode; his ⚙ and Settings drawn but inert. Gated to
 * the owner simple-mode branch in AppShell; `viewerPreview` is transient (never persisted). BL51 — its way out opens
 * his Dashboard at its top, as Sharing's button opens the preview at its own (utils/pageTop).
 */
export function ViewerPreview({ trusted, override, setOverride, onOpenAlmanac }: ViewerPreviewProps) {
  const setViewerPreview = useStore((s) => s.setViewerPreview);
  const inputs    = useStore(useShallow(selectSafetyViewInputs));   // stable ref while values unchanged
  const btcPrice  = useStore((s) => s.btcPrice);
  const hasCbLoan = useStore((s) => s.hasCbLoan);

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
            {/* BL48 — names no viewer: it read the first roster slot's label, the owner's own nickname for one viewer. */}
            {previewLabel(effectiveTrusted)}
          </span>
          <button className={styles.exitBtn} onClick={() => { toPageTop(); setViewerPreview(false); }}>✕ Exit preview</button>
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
      <ViewerHomeView previewSafeSnap={previewSnap} preview onOpenSettings={noop}
        onOpenAlmanac={effectiveTrusted ? onOpenAlmanac : undefined} />
    </div>
  );
}
