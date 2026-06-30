import { epochProgress, blockPositionInEpoch, CYCLE_TURNS, type CycleTurn } from '../../simulation/cycleModel';
import styles from './CycleDial.module.css';

/**
 * Almanac CycleClock — static presentational dial (P1, halving face).
 *
 * HR-1 one-coordinate-system: the NOW hand, the progress arc, and the "% through epoch" ALL derive
 * from epochProgress(height).fraction. There is no separate date path — when mode==='estimated' the
 * CALLER passes a height from blockAtDate(now); the dial does not care how the height was derived.
 *
 * Pure-from-props: no fetch, no timers, no state. Not wired to any surface (nav is P4).
 * `emphasis` is accepted for the P2 seam; P1 renders the 'halving' treatment only.
 */
export interface CycleDialProps {
  height: number;
  mode: 'live' | 'estimated';
  emphasis?: 'halving' | 'cycle';
}

// ── Geometry (ported verbatim from the preview <script>) ────────────────────
const CX = 180;
const CY = 180;
const R = 140;
const BAND = 2.6; // half-width (in %) of the ghosted projection band
const GRAD_ID = 'cycleDialProgress';

/** Polar point on the dial; pct 0..100 maps 0=top, clockwise. */
function polar(r: number, pct: number): { x: number; y: number } {
  const a = ((-90 + (pct / 100) * 360) * Math.PI) / 180;
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}

/** SVG arc path from s% to e% at radius r (big-arc flag when the span exceeds 50%). */
function arc(r: number, s: number, e: number): string {
  const p0 = polar(r, s);
  const p1 = polar(r, e);
  const big = ((((e - s) % 100) + 100) % 100) > 50 ? 1 : 0;
  return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${r} ${r} 0 ${big} 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

/** Right-side labels anchor 'start', left-side 'end' — keeps text off the dial. */
function labelAnchor(pct: number): 'start' | 'end' {
  return Math.cos(((-90 + (pct / 100) * 360) * Math.PI) / 180) >= 0 ? 'start' : 'end';
}

function turnLabel(t: CycleTurn): string {
  const yy = String(new Date(t.date).getUTCFullYear() % 100).padStart(2, '0');
  return `${t.kind === 'high' ? 'peak' : 'floor'} '${yy}`;
}

const TICKS = Array.from({ length: 12 }, (_, i) => (i / 12) * 100);

export default function CycleDial({ height, mode }: CycleDialProps) {
  const epoch = epochProgress(height);
  const NOW = epoch.fraction * 100;
  const pct = Math.round(NOW);

  // Nearest projected high/low turns that fall WITHIN this epoch — clamped/hidden outside [0,1].
  const pickMarker = (kind: 'high' | 'low'): { pct: number; turn: CycleTurn } | null => {
    for (const t of CYCLE_TURNS) {
      if (t.kind !== kind) continue;
      const pos = blockPositionInEpoch(t.date, epoch);
      if (pos >= 0 && pos <= 1) return { pct: pos * 100, turn: t };
    }
    return null;
  };
  const peak = pickMarker('high'); // --amber
  const floor = pickMarker('low'); // --maroon

  const handPt = polar(R, NOW);
  const cut1 = polar(R - 9, 0);
  const cut2 = polar(R + 9, 0);
  const cutDot = polar(R, 0);
  const cutLabel = polar(R + 22, 0);

  const renderMarker = (m: { pct: number; turn: CycleTurn }, color: string) => {
    const pt = polar(R, m.pct);
    const lp = polar(R + 21, m.pct);
    return (
      <g key={m.turn.kind}>
        <path
          d={arc(R, m.pct - BAND, m.pct + BAND)}
          fill="none"
          stroke={color}
          strokeWidth={7}
          strokeLinecap="round"
          opacity={0.15}
        />
        <circle cx={pt.x} cy={pt.y} r={6} fill="none" stroke={color} strokeWidth={2} strokeDasharray="3 3" opacity={0.85} />
        <text
          className={styles.lab}
          x={lp.x}
          y={lp.y}
          fill={color}
          textAnchor={labelAnchor(m.pct)}
          dominantBaseline="middle"
        >
          {turnLabel(m.turn)}
        </text>
      </g>
    );
  };

  return (
    <div className={styles.dialwrap}>
      <svg
        className={styles.dial}
        viewBox="0 0 360 360"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`Epoch ${epoch.era}, ${pct}% complete${mode === 'estimated' ? ' (estimated)' : ''}`}
      >
        <defs>
          <linearGradient id={GRAD_ID} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--btc)" />
            <stop offset="1" stopColor="var(--green)" />
          </linearGradient>
        </defs>

        {/* track + ticks */}
        <circle className={styles.track} cx={CX} cy={CY} r={R} />
        {TICKS.map((p, i) => {
          const a = polar(R - 7, p);
          const b = polar(R + 7, p);
          return <line key={i} className={styles.tick} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
        })}

        {/* ghosted projection markers (halving face) */}
        {peak && renderMarker(peak, 'var(--amber)')}
        {floor && renderMarker(floor, 'var(--maroon)')}

        {/* progress arc — confident BTC→green; the 0.4 offset clears the round cap off the 0% cut */}
        {NOW > 0.4 && (
          <path d={arc(R, 0.4, NOW)} fill="none" stroke={`url(#${GRAD_ID})`} strokeWidth={9} strokeLinecap="round" />
        )}

        {/* halving cut at top (0%) */}
        <line x1={cut1.x} y1={cut1.y} x2={cut2.x} y2={cut2.y} stroke="var(--btc)" strokeWidth={3} strokeLinecap="round" />
        <circle cx={cutDot.x} cy={cutDot.y} r={5} fill="var(--btc)" stroke="var(--bg-base)" strokeWidth={2} />
        <text className={styles.lab} x={cutLabel.x} y={cutLabel.y - 2} fill="var(--btc)" textAnchor="middle">
          ½ HALVING
        </text>

        {/* NOW hand */}
        <circle cx={handPt.x} cy={handPt.y} r={11} fill="var(--green)" opacity={0.16} />
        <circle cx={handPt.x} cy={handPt.y} r={6} fill="var(--green)" stroke="var(--bg-base)" strokeWidth={2.5} />
      </svg>
    </div>
  );
}
