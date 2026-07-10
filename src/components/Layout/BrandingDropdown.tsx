import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import { isBackupGateSatisfied } from '../../lib/backupGate';
import { signOutLocal } from '../../lib/nostr/disconnect';
import { biometricLabel } from '../../lib/biometricLabel';
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
  // Sign out is LOCAL-ONLY: external signers (nip07/46) sign out via Settings → Disconnect, and a viewer's method
  // is null — so this one condition covers owner-only + local-only. (Each useStore call stays unconditional.)
  const nostrSigningMethod = useStore((s) => s.nostrSigningMethod);
  const wrapScheme         = useStore((s) => s.writerKeyWrapMeta?.scheme);
  const canSignOut         = nostrSigningMethod === 'local';

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
              {/* Non-destructive: the wrapped key stays on the device (and so does the verified-backup state).
                  "Remove local key" — the destructive one — deliberately lives only in Settings. */}
              <button
                className={styles.dropdownItem}
                onClick={() => {
                  const unlockWith = wrapScheme === 'pin' ? 'your PIN' : biometricLabel();
                  if (!window.confirm(`Sign out of this device? Your key stays saved here — unlock with ${unlockWith} to sign back in.`)) return;
                  setOpen(false);
                  signOutLocal();
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
