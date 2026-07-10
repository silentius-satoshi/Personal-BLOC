import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { signOut, signOutConfirmMessage } from '../../lib/nostr/disconnect';
import styles from './BrandingDropdown.module.css';

export function BrandingDropdown() {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
  const ref = useRef<HTMLDivElement>(null);
  const activeTab      = useStore((s) => s.activeTab);
  const setActiveTab   = useStore((s) => s.setActiveTab);
  const setPreviousTab = useStore((s) => s.setPreviousTab);
  // R2c-2 ladder rung 1 (full-mode) — the ⚙ Settings entry lives in a collapsed portal, so the backup-alert
  // dot rides the always-visible branding trigger. Full mode is owner-only; a viewer's keyProvenance is null →
  // gate satisfied → no dot. Clears reactively when the ceremony flips backupVerifiedAt.
  const keyProvenance    = useStore((s) => s.keyProvenance);
  const backupVerifiedAt = useStore((s) => s.backupVerifiedAt);
  const settingsAlert    = !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt });
  // Sign out is METHOD-AWARE (see signOut() in disconnect.ts): a user must never get sign-out on one surface and
  // not another based on which signer they use. A viewer's method is null (and viewers never reach the full-mode
  // shell anyway), so this one condition still excludes them. (Each useStore call stays unconditional.)
  const nostrSigningMethod = useStore((s) => s.nostrSigningMethod);
  const wrapScheme         = useStore((s) => s.writerKeyWrapMeta?.scheme);
  const canSignOut         = !!nostrSigningMethod;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const openDropdown = () => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect) {
      setDropdownPos({ top: rect.bottom + 6, right: window.innerWidth - rect.right });
    }
    setOpen((o) => !o);
  };

  const openSettings = () => {
    if (activeTab !== 'settings') {
      setPreviousTab(activeTab as Exclude<typeof activeTab, 'settings'>);
    }
    setActiveTab('settings');
    setOpen(false);
  };

  return (
    <div className={styles.wrapper} ref={ref}>
      <button
        className={styles.brandingBtn}
        onClick={openDropdown}
        aria-expanded={open}
      >
        <span className={styles.logo}>₿</span>
        <span className={styles.title}>Personal ₿LOC</span>
      </button>
      {settingsAlert && <span className={styles.badgeDot} aria-hidden="true" />}

      {open && createPortal(
        <div className={styles.dropdown} style={{ top: dropdownPos.top, right: dropdownPos.right }} onMouseDown={(e) => e.stopPropagation()}>
          <button className={styles.dropdownItem} onClick={openSettings}>
            <span className={styles.dropdownIcon}>⚙</span>
            Settings
          </button>
          {canSignOut && (
            <>
              <div className={styles.dropdownDivider} />
              {/* Reversible on every method (the dispatch picks the teardown that actually signs THAT signer out).
                  "Remove local key" — the destructive one — deliberately lives only in Settings. */}
              <button
                className={styles.dropdownItem}
                onClick={() => {
                  if (!window.confirm(signOutConfirmMessage(nostrSigningMethod, wrapScheme))) return;
                  setOpen(false);
                  signOut(nostrSigningMethod);
                }}
              >
                <span className={styles.dropdownIcon}>⎋</span>
                Sign out
              </button>
            </>
          )}
        </div>,
        document.body
      )}
    </div>
  );
}
