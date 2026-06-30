import CycleDial from './CycleDial';
import { epochProgress, TARGET_BLOCK_S, H5_EST, CYCLE_TURNS } from '../../simulation/cycleModel';
import styles from './HalvingClock.module.css';

/**
 * Almanac — HalvingClock (P2): the DEFAULT, honest face. The REAL halving countdown is the hero (the
 * §5 certainty inversion: the verifiable thing is foregrounded). The idealized cycle projection is
 * demoted to a ghosted card. STATIC — no ticker (day-resolution only; the to-the-second live version
 * is P3). Pure: derives everything from cycleModel; imports nothing from the risk/position core.
 */
const monthYear = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));

const monthApos = (ms: number) => {
  const d = new Date(ms);
  const mon = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(d);
  return `${mon} '${String(d.getUTCFullYear() % 100).padStart(2, '0')}`;
};

export interface HalvingClockProps {
  height: number;
  mode: 'live' | 'estimated';
}

export default function HalvingClock({ height, mode }: HalvingClockProps) {
  const ep = epochProgress(height);
  const pct = Math.round(ep.fraction * 100);
  const daysToHalving = Math.round((ep.blocksRemaining * TARGET_BLOCK_S) / 86_400);
  const estLabel = monthYear(H5_EST);

  // demoted projection refs (one-time render read — NO ticker on this face)
  const now = Date.now();
  const lastHigh = [...CYCLE_TURNS].reverse().find((t) => t.kind === 'high' && t.date <= now);
  const nextLow = CYCLE_TURNS.find((t) => t.kind === 'low' && t.date > now);
  const phasePct =
    lastHigh && nextLow ? Math.round(((now - lastHigh.date) / (nextLow.date - lastHigh.date)) * 100) : 0;

  return (
    <>
      <div className={styles.hero}>
        <CycleDial height={height} mode={mode} emphasis="halving">
          <div className={styles.eyebrow}>Next halving</div>
          <div className={styles.count}>
            {daysToHalving}
            <span className={styles.countUnit}>d</span>
          </div>
          <div className={styles.sub}>est. ~{estLabel}</div>
          <div className={styles.sub2}>block {height.toLocaleString()} / 1,050,000</div>
        </CycleDial>
      </div>

      <div className={styles.rstats}>
        <div className={styles.rstat}>
          <div className={styles.k}>Through epoch</div>
          <div className={styles.v}>{pct}%</div>
          <div className={styles.rsub}>
            Epoch {ep.era} · {ep.reward} ₿
          </div>
        </div>
        <div className={styles.rstat}>
          <div className={styles.k}>Blocks to halving</div>
          <div className={`${styles.v} ${styles.vBtc}`}>{ep.blocksRemaining.toLocaleString()}</div>
          <div className={styles.rsub}>exact count</div>
        </div>
        <div className={styles.rstat}>
          <div className={styles.k}>Block height</div>
          <div className={styles.v}>{height.toLocaleString()}</div>
          <div className={styles.rsub}>estimate</div>
        </div>
      </div>

      <div className={styles.demote}>
        <div className={styles.projLine}>
          Pattern suggests a{' '}
          <span className={styles.softFloor}>floor ~{nextLow ? monthYear(nextLow.date) : '—'}</span> — the
          cadence last printed a{' '}
          <span className={styles.softPeak}>peak in {lastHigh ? monthYear(lastHigh.date) : '—'}</span>, just
          behind where we are now.
        </div>
        <div className={styles.projBar}>
          <div className={styles.projFill} style={{ width: `${phasePct}%` }} />
        </div>
        <div className={styles.projMeta}>
          <span>{lastHigh ? monthApos(lastHigh.date) : '—'} peak</span>
          <span>descending · ~{phasePct}%</span>
          <span>{nextLow ? monthApos(nextLow.date) : '—'} floor</span>
        </div>
        <div className={styles.projCap}>
          Idealized 364 / 1,064-day cadence stepped from the 6 Oct 2025 high — every turn lands on a
          Monday. A pattern, not a forecast.
        </div>
      </div>
    </>
  );
}
