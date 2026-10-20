import { GOAL_TILE_TITLE, type GoalTileView } from './goalTileView';
import styles from './GoalTile.module.css';

/**
 * BL14 (G1-C, G2-A) — the goal tile on the Dashboard: the owner's, and a TRUSTED viewer's (the goal rides the trusted
 * snapshot like the plan's six settings). Never a safe viewer's: the caller gates it on the trusted mode, and the safe
 * snapshot carries no amount and no goal. Badge-less, like the ownership bar — reaching a goal is not a risk verdict.
 * Pure-from-props.
 */
export function GoalTile({ view }: { view: GoalTileView }) {
  return (
    <div className={styles.card} role="group" aria-label={view.aria}>
      <div className={styles.head}>
        <span className={styles.title}>{GOAL_TILE_TITLE}</span>
        <span className={styles.value}>{view.value}</span>
      </div>
      {/* ⚠ NO transition on the width (the VenueBar / RadialGauge iOS ghost-raster rule). */}
      <div className={styles.bar} aria-hidden="true">
        <div className={styles.fill} style={{ width: `${(view.fill * 100).toFixed(1)}%` }} />
      </div>
      <p className={styles.sub}>{view.sub}</p>
    </div>
  );
}
