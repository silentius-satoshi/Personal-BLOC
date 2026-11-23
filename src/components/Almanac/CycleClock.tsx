import { useEffect, useState } from 'react';
import CycleDial from './CycleDial';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { epochProgress, TARGET_BLOCK_S, H5_EST } from '../../simulation/cycleModel';
import { cycleLegView } from './cycleClockView';
import styles from './CycleClock.module.css';

/**
 * Almanac — CycleClock (P2): the OPT-IN, projection-hero face. The idealized countdown to the projected turn
 * ahead is foregrounded (the §14.2 inversion), with the halving demoted to a card. This is the ONE place a
 * ticking countdown is permitted (§14.4) — a 1s ticker gated by usePageVisibility + cleaned up on
 * unmount. The "idealized cadence" tag + "why idealized" note ALWAYS accompany the countdown (§14.4).
 * Pure projection: imports nothing from the risk/position core — foregrounding it makes it an input to
 * NOTHING (§2 holds here specifically).
 */
const monthYear = (ms: number) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(ms));

function fmtCountdown(msLeft: number): string {
  let s = Math.max(0, Math.floor(msLeft / 1000));
  const d = Math.floor(s / 86_400);
  s %= 86_400;
  const h = Math.floor(s / 3_600);
  s %= 3_600;
  const m = Math.floor(s / 60);
  s %= 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d}d ${pad(h)}:${pad(m)}:${pad(s)}`;
}

function fmtTurnDate(ms: number): string {
  const date = new Date(ms);
  const wd = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(date);
  return `${wd} ${fmtDayMonYear(ms)}`;
}

function fmtDayMonYear(ms: number): string {
  const date = new Date(ms);
  const mon = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date);
  return `${date.getUTCDate()} ${mon} ${date.getUTCFullYear()}`;
}

export interface CycleClockProps {
  height: number;
  mode: 'live' | 'estimated';
  onSwitchToHalving: () => void;
}

export default function CycleClock({ height, mode, onSwitchToHalving }: CycleClockProps) {
  const isVisible = usePageVisibility();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!isVisible) return; // pause the tick when backgrounded
    setNow(Date.now()); // resync immediately on resume
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isVisible]);

  // projection phase (the foregrounded, idealized cadence): the leg it is on — rising toward the next high after a
  // low, descending toward the next low after a high (step 0 of the Engine, BL61: it paired the last high with the
  // next low, so from the 5 Oct 2026 low on it read "descending" toward the low after next).
  const leg = cycleLegView(now);
  const daysSinceTurn = leg ? Math.floor((now - leg.prev.date) / 86_400_000) : 0;
  const countdown = leg ? fmtCountdown(leg.next.date - now) : '0d 00:00:00';

  // demoted halving context (real)
  const ep = epochProgress(height);
  const pct = Math.round(ep.fraction * 100);
  const daysToHalving = Math.round((ep.blocksRemaining * TARGET_BLOCK_S) / 86_400);
  const estLabel = monthYear(H5_EST);

  return (
    <>
      <div className={styles.hero}>
        <CycleDial height={height} mode={mode} emphasis="cycle">
          <div className={leg?.next.word === 'peak' ? `${styles.eyebrow} ${styles.eyebrowPeak}` : styles.eyebrow}>
            Projected {leg ? leg.next.word : 'turn'}
          </div>
          <div className={styles.count}>{countdown}</div>
          <div className={styles.sub}>~ {leg ? fmtTurnDate(leg.next.date) : '—'}</div>
          <div className={styles.tag}>idealized cadence</div>
        </CycleDial>
      </div>

      <div className={styles.rstats}>
        <div className={styles.rstat}>
          <div className={styles.k}>{leg ? leg.phase : 'Phase'}</div>
          <div className={`${styles.v} ${leg?.rising ? styles.vAmber : styles.vMaroon}`}>~{leg ? leg.pct : 0}%</div>
          <div className={styles.rsub}>{leg ? leg.route : '—'}</div>
        </div>
        <div className={styles.rstat}>
          <div className={styles.k}>Since proj. {leg ? leg.prev.word : 'turn'}</div>
          <div className={`${styles.v} ${leg?.rising ? styles.vMaroon : styles.vAmber}`}>{daysSinceTurn}d</div>
          <div className={styles.rsub}>{leg ? `${fmtDayMonYear(leg.prev.date)} ${leg.prev.kind}` : '—'}</div>
        </div>
        <div className={styles.rstat}>
          <div className={styles.k}>Block height</div>
          <div className={styles.v}>{height.toLocaleString()}</div>
          <div className={styles.rsub}>{mode === 'estimated' ? 'estimate' : 'live'}</div>
        </div>
      </div>

      <div className={styles.idealized}>
        <div className={styles.idealizedTitle}>Why "idealized"</div>
        <div className={styles.idealizedBody}>
          Fixed 364 / 1,064-day cadence stepped from the 6 Oct 2025 high — every turn lands on a Monday.
          The hand still rides real blocks underneath, but the peak/floor dates are a pattern, not a
          forecast.
        </div>
      </div>

      <div className={styles.divider}>
        <span className={styles.dividerLabel}>Halving context</span>
        <span className={styles.dividerLine} />
      </div>

      <div className={styles.demote}>
        <div className={styles.demoteRow}>
          <span className={styles.demoteLab}>Halving epoch</span>
          <span className={styles.demoteVal}>
            <b>{pct}%</b> complete · Epoch {ep.era}
          </span>
        </div>
        <div className={styles.demoteHint}>
          Next halving in ~{daysToHalving} days (est. ~{estLabel}).{' '}
          <button type="button" className={styles.demoteLink} onClick={onSwitchToHalving}>
            Open Halving Clock →
          </button>
        </div>
      </div>
    </>
  );
}
