import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useEngineFacts } from './useEngineFacts';
import { ENGINE_MAX_W, engineScene } from './engineScene';
import {
  ENGINE_FRAMING, PART_NAMES, PART_ORDER, TRIED_NOTE, TRY_BACK, TRY_DOWN, TRY_UP, atSupportNote, engineAria, engineHeadline,
  partCard, type EnginePart,
} from './engineView';
import EngineCanvas from './EngineCanvas';
import styles from './EngineFace.module.css';

/**
 * The Engine · Micro (BL61, step 1) — an Almanac face, the owner's only (`almanacGrid`'s `ownerOnly`): his two loans as
 * an engine, right now. The facts are the Dashboard's and THIS MONTH's (`useEngineFacts`); the picture and every word are
 * the scene's (`engineScene`, `engineView`); the canvas draws it (`EngineCanvas`).
 *
 * A tried price — the piston's drag, or the row's buttons — is this face's state and nothing else: it is never written,
 * and leaving the face forgets it. The face writes nothing.
 */
export default function EngineFace() {
  const facts = useEngineFacts();
  const reducedMotion = useReducedMotion();
  const [tried, setTried] = useState<number | null>(null);
  const [part, setPart] = useState<EnginePart | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(390);

  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    const fit = (w: number): void => setWidth(Math.min(ENGINE_MAX_W, Math.floor(w)));
    fit(el.clientWidth || 390);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => { for (const e of es) fit(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scene = useMemo(() => engineScene(facts, width, tried), [facts, width, tried]);
  const card = part !== null ? partCard(part, scene.card) : null;
  const atSupport = atSupportNote(scene.card);
  const step = (f: number): void => setTried((t) => (t ?? scene.realPrice) * f);
  const tone = scene.drop === null ? '' : scene.sells || scene.cb.level === 'act' ? styles.lvAct : scene.cb.level === 'watch' ? styles.lvWatch : styles.lvSafe;

  return (
    <div className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Engine</div>
        <div className={styles.framing}>{ENGINE_FRAMING}</div>
      </div>
      <p className={`${styles.headline} ${tone}`}>{engineHeadline(scene.card)}</p>
      {atSupport !== null && <p className={`${styles.atSupport} ${styles.lvWatch}`}>{atSupport}</p>}
      <div ref={wrapRef} className={styles.wrap}>
        <EngineCanvas
          scene={scene}
          reducedMotion={reducedMotion}
          label={engineAria(scene.card)}
          openPart={part}
          onPart={(p) => setPart((q) => (q === p ? null : p))}
          onTry={setTried}
          onBack={() => setTried(null)}
        />
      </div>
      <div className={styles.tryRow} role="group" aria-label="Try a price">
        <button type="button" className={styles.ghostBtn} onClick={() => step(0.9)}>{TRY_DOWN}</button>
        <span className={styles.tryValue}>{scene.labels.priceTitle} {scene.labels.priceText}</span>
        <button type="button" className={styles.ghostBtn} onClick={() => step(1.1)}>{TRY_UP}</button>
        {scene.tried && <button type="button" className={styles.ghostBtn} onClick={() => setTried(null)}>{TRY_BACK}</button>}
      </div>
      {scene.tried && <p className={styles.note}>{TRIED_NOTE}</p>}
      <div className={styles.parts} role="group" aria-label="The engine's parts">
        {PART_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.part} ${part === p ? styles.partOn : ''}`}
            aria-pressed={part === p}
            onClick={() => setPart(part === p ? null : p)}
          >
            {PART_NAMES[p]}
          </button>
        ))}
      </div>
      {card !== null && (
        <section className={styles.card} aria-label={card.title}>
          <span className={styles.cardLabel}>{card.title}</span>
          {card.lines.map((l) => <p key={l} className={styles.note}>{l}</p>)}
        </section>
      )}
    </div>
  );
}
