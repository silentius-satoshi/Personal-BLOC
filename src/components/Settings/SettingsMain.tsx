import { useStore } from '../../store/useStore';
import { Toggle } from '../ui/Toggle';
import styles from './SettingsMain.module.css';

const ALL_TABS = [
  { key: 'living',    label: 'Living on Bitcoin' },
  { key: 'bloc',      label: 'Smart BLOC'         },
  { key: 'powerlaw',  label: 'Power Law'           },
  { key: 'converter', label: 'Sats'                },
  { key: 'mining',    label: 'Miners'              },
] as const;

export function SettingsMain() {
  const hiddenTabs          = useStore((s) => s.hiddenTabs);
  const toggleTabVisibility = useStore((s) => s.toggleTabVisibility);
  const previousTab         = useStore((s) => s.previousTab);
  const setActiveTab        = useStore((s) => s.setActiveTab);

  const visibleCount = ALL_TABS.filter((t) => !hiddenTabs.includes(t.key)).length;

  return (
    <div className={styles.main}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => setActiveTab(previousTab)}>
          ← Back
        </button>
        <h2 className={styles.title}>Settings</h2>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>TAB VISIBILITY</div>
        <div className={styles.sectionDescription}>
          Choose which tabs appear in the navigation bar.
          At least one tab must remain visible.
        </div>

        <div className={styles.tabList}>
          {ALL_TABS.map((tab) => {
            const isVisible = !hiddenTabs.includes(tab.key);
            const isLastVisible = isVisible && visibleCount === 1;

            return (
              <div key={tab.key} className={styles.tabRow}>
                <span className={`${styles.tabLabel} ${!isVisible ? styles.tabLabelHidden : ''}`}>
                  {tab.label}
                </span>
                <Toggle
                  value={isVisible}
                  onChange={() => {
                    if (isLastVisible) return;
                    toggleTabVisibility(tab.key);
                  }}
                  disabled={isLastVisible}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
