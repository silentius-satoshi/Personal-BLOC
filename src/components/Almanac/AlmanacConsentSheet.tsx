import { DraggableSheet } from '../ui/DraggableSheet';
import { PROVIDERS } from '../../hooks/useChainTip';
import styles from './AlmanacConsentSheet.module.css';

/**
 * Almanac P3 — one-time consent sheet shown on the FIRST enable of live block height (badge-tap path).
 * Discloses the four public explorers tried in turn + the "height only, no identity" reassurance. Confirm
 * sets consent + enables; cancel stays offline. Silent toggling thereafter. Tokens only; wrapped in the
 * shared DraggableSheet (P1). Static content → never dirty. 🔴 Imports nothing from the risk core.
 */
export interface AlmanacConsentSheetProps {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function AlmanacConsentSheet({ open, onConfirm, onCancel }: AlmanacConsentSheetProps) {
  if (!open) return null;

  return (
    <DraggableSheet open={open} onDismiss={onCancel} maxHeight="92vh" labelledBy="almanacConsentTitle">
        <div id="almanacConsentTitle" className={styles.title}>Turn on live block height?</div>
        <div className={styles.body}>
          The Almanac will fetch the current Bitcoin block height from public explorers. It tries each in
          turn until one responds:
        </div>

        <div className={styles.hosts}>
          {PROVIDERS.map((p) => (
            <span key={p.name} className={styles.host}>
              {p.name}
            </span>
          ))}
        </div>

        <div className={styles.reassure}>
          ₿ Block height only — no holdings, no balances, no identity. Nothing about you leaves the device.
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel}>
            Stay offline
          </button>
          <button type="button" className={styles.confirmBtn} onClick={onConfirm}>
            Turn on
          </button>
        </div>
    </DraggableSheet>
  );
}
