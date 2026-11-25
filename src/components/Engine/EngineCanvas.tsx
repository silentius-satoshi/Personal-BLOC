import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { usePageVisibility } from '../../hooks/usePageVisibility';
import { regionAt, type EngineScene } from './engineScene';
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
 * under it, and the price stays in the frame; a tap on a part opens its card, and a tap on an open part closes it; a
 * fingertip finds a small part within 44 px; "↺ back to live" goes back to today's price. The drag lives on a thin handle
 * over the piston (`touch-action: none`), so a stroke anywhere else scrolls the page.
 */

interface Props {
  scene: EngineScene;
  reducedMotion: boolean;
  /** What the canvas says to a screen reader (`engineAria`). */
  label: string;
  /** The part whose card is open: a ring is drawn round it. */
  openPart: EnginePart | null;
  onPart: (part: EnginePart) => void;
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
    accent: v('--orange'), coinbase: v('--venue-coinbase'), strike: v('--venue-strike'),
  };
}

export default function EngineCanvas({ scene, reducedMotion, label, openPart, onPart, onTry, onBack }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef(scene);
  const openRef = useRef(openPart);
  const [firstMotion] = useState(newMotion);   // built once, not on every render (v1.4)
  const motion = useRef(firstMotion);
  const drag = useRef<{ id: number; x0: number; y0: number; off: number; moved: boolean } | null>(null);
  const finger = useRef(false);
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
  const moving = (): boolean => visible && !reducedMotion;

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
    if (!d.moved) onPart('price');   // a tap on the piston opens its card
    if (!moving()) still();
  };
  // A cancelled touch — the system took it — lets go and opens nothing: it is not a tap (v1.4).
  const onCancel = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.id !== e.pointerId) return;
    drag.current = null;
    motion.current.held = false;
    if (!moving()) still();
  };

  // ── the canvas: a tap on a part, a mouse's hover ──
  const onCanvasDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => { finger.current = e.pointerType === 'touch'; };
  const onClick = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    const { x, y } = local(e);
    const hit = regionAt(sceneRef.current, x, y, finger.current);
    if (hit === null) return;
    if (hit.id === 'untest') onBack();
    else if (hit.part !== null) onPart(hit.part);
  };
  const onHover = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    if (e.pointerType !== 'mouse') return;
    const m = motion.current;
    const p = local(e);
    const hit = regionAt(sceneRef.current, p.x, p.y);
    const was = m.hover;
    m.ptr = p; m.hover = hit?.id ?? null;
    e.currentTarget.style.cursor = hit === null ? 'default' : 'pointer';
    if (!moving() && was !== m.hover) still();
  };
  const onLeave = (): void => {
    const m = motion.current;
    const was = m.hover;
    m.ptr = null; m.hover = null;
    if (!moving() && was !== null) still();
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
        onClick={onClick}
        onPointerMove={onHover}
        onPointerLeave={onLeave}
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
