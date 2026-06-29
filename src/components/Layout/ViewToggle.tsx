import styles from './ViewToggle.module.css';

interface ViewToggleProps {
  simpleView: 'monthly' | 'daily';
  setSimpleView: (v: 'monthly' | 'daily') => void;
}

export function ViewToggle({ simpleView, setSimpleView }: ViewToggleProps) {
  return (
    <div className={styles.viewToggleWrap}>
      <div className={styles.viewToggle} role="tablist" aria-label="Mode">
        <button
          role="tab"
          aria-selected={simpleView === 'daily'}
          className={`${styles.viewToggleBtn} ${simpleView === 'daily' ? `${styles.viewToggleBtnActive} ${styles.viewToggleBtnDaily}` : ''}`}
          onClick={() => setSimpleView('daily')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M2 6h12M5 1.5v2.5M11 1.5v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            <circle cx="8" cy="10" r="1.6" fill="currentColor"/>
          </svg>
          Daily
        </button>
        <button
          role="tab"
          aria-selected={simpleView === 'monthly'}
          className={`${styles.viewToggleBtn} ${simpleView === 'monthly' ? styles.viewToggleBtnActive : ''}`}
          onClick={() => setSimpleView('monthly')}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.4"/>
            <path d="M2 6h12M5 1.5v2.5M11 1.5v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
          </svg>
          Monthly
        </button>
      </div>
    </div>
  );
}
