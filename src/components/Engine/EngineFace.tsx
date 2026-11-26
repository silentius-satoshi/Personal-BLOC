import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import { useEngineFacts } from './useEngineFacts';
import { ENGINE_MAX_W, SHEET_MQ, cardPlace, engineScene, type Rect } from './engineScene';
import {
  CARD_CLOSE, PART_NAMES, PART_ORDER, TRIED_NOTE, TRY_BACK, TRY_DOWN, TRY_UP, atSupportNote, engineAria,
  engineHeadline, partCard, type EnginePart,
} from './engineView';
import EngineCanvas from './EngineCanvas';
import EnginePlate from './EnginePlate';
import styles from './EngineFace.module.css';

/**
 * The Engine · Micro (BL61, step 1) — an Almanac face, the owner's only (`almanacGrid`'s `ownerOnly`): his two loans as
 * an engine, right now. The facts are the Dashboard's and THIS MONTH's (`useEngineFacts`); the picture and every word are
 * the scene's (`engineScene`, `engineView`); the canvas draws it (`EngineCanvas`).
 *
 * A tried price — the piston's drag, or the row's buttons — is this face's state and nothing else: it is never written,
 * and leaving the face forgets it. The face writes nothing.
 *
 * Over the picture, the price bar (BL67, `EnginePlate`) — the prototypes' nameplate, where the framing sentence was. On a
 * phone the parts' buttons are out of sight: a tap on the picture opens each part's card. They stay for VoiceOver and a
 * keyboard, which can't read the picture part by part — a key's focus inside the row shows it (EngineFace.module.css).
 *
 * A part's card pops up as the prototypes' does (the owner's look, 2026-11-25): on a phone, a sheet from the bottom of the
 * screen, the page moving just enough that the part tapped stays in view above it; on a computer, a card beside the part
 * (or beside the part's button), on the screen (`cardPlace`). The ✕, Escape, a tap anywhere else, the part again or its
 * button close it; another part swaps it. It is the face's last child — sticky to the screen's bottom as a sheet, never
 * `position: fixed` (EdgeBackGesture's page moves with a transform, which traps a fixed child: ui.md).
 */
type Opened = { part: EnginePart; from: 'canvas' | 'button'; at: Rect };

/** A press on a card within this long of its opening was aimed at what was there before (the prototypes' `guardPop`). */
const GUARD_MS = 350;

/** What the page scrolls in: the app scrolls <body> (html and body 100% tall — `utils/pageTop`), a browser may scroll the
 *  document; the nearest box up from the face that scrolls, so either way. */
function pageScroller(from: HTMLElement): Element {
  for (let el = from.parentElement; el !== null; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight) return el;
  }
  return document.scrollingElement ?? document.documentElement;
}

export default function EngineFace() {
  const facts = useEngineFacts();
  const reducedMotion = useReducedMotion();
  const [tried, setTried] = useState<number | null>(null);
  const [open, setOpen] = useState<Opened | null>(null);
  const faceRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const partsRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openedAt = useRef(0);
  const [width, setWidth] = useState(390);
  const titleId = useId();

  useEffect(() => {
    const el = wrapRef.current;
    if (el === null) return;
    let seen = -1;
    const fit = (w: number): void => {
      const fw = Math.floor(w);
      if (seen >= 0 && fw !== seen) setOpen(null);   // a new width moves the parts: an open card closes, as in the prototypes
      seen = fw;
      setWidth(Math.min(ENGINE_MAX_W, fw));
    };
    fit(el.clientWidth || 390);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((es) => { for (const e of es) fit(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const scene = useMemo(() => engineScene(facts, width, tried), [facts, width, tried]);
  const card = open !== null ? partCard(open.part, scene.card) : null;
  const atSupport = atSupportNote(scene.card);
  const step = (f: number): void => setTried((t) => (t ?? scene.realPrice) * f);
  const tone = scene.drop === null ? '' : scene.sells || scene.cb.level === 'act' ? styles.lvAct : scene.cb.level === 'watch' ? styles.lvWatch : styles.lvSafe;

  /** Open a part's card beside `at` — or, if it is the one open, close it. */
  const show = (part: EnginePart, from: Opened['from'], at: Rect, opener: HTMLElement | null): void => {
    openedAt.current = performance.now();
    openerRef.current = opener;
    setOpen((o) => (o !== null && o.part === part ? null : { part, from, at }));
  };
  /** Close the card; a keyboard's focus inside it goes back to the button that opened it. */
  const close = (): void => {
    const inside = cardRef.current?.contains(document.activeElement) ?? false;
    setOpen(null);
    if (inside) openerRef.current?.focus();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  // Escape, or a press anywhere but the card, the picture and the parts' buttons, closes it (the picture and the buttons
  // decide for themselves: another part swaps it, the same part closes it). A press, not a click: a click would land after
  // the press that opened it.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') closeRef.current(); };
    const onDown = (e: PointerEvent): void => {
      const t = e.target instanceof Node ? e.target : null;
      if (t === null) return;
      for (const r of [cardRef, wrapRef, partsRef]) if (r.current?.contains(t)) return;
      closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // Its place, before it is painted: a sheet on a phone (the page moves the part above it); beside what opened it on a
  // computer. Placed when it opens, and not again as its figures move.
  useLayoutEffect(() => {
    const el = cardRef.current;
    const face = faceRef.current;
    if (open === null || el === null || face === null) return;
    if (window.matchMedia(SHEET_MQ).matches) {
      el.style.left = '';
      el.style.top = '';
      if (open.from === 'canvas') {
        const over = open.at.y + open.at.h - (el.getBoundingClientRect().top - 12);
        if (over > 0) pageScroller(face).scrollBy({ top: over, behavior: reducedMotion ? 'auto' : 'smooth' });
      }
      return;
    }
    const f = face.getBoundingClientRect();
    const p = cardPlace(open.at, open.from, el.offsetWidth, el.offsetHeight, document.documentElement.clientWidth, window.innerHeight);
    el.style.left = `${Math.round(p.x - f.left)}px`;
    el.style.top = `${Math.round(p.y - f.top)}px`;
  }, [open, reducedMotion]);

  return (
    <div ref={faceRef} className={styles.face}>
      <div className={styles.head}>
        <div className={styles.title}>Engine</div>
        <EnginePlate feed={facts.feed} price={scene.realPrice} livePrice={facts.livePrice} liveAt={facts.liveAt}
          reducedMotion={reducedMotion} />
      </div>
      <p className={`${styles.headline} ${tone}`}>{engineHeadline(scene.card)}</p>
      {atSupport !== null && <p className={`${styles.atSupport} ${styles.lvWatch}`}>{atSupport}</p>}
      <div ref={wrapRef} className={styles.wrap}>
        <EngineCanvas
          scene={scene}
          reducedMotion={reducedMotion}
          label={engineAria(scene.card)}
          openPart={open?.part ?? null}
          onPart={(p, at) => show(p, 'canvas', at, null)}
          onNothing={() => setOpen(null)}
          onHand={() => setOpen(null)}
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
      <div ref={partsRef} className={styles.parts} role="group" aria-label="The engine's parts">
        {PART_ORDER.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.part} ${open?.part === p ? styles.partOn : ''}`}
            aria-pressed={open?.part === p}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              show(p, 'button', { x: r.left, y: r.top, w: r.width, h: r.height }, e.currentTarget);
            }}
          >
            {PART_NAMES[p]}
          </button>
        ))}
      </div>
      {card !== null && (
        <section ref={cardRef} className={styles.pop} role="dialog" aria-labelledby={titleId} data-engine-card="">
          <div className={styles.popHead}>
            <span id={titleId} className={styles.popTitle}>{card.title}</span>
            <button
              type="button"
              className={styles.popClose}
              aria-label={CARD_CLOSE}
              onClick={() => { if (performance.now() - openedAt.current >= GUARD_MS) close(); }}
            >
              ✕
            </button>
          </div>
          {card.lines.map((l) => <p key={l} className={styles.popLine}>{l}</p>)}
        </section>
      )}
    </div>
  );
}
