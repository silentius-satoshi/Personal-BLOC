import { useState } from 'react';
import { useLivePrice } from '../../hooks/useLivePrice';
import { usePowerLawData } from '../../hooks/usePowerLawData';
import { plBandsAt } from '../../simulation/powerLaw';
import { PowerLawChart, PowerLawChartEmpty } from './PowerLawChart';
import { PL_FACE_TITLE, PL_FRAMING, PL_DISCLAIMER, todayTiles, modelLines } from './powerLawView';
import styles from './PowerLawFace.module.css';

/**
 * The Power Law face (spec `pbloc-spec-powerlaw-face-v1.md`) — the four faces' layout (Ownership, Cycling, Strategy,
 * Decision): one column, the same on the Almanac face and the full-mode Power Law tab, each of which mounts it bare.
 *
 * D1's order: the head → the chart card → today's tiles → the model card → the disclaimer. Nothing above the chart waits
 * on the network, so the chart opens on screen on a phone and never moves as the numbers fill in (F2).
 *
 * - Every class composes its namesake in CyclingFace.module.css (I2), so the face can't drift from the four.
 * - Its hooks are useLivePrice and usePowerLawData — no block-height fetch (D2), so the Almanac's "live off" holds (F1).
 * - The copy that carries a figure or a band name comes from powerLawView (I8).
 * - The live price (BL64, a price every 5 s) lives in TodayTiles and in the chart's live dot: each re-renders itself on
 *   a tick, never the face. PowerLawChart stays memoised on its stable props (R2).
 */
export function PowerLawFace() {
  const { historical, bands, loading, error } = usePowerLawData();

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>{PL_FACE_TITLE}</div>
        <div className={styles.framing}>{PL_FRAMING}</div>
      </div>

      {/* The chart card. ONE error test (I4): an empty error string still counts as an error, so the error box and the
          chart can never both render. Loading and error keep the chart's title row and box, so it never moves. */}
      <section className={styles.card}>
        {loading && <PowerLawChartEmpty text="Loading price history…" />}
        {!loading && error !== null && <PowerLawChartEmpty text="Price history unavailable" />}
        {!loading && error === null && <PowerLawChart historical={historical} bands={bands} />}
      </section>

      <TodayTiles />

      <section className={styles.card}>
        <span className={styles.cardLabel}>The model</span>
        {modelLines().map((line) => <p key={line} className={styles.noteQuiet}>{line}</p>)}
      </section>

      <div className={styles.disclaimer}><strong>{PL_DISCLAIMER.lead}</strong> {PL_DISCLAIMER.body}</div>
    </div>
  );
}

/** Today's tiles — the only part of the face that reads the live price. Today's lines are one Date per mount, like the
 *  chart's "Today" line: a Date taken in the render would move on every re-render. */
function TodayTiles() {
  const live = useLivePrice();
  const [today] = useState(() => new Date());
  const tiles = todayTiles(live?.price ?? null, plBandsAt(today));

  return (
    <div className={styles.statGrid}>
      {tiles.map((t) => (
        <div key={t.key} className={styles.stat}>
          <span className={styles.cardLabel}>{t.label}</span>
          <div className={styles.statValue} style={{ color: t.color }}>{t.value}</div>
          <div className={styles.statSub}>{t.sub}</div>
        </div>
      ))}
    </div>
  );
}
