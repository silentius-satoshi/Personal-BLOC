import { useRef, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useStore } from '../../store/useStore';
import styles from './BrandingDropdown.module.css';

export function BrandingDropdown() {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, right: 0 });
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

      {open && createPortal(
        <div className={styles.dropdown} style={{ top: dropdownPos.top, right: dropdownPos.right }} onMouseDown={(e) => e.stopPropagation()}>
          <button className={styles.dropdownItem} onClick={openSettings}>
            <span className={styles.dropdownIcon}>⚙</span>
            Settings
          </button>
        </div>,
        document.body
      )}
    </div>
  );
}
