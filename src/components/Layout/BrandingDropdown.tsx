import { useRef, useEffect, useState } from 'react';
import { useStore } from '../../store/useStore';
import styles from './BrandingDropdown.module.css';

export function BrandingDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeTab      = useStore((s) => s.activeTab);
  const setActiveTab   = useStore((s) => s.setActiveTab);
  const setPreviousTab = useStore((s) => s.setPreviousTab);

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
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className={styles.logo}>₿</span>
        <span className={styles.title}>Personal ₿LOC</span>
      </button>

      {open && (
        <div className={styles.dropdown}>
          <button className={styles.dropdownItem} onClick={openSettings}>
            <span className={styles.dropdownIcon}>⚙</span>
            Settings
          </button>
        </div>
      )}
    </div>
  );
}
