import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useStore } from '../../store/useStore';
import { Toggle } from '../ui/Toggle';
import styles from './SettingsMain.module.css';

const ALL_TABS = [
  { key: 'living',    label: 'Living on Bitcoin' },
  { key: 'bloc',      label: 'Smart BLOC'         },
  { key: 'powerlaw',  label: 'Power Law'           },
  { key: 'converter', label: 'Sats'                },
  { key: 'mining',    label: 'Miners'              },
  { key: 'coinbase',  label: 'CB Loan'             },
  { key: 'advisor',   label: 'Advisor'             },
] as const;

const MOVEABLE_KEYS = ['powerlaw', 'converter', 'mining'];

type TabEntry = typeof ALL_TABS[number];

interface SortableTabRowProps {
  tab:             TabEntry;
  isVisible:       boolean;
  isLastVisible:   boolean;
  isToolTab:       boolean;
  isMoveable:      boolean;
  onToggle:        () => void;
  onLocationToggle: () => void;
  styles:          Record<string, string>;
}

function SortableTabRow({ tab, isVisible, isLastVisible, isToolTab, isMoveable, onToggle, onLocationToggle, styles }: SortableTabRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tab.key });

  const style = { transform: CSS.Transform.toString(transform), transition };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`${styles.tabRow} ${isDragging ? styles.tabRowDragging : ''}`}
    >
      <span
        className={styles.dragHandle}
        {...attributes}
        {...listeners}
        title="Drag to reorder"
      >
        ⠿
      </span>
      <span className={`${styles.tabLabel} ${!isVisible ? styles.tabLabelHidden : ''}`}>
        {tab.label}
      </span>
      {isMoveable && (
        <button
          className={`${styles.locationToggle} ${isToolTab ? styles.locationTools : styles.locationMain}`}
          onClick={(e) => { e.stopPropagation(); onLocationToggle(); }}
          title={isToolTab ? 'Move to main bar' : 'Move to Tools dropdown'}
        >
          {isToolTab ? 'Tools' : 'Main'}
        </button>
      )}
      <Toggle value={isVisible} onChange={onToggle} disabled={isLastVisible} />
    </div>
  );
}

export function SettingsMain() {
  const hiddenTabs          = useStore((s) => s.hiddenTabs);
  const toggleTabVisibility = useStore((s) => s.toggleTabVisibility);
  const previousTab         = useStore((s) => s.previousTab);
  const setActiveTab        = useStore((s) => s.setActiveTab);
  const tabOrder            = useStore((s) => s.tabOrder);
  const setTabOrder         = useStore((s) => s.setTabOrder);
  const toolTabs            = useStore((s) => s.toolTabs);
  const setToolTabs         = useStore((s) => s.setToolTabs);

  const visibleCount = ALL_TABS.filter((t) => !hiddenTabs.includes(t.key)).length;

  const toggleToolLocation = (key: string) => {
    if (toolTabs.includes(key)) {
      setToolTabs(toolTabs.filter((k) => k !== key));
    } else {
      setToolTabs([...toolTabs, key]);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = tabOrder.indexOf(String(active.id));
    const newIndex = tabOrder.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    setTabOrder(arrayMove(tabOrder, oldIndex, newIndex));
  };

  const orderedTabs: TabEntry[] = [
    ...tabOrder
      .map((key) => ALL_TABS.find((t) => t.key === key))
      .filter((t): t is TabEntry => t !== undefined),
    ...ALL_TABS.filter((t) => !tabOrder.includes(t.key)),
  ];

  return (
    <div className={styles.main}>
      <div className={styles.header}>
        <button className={styles.backBtn} onClick={() => setActiveTab(previousTab)}>
          ← Back
        </button>
        <h2 className={styles.title}>Settings</h2>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>TAB VISIBILITY & ORDER</div>
        <div className={styles.sectionDescription}>
          Drag ⠿ to reorder. Toggle visibility. Use Main/Tools to move between bar and dropdown.
        </div>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tabOrder} strategy={verticalListSortingStrategy}>
            <div className={styles.tabList}>
              {orderedTabs.map((tab) => {
                const isVisible      = !hiddenTabs.includes(tab.key);
                const isLastVisible  = isVisible && visibleCount === 1;
                const isToolTab      = toolTabs.includes(tab.key);
                const isMoveable     = MOVEABLE_KEYS.includes(tab.key);

                return (
                  <SortableTabRow
                    key={tab.key}
                    tab={tab}
                    isVisible={isVisible}
                    isLastVisible={isLastVisible}
                    isToolTab={isToolTab}
                    isMoveable={isMoveable}
                    onToggle={() => { if (!isLastVisible) toggleTabVisibility(tab.key); }}
                    onLocationToggle={() => toggleToolLocation(tab.key)}
                    styles={styles}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      </div>
    </div>
  );
}
