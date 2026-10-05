import type { CyclingMode, CyclingResult } from '../../simulation/cyclingSim';
import { SliderInput } from '../ui/SliderInput';
import { InfoTip } from '../ui/InfoTip';
import {
  policyReading, policyHeadline, policyDetails, policyIgnoredNote, policyTip, settingReadouts, zoneStrip,
  zoneStripLabel, policyCardState, ZONE_COLOR, ZONE_LABEL, ZONE_LETTER, ZONE_ORDER, SUPPORT_POLICY_RANGES,
  type EffectivePolicySettings, type PolicyCardState, type PolicyTone, type SupportPolicySettings,
} from './supportPolicyView';
import styles from './SupportPolicyCard.module.css';

/**
 * The Support policy card — ONE card on Decision and the three engine faces (Cycling, Ownership, Strategy). It
 * follows the FreshnessBadge precedent: a shared Almanac component with its own CSS module, so no face's module
 * hosts it.
 *
 * Presentation only. Every sentence and number comes from `supportPolicyView` (pure, tested); the card decides only
 * what renders where. It reads the DISPLAYED run (`sim`), so the stress lens moves it with the rest of the face. The
 * settings are the face's session overlay — the card writes nothing but `onChange` / `onReset`.
 *
 * ⚠ No re-arm control: the breaker's re-arm is a constant (decision 4) — the breaker line says what it does.
 * ONE settings block (sticky controls): the card's disclosure and the control dock's Policy panel both render
 * `SupportPolicySliders`, and both branch on `policyCardState` — so the two can never offer different controls.
 * ⚠ `ui/SliderInput` and `ui/InfoTip` are consumed exactly as they are. SliderInput is shared with Mining and Living;
 * InfoTip lives only on these faces (this card, the Strike-cap ⓘs, Cycling's cold storage).
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
  /** The futures' line (futuresCardLine) — the face's own words; absent where a face runs no futures. Shown when the
   *  policy is on, off or not run, never for another strategy (R2). */
  futuresLine?: string;
  /** A newer futures run is on its way: the line dims. */
  futuresRunning?: boolean;
}

/** The futures' line — what the settings buy and what they risk, read across the futures. The card's last reading. */
function FuturesLine({ text, running }: { text: string | undefined; running: boolean | undefined }) {
  if (text === undefined) return null;
  return <p className={`${styles.futures} ${running ? styles.futuresStale : ''}`} aria-busy={running === true}>{text}</p>;
}

const TONE_CLASS: Record<PolicyTone, string> = {
  good: styles.toneGood,
  quiet: styles.toneQuiet,
  warn: styles.toneWarn,
  bad: styles.toneBad,
};

/** Above this horizon the strip's 1px gaps would eat the cells at phone width, so they drop to 0. */
const STRIP_GAP_MAX_MONTHS = 96;

/** The card's three states that show no reading — another strategy, off, or asked for but not run — word for word. */
function PolicyStateBody({ state, sim, onChange }: {
  state: Exclude<PolicyCardState, 'on'>;
  sim: CyclingResult;
  onChange: (patch: Partial<SupportPolicySettings>) => void;
}) {
  if (state === 'notCycle') return <p className={styles.quiet}>Applies to the Cycle strategy only.</p>;
  if (state === 'off') {
    return (
      <>
        <p className={styles.quiet}>Off — limits are measured at today's price, the way the projection worked before.</p>
        <div className={styles.btnRow}>
          <button type="button" className={styles.btn} onClick={() => onChange({ enabled: true })}>Turn on</button>
        </div>
      </>
    );
  }
  // Asked for, but the engine could not run it (a face can reach this: the dashboard's Strike liquidation LTV at or
  // under the 70% call). Say so — never an empty "on" state.
  return (
    <>
      <p className={styles.quiet}>{policyIgnoredNote(sim.policyIgnoredReason)}</p>
      <div className={styles.btnRow}>
        <button type="button" className={styles.btn} onClick={() => onChange({ enabled: false })}>Turn policy off</button>
      </div>
    </>
  );
}

export interface SupportPolicySlidersProps {
  raw: SupportPolicySettings;
  settings: EffectivePolicySettings;
  onChange: (patch: Partial<SupportPolicySettings>) => void;
  onReset: () => void;
  expenses: number;
  /** 'stack' — the card's disclosure; 'grid' — the control dock's panel (one column on a phone, three on a computer). */
  layout?: 'stack' | 'grid';
}

/** The six settings, their clauses, and Turn policy off / Reset to defaults. */
export function SupportPolicySliders({
  raw, settings, onChange, onReset, expenses, layout = 'stack',
}: SupportPolicySlidersProps) {
  const r = settingReadouts(settings, expenses);
  const R = SUPPORT_POLICY_RANGES;
  return (
    <div className={layout === 'grid' ? styles.settingsGrid : styles.settings}>
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
  );
}

/** The control dock's Policy panel: the card's controls without its readings — the same state branch, the same
 *  sliders. */
export function SupportPolicyControls({
  sim, raw, settings, onChange, onReset, mode, expenses, layout,
}: Omit<SupportPolicyCardProps, 'monthIdx'> & { layout?: 'stack' | 'grid' }) {
  const state = policyCardState(mode, settings.enabled, sim.policyApplied);
  if (state !== 'on') return <PolicyStateBody state={state} sim={sim} onChange={onChange} />;
  return (
    <SupportPolicySliders raw={raw} settings={settings} onChange={onChange} onReset={onReset} expenses={expenses}
      layout={layout} />
  );
}

export default function SupportPolicyCard({
  sim, monthIdx, raw, settings, onChange, onReset, mode, expenses, futuresLine, futuresRunning,
}: SupportPolicyCardProps) {
  const label = (
    <span className={styles.label}>
      Support policy
      <InfoTip label="About the support policy">
        {policyTip(settings).map((line) => <p key={line}>{line}</p>)}
      </InfoTip>
    </span>
  );

  const state = policyCardState(mode, settings.enabled, sim.policyApplied);
  if (state !== 'on') {
    return (
      <section className={styles.card}>
        {label}
        <PolicyStateBody state={state} sim={sim} onChange={onChange} />
        {state !== 'notCycle' && <FuturesLine text={futuresLine} running={futuresRunning} />}
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
      <FuturesLine text={futuresLine} running={futuresRunning} />

      {/* Collapsed by default on every face — a native disclosure (keyboard- and screen-reader-ready, no JS). */}
      <details className={styles.disclosure}>
        <summary className={styles.summary}>Settings</summary>
        <SupportPolicySliders raw={raw} settings={settings} onChange={onChange} onReset={onReset} expenses={expenses} />
      </details>
    </section>
  );
}
