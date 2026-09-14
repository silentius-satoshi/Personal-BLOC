import { useSimulation } from '../../hooks/useSimulation';
import { useStore } from '../../store/useStore';
import { fmtUSD } from '../../utils/format';
import { BLOC_OPERATING_CEILING } from '../../simulation/strikeCredit';
import { paydownReadout } from '../../simulation/simpleModePlan';
import { ProgressBar } from './ProgressBar';
import { PlaybookItems } from './PlaybookItems';
import { PlaybookScrubber } from './PlaybookScrubber';
import { buildNarrative, paydownBadge, type BadgeTone } from './playbookView';
import styles from './MonthlyPlaybook.module.css';

// quiet keeps the badge's original green; a routine paydown is muted (the plan working, not an alarm); amber is reserved
// for the two states where the LTV is still above the ceiling.
const TONE_COLOR: Record<BadgeTone, string> = { plain: 'var(--green)', muted: 'var(--text-muted)', amber: 'var(--amber)' };

export function MonthlyPlaybook() {
  const { currentMonth } = useSimulation();
  const scrubMonth = useStore((s) => s.scrubMonth);
  const income     = useStore((s) => s.income);
  const expenses   = useStore((s) => s.expenses);

  const { ltv, ltvPeak, btcPrice, paydown, interest } = currentMonth;
  // runBLOC is a pure 60-month projection — no logged months — so the readout is always 'projected'. Its local
  // LTV_CEILING equals BLOC_OPERATING_CEILING (0.15).
  const badge = paydownBadge(
    paydownReadout({ paydown, blocLtv: ltv, blocLtvPeak: ltvPeak }, null, false, BLOC_OPERATING_CEILING),
    BLOC_OPERATING_CEILING,
  );

  return (
    <div className={styles.playbook}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionTitle}>Monthly Playbook</span>
      </div>

      {/* Header row */}
      <div className={styles.header}>
        <span className={styles.monthLabel}>Month {scrubMonth} of 60</span>
        <span className={styles.ltvBadge} style={{ color: TONE_COLOR[badge.tone] }}>
          {badge.text}
        </span>
        <span className={styles.priceLabel}>BTC {fmtUSD(btcPrice)}</span>
      </div>

      <ProgressBar paydown={paydown} income={income} />
      <PlaybookScrubber />
      <PlaybookItems data={currentMonth} />

      <div className={styles.narrative}>
        {buildNarrative(scrubMonth, ltv, ltvPeak, income, expenses, paydown, interest, BLOC_OPERATING_CEILING)}
      </div>
    </div>
  );
}
