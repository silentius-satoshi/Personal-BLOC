import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { selectSafetyViewInputs, LEVEL_COLOR } from '../../simulation/safetyView';
import { applyOverlay, diffScenarios, type ScenarioOverlay, type DimensionDiff } from '../../simulation/scenarioDiff';
import { NumberInput } from '../ui/NumberInput';
import { relativeAge, todayLocalISO } from '../../utils/format';
import styles from './ScenarioFace.module.css';

/**
 * Almanac Scenario face (Phase 3b) — the UI over the pure 3a engine (scenarioDiff.ts). Pin the current
 * plan's safety posture, then edit a session-ephemeral hypothetical overlay and read the what-if diff.
 *
 * READ-ONLY by construction: the ONLY store write is `setPinnedScenario` (a device-local pin). The overlay
 * lives in local state and is NEVER persisted (the sandboxCollateralBtc precedent). Every number flows
 * through the real risk math (deriveSafetyView, via diffScenarios) so the preview can't drift from the
 * owner's SafetyDashboard. Ungated: NumberInputs self-disable in viewerMode; a local pin is harmless.
 */

type LeverKey = keyof ScenarioOverlay;
interface Lever {
  key: LeverKey;
  label: string;
  prefix: string;
  decimals: number;
  cbOnly?: boolean;
}
const LEVERS: Lever[] = [
  { key: 'btcPrice',                 label: 'BTC price',         prefix: '$', decimals: 0 },
  { key: 'advisorActualBlocBalance', label: 'Strike debt',       prefix: '$', decimals: 0 },
  { key: 'currentBtcHeld',           label: 'Strike collateral', prefix: '₿', decimals: 5 },
  { key: 'creditLine',               label: 'Credit line',       prefix: '$', decimals: 0 },
  { key: 'cbLoanBalance',            label: 'CB balance',        prefix: '$', decimals: 0, cbOnly: true },
  { key: 'cbCollateralBtc',          label: 'CB collateral',     prefix: '₿', decimals: 5, cbOnly: true },
];

const pct = (frac: number): string => `${(frac * 100).toFixed(1)}%`;
const pp = (delta: number): string => `${delta >= 0 ? '+' : ''}${(delta * 100).toFixed(1)}`;
const chipColor = (dim: DimensionDiff): string =>
  dim.worsened ? 'var(--red)' : dim.delta < 0 ? 'var(--green)' : 'var(--text-muted)';

export default function ScenarioFace() {
  const currentInputs = useStore(useShallow(selectSafetyViewInputs));
  const pinnedScenario = useStore((s) => s.pinnedScenario);
  const setPinnedScenario = useStore((s) => s.setPinnedScenario);
  const [overlay, setOverlay] = useState<ScenarioOverlay>({});

  const hasCbLoan = currentInputs.hasCbLoan;

  const pin = () => setPinnedScenario({
    label: todayLocalISO(),
    pinnedAt: Date.now(),
    btcPrice: currentInputs.btcPrice,
    inputs: currentInputs,
  });

  const drift = pinnedScenario ? diffScenarios(pinnedScenario.inputs, currentInputs) : null;

  const hypo = applyOverlay(currentInputs, overlay);
  const d = diffScenarios(currentInputs, hypo);

  const primaryRows: { label: string; dim: DimensionDiff }[] = [
    { label: 'Credit used', dim: d.capacityUsed },
    { label: 'Strike LTV', dim: d.strikeLtv },
    ...(hasCbLoan ? [{ label: 'CB LTV', dim: d.cbLtv }] : []),
  ];

  const verdict = d.worsenedCount === 0
    ? 'No dimension worsens'
    : `Hypothetical is worse on ${d.worsenedCount} of 3`;

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Scenario</div>
        <div className={styles.framing}>Pin a plan, then test a what-if against it.</div>
      </div>

      {/* 1 · PIN row */}
      <div className={styles.pinRow}>
        {pinnedScenario ? (
          <>
            <span className={styles.pinnedLabel}>
              Pinned {pinnedScenario.label} · {relativeAge(pinnedScenario.pinnedAt)}
            </span>
            <button type="button" className={styles.ghostBtn} onClick={pin}>Re-pin</button>
            <button type="button" className={styles.ghostBtn} onClick={() => setPinnedScenario(null)}>Clear</button>
          </>
        ) : (
          <button type="button" className={styles.pinBtn} onClick={pin}>Pin today's plan</button>
        )}
      </div>

      {/* 2 · DRIFT line (only when pinned) */}
      {drift && (
        <div className={styles.drift}>
          Since pin: {drift.worsenedCount} of 3 worse
          <span className={styles.driftDeltas}>
            Credit {pp(drift.capacityUsed.delta)} · Strike {pp(drift.strikeLtv.delta)}
            {hasCbLoan && <> · CB {pp(drift.cbLtv.delta)}</>}
          </span>
        </div>
      )}

      {/* 3 · OVERLAY editor */}
      <div className={styles.editor}>
        <div className={styles.editorHead}>
          <span className={styles.editorTitle}>What-if levers</span>
          <button type="button" className={styles.ghostBtn} onClick={() => setOverlay({})}>Reset</button>
        </div>
        <div className={styles.editorGrid}>
          {LEVERS.filter((l) => !l.cbOnly || hasCbLoan).map((l) => (
            <NumberInput
              key={l.key}
              label={l.label}
              prefix={l.prefix}
              decimals={l.decimals}
              min={0}
              value={overlay[l.key] ?? currentInputs[l.key]}
              onChange={(v) => setOverlay((o) => ({ ...o, [l.key]: v }))}
            />
          ))}
        </div>
      </div>

      {/* 4 · WHAT-IF grid */}
      <div className={styles.grid}>
        {primaryRows.map(({ label, dim }) => (
          <div key={label} className={styles.gridRow}>
            <span className={styles.gridLabel}>{label}</span>
            <span className={styles.gridVal}>
              <span style={{ color: LEVEL_COLOR[dim.fromLevel] }}>{pct(dim.from)}</span>
              <span className={styles.arrow}>→</span>
              <span style={{ color: LEVEL_COLOR[dim.toLevel] }}>{pct(dim.to)}</span>
              <span className={styles.chip} style={{ color: chipColor(dim) }}>{pp(dim.delta)}pp</span>
            </span>
          </div>
        ))}

        <div className={styles.secondary}>
          <span>Crash LTV {pct(d.crashLtv.from)} → {pct(d.crashLtv.to)}</span>
          {hasCbLoan && <span>CB liq-frac {pct(d.cbLiqFrac.from)} → {pct(d.cbLiqFrac.to)}</span>}
        </div>

        <div className={styles.verdict}>{verdict}</div>
      </div>
    </div>
  );
}
