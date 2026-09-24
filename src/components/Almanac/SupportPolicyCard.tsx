import type { CyclingMode, CyclingResult } from '../../simulation/cyclingSim';
import { SliderInput } from '../ui/SliderInput';
import { InfoTip } from '../ui/InfoTip';
import {
  policyReading, policyHeadline, policyDetails, policyIgnoredNote, policyTip, settingReadouts, zoneStrip,
  zoneStripLabel, ZONE_COLOR, ZONE_LABEL, ZONE_LETTER, ZONE_ORDER, SUPPORT_POLICY_RANGES,
  type EffectivePolicySettings, type PolicyTone, type SupportPolicySettings,
} from './supportPolicyView';
import styles from './SupportPolicyCard.module.css';

/**
 * The Support policy card — ONE card on the three engine faces (Cycling, Ownership, Strategy). It follows the
 * FreshnessBadge precedent: a shared Almanac component with its own CSS module, so no face's module hosts it.
 *
 * Presentation only. Every sentence and number comes from `supportPolicyView` (pure, tested); the card decides only
 * what renders where. It reads the DISPLAYED run (`sim`), so the stress lens moves it with the rest of the face. The
 * settings are the face's session overlay — the card writes nothing but `onChange` / `onReset`.
 *
 * ⚠ No re-arm control: the breaker's re-arm is a constant (decision 4) — the breaker line says what it does.
 * ⚠ `ui/SliderInput` and `ui/InfoTip` are consumed exactly as they are (Mining and Living share them).
 */
export interface SupportPolicyCardProps {
  /** The DISPLAYED run — the stress lens moves the card. */
  sim: CyclingResult;
  monthIdx: number;
  /** What the sliders show. */
  raw: SupportPolicySettings;
  /** What the run uses (clamped, pushed, the effective stops). */
  settings: EffectivePolicySettings;
  onChange: (patch: Partial<SupportPolicySettings>) => void;
  /** Back to DEFAULT_SUPPORT_POLICY_SETTINGS. */
  onReset: () => void;
  mode: CyclingMode;
  /** The face's effective bills. */
  expenses: number;
}

const TONE_CLASS: Record<PolicyTone, string> = {
  good: styles.toneGood,
  quiet: styles.toneQuiet,
  warn: styles.toneWarn,
  bad: styles.toneBad,
};

/** Above this horizon the strip's 1px gaps would eat the cells at phone width, so they drop to 0. */
const STRIP_GAP_MAX_MONTHS = 96;

export default function SupportPolicyCard({
  sim, monthIdx, raw, settings, onChange, onReset, mode, expenses,
}: SupportPolicyCardProps) {
  const label = (
    <span className={styles.label}>
      Support policy
      <InfoTip label="About the support policy">
        {policyTip(settings).map((line) => <p key={line}>{line}</p>)}
      </InfoTip>
    </span>
  );

  if (mode !== 'cycle') {
    return (
      <section className={styles.card}>
        {label}
        <p className={styles.quiet}>Applies to the Cycle strategy only.</p>
      </section>
    );
  }

  if (!settings.enabled) {
    return (
      <section className={styles.card}>
        {label}
        <p className={styles.quiet}>Off — limits are measured at today's price, the way the projection worked before.</p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} onClick={() => onChange({ enabled: true })}>Turn on</button>
        </div>
      </section>
    );
  }

  // Asked for, but the engine could not run it (a face can reach this: the dashboard's Strike liquidation LTV at or
  // under the 70% call). Say so — never an empty "on" state.
  if (!sim.policyApplied) {
    return (
      <section className={styles.card}>
        {label}
        <p className={styles.quiet}>{policyIgnoredNote(sim.policyIgnoredReason)}</p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} onClick={() => onChange({ enabled: false })}>Turn policy off</button>
        </div>
      </section>
    );
  }

  const reading = policyReading(sim, monthIdx, expenses);
  const head = policyHeadline(reading, settings);
  const details = policyDetails(reading, settings);
  const { zones, counts } = zoneStrip(sim.rows);
  const present = ZONE_ORDER.filter((z) => zones.includes(z));
  const tight = zones.length - 1 > STRIP_GAP_MAX_MONTHS;
  const markerLeft = zones.length > 0 ? ((monthIdx + 0.5) / zones.length) * 100 : 0;
  const inspected = zones[monthIdx];
  const r = settingReadouts(settings, expenses);
  const R = SUPPORT_POLICY_RANGES;

  return (
    <section className={styles.card}>
      {label}
      {head.text !== '' && <p className={`${styles.headline} ${TONE_CLASS[head.tone]}`}>{head.text}</p>}

      {/* One cell per month (m0..N), coloured by zone; the inspected month is a 2px bar over the strip. The cells
          shrink with min-width 0, so the strip never scrolls sideways — even at a 240-month horizon on a phone. */}
      <div
        className={styles.stripWrap}
        role="img"
        aria-label={`${zoneStripLabel(counts)}${inspected ? ` Month ${monthIdx}: ${ZONE_LABEL[inspected]}.` : ''}`}
      >
        <div className={`${styles.strip} ${tight ? styles.stripTight : ''}`} aria-hidden="true">
          {zones.map((z, m) => <span key={m} className={styles.cell} style={{ background: ZONE_COLOR[z] }} />)}
        </div>
        <span className={styles.marker} style={{ left: `${markerLeft}%` }} aria-hidden="true" />
      </div>
      <div className={styles.legend}>
        {present.map((z) => (
          <span key={z} className={styles.legendItem}>
            <span className={styles.legendLetter} style={{ color: ZONE_COLOR[z] }}>{ZONE_LETTER[z]}</span>
            {ZONE_LABEL[z]}
          </span>
        ))}
      </div>

      <ul className={styles.details}>
        {details.map((line, i) => <li key={i}>{line}</li>)}
      </ul>

      {/* Collapsed by default on every face — a native disclosure (keyboard- and screen-reader-ready, no JS). */}
      <details className={styles.disclosure}>
        <summary className={styles.summary}>Settings</summary>
        <div className={styles.settings}>
          <div>
            <SliderInput
              label="Coinbase limit at support" value={raw.cbStopAtSupportPct}
              onChange={(v) => onChange({ cbStopAtSupportPct: v })}
              min={R.cbStopAtSupportPct.min} max={R.cbStopAtSupportPct.max} step={R.cbStopAtSupportPct.step}
              display={r.cbStop.value}
              minLabel={`${R.cbStopAtSupportPct.min}%`} maxLabel={`${R.cbStopAtSupportPct.max}%`}
            />
            <p className={styles.readout}>{r.cbStop.clause}</p>
          </div>
          <div>
            <SliderInput
              label="Strike limit at support" value={raw.strikeStopAtSupportPct}
              onChange={(v) => onChange({ strikeStopAtSupportPct: v })}
              min={R.strikeStopAtSupportPct.min} max={R.strikeStopAtSupportPct.max} step={R.strikeStopAtSupportPct.step}
              display={r.skStop.value}
              minLabel={`${R.strikeStopAtSupportPct.min}%`} maxLabel={`${R.strikeStopAtSupportPct.max}%`}
            />
            <p className={styles.readout}>{r.skStop.clause}</p>
          </div>
          <SliderInput
            label="Buy with the line up to" value={raw.accumulateBelow}
            onChange={(v) => onChange({ accumulateBelow: v })}
            min={R.accumulateBelow.min} max={R.accumulateBelow.max} step={R.accumulateBelow.step}
            display={r.accumulateBelow.value}
            minLabel={`${R.accumulateBelow.min.toFixed(2)}×`} maxLabel={`${R.accumulateBelow.max.toFixed(2)}×`}
          />
          <div>
            <SliderInput
              label="Pay down above" value={raw.payDownAbove}
              onChange={(v) => onChange({ payDownAbove: v })}
              min={R.payDownAbove.min} max={R.payDownAbove.max} step={R.payDownAbove.step}
              display={r.payDownAbove.value}
              minLabel={`${R.payDownAbove.min.toFixed(2)}×`} maxLabel={`${R.payDownAbove.max.toFixed(2)}×`}
            />
            {r.payDownAbove.clause && <p className={styles.readout}>{r.payDownAbove.clause}</p>}
          </div>
          <div>
            <SliderInput
              label="Borrowing room kept" value={raw.bearBufferMonths}
              onChange={(v) => onChange({ bearBufferMonths: v })}
              min={R.bearBufferMonths.min} max={R.bearBufferMonths.max} step={R.bearBufferMonths.step}
              display={r.bearBuffer.value}
              minLabel="none" maxLabel={`${R.bearBufferMonths.max} mo`}
            />
            {r.bearBuffer.clause && <p className={styles.readout}>{r.bearBuffer.clause}</p>}
          </div>
          <div>
            <SliderInput
              label="Cash reserve" value={raw.cashReserveMonths}
              onChange={(v) => onChange({ cashReserveMonths: v })}
              min={R.cashReserveMonths.min} max={R.cashReserveMonths.max} step={R.cashReserveMonths.step}
              display={r.cashReserve.value}
              minLabel="none" maxLabel={`${R.cashReserveMonths.max} mo`}
            />
            {r.cashReserve.clause && <p className={styles.readout}>{r.cashReserve.clause}</p>}
          </div>
          <div className={styles.btnRow}>
            <button type="button" className={styles.btn} onClick={() => onChange({ enabled: false })}>Turn policy off</button>
            <button type="button" className={styles.btn} onClick={onReset}>Reset to defaults</button>
          </div>
        </div>
      </details>
    </section>
  );
}
