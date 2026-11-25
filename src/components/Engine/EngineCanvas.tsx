import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { regionAt, type EngineScene, type Rect } from './engineScene';
import { drawFrame, newMotion, type Tones } from './engineDraw';
import { MAT } from './enginePalette';
import type { EnginePart } from './engineView';
import styles from './EngineFace.module.css';

/**
 * The Engine · Micro (BL61, step 1) — the canvas: the frame loop and the hand. It draws the scene (`engineScene`) with the
 * prototypes' drawing (`engineDraw`), and keeps only motion between scenes, never saved.
 *
 * The frame loop runs only while the page is visible, the canvas is on screen and motion is allowed; under reduced
 * motion each scene is one still frame. Colours are the app's tokens, read from CSS, and the machine's own paint
 * (`enginePalette`): no colour is written here.
 *
 * The hand, as in the prototypes: a drag on the piston tries a price — it holds where it was taken, the scale holds still
 * under it, and the price stays in the frame; a tap on a part opens its card beside it (the face places it), a tap on an
 * open part closes it, and a tap on no part closes any; a press that moved is no tap; a fingertip finds a small part
 * within 44 px; "↺ back to live" goes back to today's price. The drag lives on a thin handle over the piston
 * (`touch-action: none`), so a stroke anywhere else scrolls the page.
 *
 * The tape reads out as the Dashboard's chart does (the owner's ask, 2026-11-25): under a mouse, or a finger that slides
 * along it — sideways, clearly (more than 8 px, and more across than down: the prototypes' rule for the tape), so an
 * up-and-down stroke still scrolls the page (the canvas is `touch-action: pan-y`; the page takes such a stroke, and the
 * readout goes). A finger's readout stays on its moment when it lets go, until the next touch; a mouse's goes with it.
 */

interface Props {
  scene: EngineScene;
  reducedMotion: boolean;
  /** What the canvas says to a screen reader (`engineAria`). */
  label: string;
  /** The part whose card is open: a ring is drawn round it. */
  openPart: EnginePart | null;
  /** A tap on a part: its card opens beside `at`, the part's box on the screen. */
  onPart: (part: EnginePart, at: Rect) => void;
  /** A tap on no part: an open card closes. */
  onNothing: () => void;
  /** The hand took the picture — the piston dragged, or the tape read by a finger: an open card closes. */
  onHand: () => void;
  /** A price tried by the drag — never saved. */
  onTry: (price: number) => void;
  /** Back to today's price. */
  onBack: () => void;
}

function readTones(el: Element): Tones {
  const cs = getComputedStyle(el);
  const v = (n: string): string => cs.getPropertyValue(n).trim() || MAT.muted;   // never shown: every token is set (v1.4: the paint's own)
  return {
    green: v('--green'), amber: v('--amber'), red: v('--red'), btc: v('--btc'), text: v('--text-primary'), text2: v('--text-secondary'),
    accent: v('--orange'), coinbase: v('--venue-coinbase'), strike: v('--venue-strike'), card: v('--bg-card'), border: v('--border'),
  };
}

/** A press on the canvas: where it began, by what, on the tape or not, whether it moved, and whether it reads the tape. */
interface Press { id: number; x0: number; y0: number; finger: boolean; tape: boolean; moved: boolean; reading: boolean }

export default function EngineCanvas({ scene, reducedMotion, label, openPart, onPart, onNothing, onHand, onTry, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef(scene);
  const openRef = useRef(openPart);
  const [firstMotion] = useState(newMotion);   // built once, not on every render (v1.4)
  const motion = useRef(firstMotion);
  const drag = useRef<{ id: number; x0: number; y0: number; off: number; moved: boolean } | null>(null);
  const press = useRef<Press | null>(null);
  const lastPress = useRef<Press | null>(null);
  const pistonY = useRef(0);
  const tones = useRef<Tones | null>(null);
  const visible = usePageVisibility();
  const [onScreen, setOnScreen] = useState(true);
  const frame = useRef(0);
  sceneRef.current = scene;
  openRef.current = openPart;

  const draw = useCallback((ts: number) => {
    const cv = canvasRef.current;
    if (cv === null) return;
    const ctx = cv.getContext('2d');
    if (ctx === null) return;
    if (tones.current === null) tones.current = readTones(cv);
    const s = sceneRef.current;
    const dpr = Math.min(2.5, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    if (cv.width !== Math.round(s.W * dpr) || cv.height !== Math.round(s.H * dpr)) {
      cv.width = Math.round(s.W * dpr);
      cv.height = Math.round(s.H * dpr);
      motion.current.read = null;   // a new width: the readout's place is gone with the old one
    }
    const yP = drawFrame(ctx, s, motion.current, tones.current, { ts, now: Date.now(), dpr, reduce: reducedMotion, openPart: openRef.current });
    pistonY.current = yP;
    const h = handleRef.current;
    if (h !== null) h.style.transform = `translate(${s.bay.cX - 8}px, ${yP - 24}px)`;   // the handle rides the piston
  }, [reducedMotion]);
  const still = useCallback(() => draw(typeof performance !== 'undefined' ? performance.now() : 0), [draw]);

  // The frame loop: only while visible, on screen and in motion; otherwise one still frame a scene.
  useEffect(() => {
    const cv = canvasRef.current;
    if (cv === null) return;
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver((es) => { setOnScreen(es.some((e) => e.isIntersecting)); });
      io.observe(cv);
    }
    return () => io?.disconnect();
  }, []);

  useEffect(() => {
    const running = visible && !reducedMotion && onScreen;   // off screen, no loop at all (v1.4)
    if (!running) {
      motion.current.last = 0;
      still();
      return;
    }
    const tick = (ts: number): void => {
      draw(ts);
      frame.current = requestAnimationFrame(tick);
    };
    frame.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame.current);
  }, [visible, reducedMotion, onScreen, draw, still]);

  // Under reduced motion (or hidden), each new scene — or a card opened — is drawn once.
  useEffect(() => {
    if (!visible || reducedMotion) still();
  }, [scene, openPart, visible, reducedMotion, still]);

  const local = (e: { clientX: number; clientY: number }): { x: number; y: number } => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  /** A box on the picture, on the screen — where its card opens beside it. */
  const onScreenBox = (b: Rect): Rect => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: r.left + b.x, y: r.top + b.y, w: b.w, h: b.h };
  };
  const moving = (): boolean => visible && !reducedMotion;
  const redraw = (): void => { if (!moving()) still(); };

  // ── the piston's handle: a drag tries a price; a tap opens its card ──
  const onDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = local(e);
    drag.current = { id: e.pointerId, x0: p.x, y0: p.y, off: pistonY.current - p.y, moved: false };   // it holds where it was taken
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    const p = local(e);
    if (!d.moved && Math.abs(p.x - d.x0) + Math.abs(p.y - d.y0) <= 4) return;   // a tap is not a drag: no price tried until the hand moves
    if (!d.moved) onHand();   // the drag takes the picture: an open card closes, as in the prototypes
    d.moved = true;
    const m = motion.current;
    m.held = true; m.hinted = true;
    const s = sceneRef.current;
    const lo = m.lo; const hi = m.hi;
    if (!(hi > lo)) return;
    const y = p.y + d.off;
    const price = Math.exp(lo + (s.bot - y) / (s.bot - s.top) * (hi - lo));
    onTry(Math.min(Math.exp(hi) * 0.985, Math.max(Math.exp(lo) * 1.01, price)));
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    drag.current = null;
    motion.current.held = false;
    if (!d.moved) {   // a tap on the piston opens its card, beside the piston
      const s = sceneRef.current;
      const r = s.regions.find((q) => q.id === 'piston') ?? { x: s.bay.cX, y: pistonY.current - 20, w: s.bay.right - s.bay.cX, h: 28 };
      onPart('price', onScreenBox(r));
    }
    redraw();
  };
  // A cancelled touch — the system took it — lets go and opens nothing: it is not a tap (v1.4).
  const onCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    drag.current = null;
    motion.current.held = false;
    redraw();
  };

  // ── the canvas: a tap on a part, a mouse's hover, and the tape's readout ──
  const onCanvasDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const p = local(e);
    const finger = e.pointerType !== 'mouse';
    const m = motion.current;
    if (finger && m.read !== null) { m.read = null; redraw(); }   // a new touch takes a finger's readout away
    press.current = { id: e.pointerId, x0: p.x, y0: p.y, finger, tape: regionAt(sceneRef.current, p.x, p.y)?.id === 'tape', moved: false, reading: false };
    lastPress.current = null;
  };
  const onCanvasMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const p = local(e);
    const m = motion.current;
    const pr = press.current !== null && press.current.id === e.pointerId ? press.current : null;
    if (pr !== null && Math.abs(p.x - pr.x0) + Math.abs(p.y - pr.y0) > 4) pr.moved = true;
    if (e.pointerType === 'mouse') {   // a mouse: the ring and cursor of the part under it and, over the tape, the readout
      const hit = regionAt(sceneRef.current, p.x, p.y);
      const was = m.hover;
      const read = m.read;
      m.hover = hit?.id ?? null;
      m.read = hit?.id === 'tape' ? { x: p.x, at: null } : null;
      e.currentTarget.style.cursor = hit === null ? 'default' : 'pointer';
      if (was !== m.hover || read !== null || m.read !== null) redraw();
      return;
    }
    if (pr === null || !pr.tape) return;
    const dx = Math.abs(p.x - pr.x0);
    const dy = Math.abs(p.y - pr.y0);
    if (!pr.reading && dx > 8 && dx > dy * 1.2) { pr.reading = true; onHand(); }   // clearly sideways: it reads the tape
    if (pr.reading) { m.read = { x: p.x, at: null }; redraw(); }
  };
  const onCanvasUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pr = press.current;
    if (pr === null || pr.id !== e.pointerId) return;
    press.current = null;
    lastPress.current = pr;
    const m = motion.current;
    const c = m.chart;
    if (pr.reading && m.read !== null && c !== null && c.x1 > c.x0) {   // let go: the readout stays on its moment, as on the Dashboard
      const x = Math.max(c.x0, Math.min(c.x1, m.read.x));
      m.read = { x, at: c.t0 + (x - c.x0) / (c.x1 - c.x0) * c.span };
      redraw();
    }
  };
  // The page took the stroke (an up-and-down swipe scrolls it): no readout, and no tap.
  const onCanvasCancel = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pr = press.current;
    if (pr === null || pr.id !== e.pointerId) return;
    press.current = null;
    lastPress.current = { ...pr, moved: true };
    if (pr.reading) { motion.current.read = null; redraw(); }
  };
  const onClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const lp = lastPress.current;
    if (lp !== null && (lp.reading || (!lp.finger && lp.moved))) return;   // a readout, or a mouse's drag, is no tap
    const { x, y } = local(e);
    const hit = regionAt(sceneRef.current, x, y, lp?.finger ?? false);
    if (hit === null) { onNothing(); return; }
    if (hit.id === 'untest') onBack();
    else if (hit.part !== null) onPart(hit.part, onScreenBox(hit));
  };
  const onLeave = (): void => {
    const m = motion.current;
    const following = m.read !== null && m.read.at === null && !(press.current?.reading ?? false);
    const was = m.hover !== null || following;
    m.hover = null;
    if (following) m.read = null;
    if (was) redraw();
  };

  return (
    <div className={styles.stage} style={{ width: scene.W, height: scene.H }}>
      <canvas
        ref={canvasRef}
        className={styles.canvas}
        style={{ width: scene.W, height: scene.H }}
        role="img"
        aria-label={label}
        onPointerDown={onCanvasDown}
        onPointerMove={onCanvasMove}
        onPointerUp={onCanvasUp}
        onPointerCancel={onCanvasCancel}
        onPointerLeave={onLeave}
        onClick={onClick}
      />
      <div
        ref={handleRef}
        className={styles.handle}
        style={{ width: scene.bay.right - scene.bay.cX + 16 }}
        aria-hidden="true"
        data-engine-piston=""
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
      />
    </div>
  );
}
