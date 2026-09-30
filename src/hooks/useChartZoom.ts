import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, RefObject } from 'react';
import {
  MIN_DRAG_PX, MIN_SPAN_TIME_LOG,
  boxRect, boxToPins, classifyBox, effectiveView, inRect, isDoubleTap, isZoomed, lockAxis, normalizePins, panPins,
  pinchPins, stepPins, zoomBackNote,
  type LockAxis, type MinSpan, type Pins, type PlotRect, type Pt, type Scales, type Tap, type View,
} from '../lib/chartZoom';
import { PlotProbe } from '../components/ui/ChartZoomFrame';

/**
 * useChartZoom — the React adapter over `lib/chartZoom` (spec `pbloc-spec-chart-zoom-v1.md`), kept thin the way
 * `usePointerDrag` wraps `gestureModel`. VIEW ONLY: it returns the axis domains and the gesture plumbing; it never
 * touches a series, and nothing it holds is persisted (per mount, session only).
 *
 * Why not `usePointerDrag`: its axis lock cancels a diagonal drag and a second pointer cancels it — a box and a pinch
 * are exactly those. So this mirrors its PATTERNS instead: listeners on `window` (passive) once a gesture starts,
 * rAF-batched updates, pointer capture taken on arm, never at pointerdown.
 *
 * Inputs:
 *  - mouse: a drag draws a box unless Pan is pressed (a mouse can't scroll by dragging); the native `dblclick` resets.
 *  - touch / pen: the MODE decides — none (default on a touch device, "Scroll"): a vertical stroke scrolls the page,
 *    as before; a stroke that starts on the plot and passes 8px more sideways than vertical (`lockAxis`) holds the
 *    page still until the finger lifts, so recharts' tooltip scrubs even with a wobble (Z6). Zoom: a one-finger box,
 *    then Zoom un-presses itself (one-shot); Pan: a one-finger pan. A double tap resets in every mode. Two fingers
 *    that started on the chart pinch, in every mode — a second finger hands a scrub over to the pinch.
 *  - `touch-action` follows the mode (`pan-y` with none, `none` in Zoom/Pan). The `touchmove` is the ONE non-passive
 *    listener (the DraggableSheet precedent): it calls preventDefault only while pinching or under a sideways scrub.
 *    A touchstart is passive — never cancelled — so taps always reach the tooltip and the double-tap reset.
 */

export type ZoomMode = 'zoom' | 'pan' | null;
const NO_PINS: Pins = { x: null, y: null };
/** How long the once-per-session note stays, then how long its fade runs. */
const NOTE_MS = 3600;
const NOTE_FADE_MS = 400;
/** A tap: shorter than this, and moving less than MIN_DRAG_PX. */
const TAP_MS = 250;

/** The note shows once per app session, whichever chart zoomed first (a module flag, never persisted). */
let noteShown = false;

export interface ChartZoom {
  /** The axis domains to render: each pinned axis clamped to the data, each auto axis the full extent. */
  view: View;
  zoomed: boolean;
  mode: ZoomMode;
  /** Zoom / Pan button: a radio pair on a fine-pointer device; a toggle (off = scroll) on a touch device. */
  pressMode: (m: 'zoom' | 'pan') => void;
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  /** True while a box, a pan or a pinch runs — the chart hides its tooltip. */
  dragging: boolean;
  areaRef: (el: HTMLDivElement | null) => void;
  boxRef: RefObject<HTMLDivElement>;
  /** The plot rect (probed from recharts), or undefined before the first probe. */
  plotStyle: CSSProperties | undefined;
  plotWidth: number;
  /** A stable `<PlotProbe/>` element for `<Customized component={zoom.probe}/>`. */
  probe: ReactElement;
  note: { text: string; fading: boolean } | null;
  touchAction: 'pan-y' | 'none';
}

const sameAxis = (a: Pins['x'], b: Pins['x']): boolean => {
  if (a === null || b === null) return a === b;
  const tol = (u: number, v: number) => Math.abs(u - v) <= 1e-9 * Math.max(Math.abs(u), Math.abs(v), 1e-300);
  return tol(a[0], b[0]) && tol(a[1], b[1]);
};
const samePins = (a: Pins, b: Pins): boolean => sameAxis(a.x, b.x) && sameAxis(a.y, b.y);

/** A fine primary pointer (a mouse or trackpad) — the Zoom default and the radio behaviour. */
function hasFinePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches;
}

interface Drag {
  id: number;
  pointerType: string;
  kind: 'box' | 'pan';
  start: Pt;
  last: Pt;
  startView: View;
  startPins: Pins;
  armed: boolean;
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  cancel: (e: PointerEvent) => void;
  key: (e: KeyboardEvent) => void;
}

interface Pinch { from: [Pt, Pt]; startView: View }

/** Z6 — a one-finger stroke in Scroll mode: undecided (`null`) until it passes 8px, then locked to an axis. */
interface Stroke { id: number; start: Pt; lock: LockAxis | null }

/**
 * @param full   the chart's own full extent (the unzoomed view) — a memo, so its identity changes only with the data.
 * @param scales stable (a module constant).
 * @param min    the minimum spans, in scaled units; stable.
 */
export function useChartZoom(full: View, scales: Scales, min: MinSpan = MIN_SPAN_TIME_LOG): ChartZoom {
  const fine = useMemo(hasFinePointer, []);
  const [pins, setPins] = useState<Pins>(NO_PINS);
  const [mode, setMode] = useState<ZoomMode>(() => (fine ? 'zoom' : null));
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState<{ text: string; fading: boolean } | null>(null);
  const [areaEl, setAreaEl] = useState<HTMLDivElement | null>(null);
  const [plotRect, setPlotRect] = useState<PlotRect | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Clamp at RENDER (no stale frame), then write the clamped pins back — the clampMonth house pattern. The compare
  // is tolerant: a log→exp round trip moves the last bit, and an exact compare would write back forever.
  const clamped = useMemo(() => normalizePins(pins, full, scales, min), [pins, full, scales, min]);
  useEffect(() => { if (!samePins(clamped, pins)) setPins(clamped); }, [clamped, pins]);
  const view = useMemo(() => effectiveView(clamped, full), [clamped, full]);
  const zoomed = isZoomed(clamped);

  // Everything the listeners read, current on every render (usePointerDrag's cfgRef pattern).
  const live = useRef({ view, clamped, full, scales, min, mode, fine, rect: plotRect });
  live.current = { view, clamped, full, scales, min, mode, fine, rect: plotRect };

  const timers = useRef<number[]>([]);
  const showNoteOnce = useCallback((pointerType: string) => {
    if (noteShown) return;
    noteShown = true;
    setNote({ text: zoomBackNote(pointerType), fading: false });
    timers.current.push(
      window.setTimeout(() => setNote((n) => (n ? { ...n, fading: true } : n)), NOTE_MS),
      window.setTimeout(() => setNote(null), NOTE_MS + NOTE_FADE_MS),
    );
  }, []);
  useEffect(() => () => { timers.current.forEach((t) => window.clearTimeout(t)); }, []);

  /** Set pins through the clamp; the first zoom of the session shows the note. */
  const commit = useCallback((next: Pins, pointerType: string) => {
    const L = live.current;
    const n = normalizePins(next, L.full, L.scales, L.min);
    setPins(n);
    if (isZoomed(n)) showNoteOnce(pointerType);
  }, [showNoteOnce]);

  const reset = useCallback(() => setPins(NO_PINS), []);
  const zoomIn = useCallback(() => {
    commit(stepPins(live.current.view, 'in', live.current.scales), live.current.fine ? 'mouse' : 'touch');
  }, [commit]);
  const zoomOut = useCallback(() => {
    commit(stepPins(live.current.view, 'out', live.current.scales), live.current.fine ? 'mouse' : 'touch');
  }, [commit]);
  const pressMode = useCallback((m: 'zoom' | 'pan') => {
    // Fine pointer: a radio pair, one always pressed (Plotly). Touch: a toggle — off returns the chart to scrolling.
    setMode((cur) => (cur === m ? (live.current.fine ? cur : null) : m));
  }, []);

  const onRect = useCallback((r: PlotRect) => {
    setPlotRect((cur) => (cur && cur.left === r.left && cur.top === r.top && cur.width === r.width
      && cur.height === r.height ? cur : r));
  }, []);
  const probe = useMemo(() => createElement(PlotProbe, { onRect }), [onRect]);

  // ── The gestures, on the chart area ────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = areaEl;
    if (!el) return;
    // One of each per chart (Z11): the gesture state lives in this closure, never at module level.
    let drag: Drag | null = null;
    let pinch: Pinch | null = null;
    let stroke: Stroke | null = null;
    let raf: number | null = null;
    let pending: (() => void) | null = null;
    let tapStart: (Tap & { id: number }) | null = null;
    let lastTap: Tap | null = null;

    const local = (e: { clientX: number; clientY: number }): Pt => {
      const r = el.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const frame = (fn: () => void) => {
      pending = fn;
      if (raf === null) raf = requestAnimationFrame(() => { raf = null; const f = pending; pending = null; f?.(); });
    };
    const hideBox = () => { if (boxRef.current) boxRef.current.style.display = 'none'; };
    const drawBox = (a: Pt, b: Pt, rect: PlotRect) => {
      const box = boxRef.current;
      if (!box) return;
      const axes = classifyBox(a, b);
      if (axes === null) { box.style.display = 'none'; return; }
      const r = boxRect(a, b, axes, rect);
      box.style.display = 'block';
      box.style.left = `${r.left - rect.left}px`;
      box.style.top = `${r.top - rect.top}px`;
      box.style.width = `${r.width}px`;
      box.style.height = `${r.height}px`;
    };

    /** 'commit' applies the gesture, 'cancel' (Esc, pointercancel) undoes it, 'abandon' (a pinch takes over) stops. */
    const endDrag = (how: 'commit' | 'cancel' | 'abandon') => {
      const d = drag;
      if (!d) return;
      window.removeEventListener('pointermove', d.move);
      window.removeEventListener('pointerup', d.up);
      window.removeEventListener('pointercancel', d.cancel);
      window.removeEventListener('keydown', d.key);
      try { el.releasePointerCapture(d.id); } catch { /* never captured (a click) — harmless */ }
      drag = null;
      pending = null;   // a queued frame is superseded: the release applies the final position below
      hideBox();
      const L = live.current;
      if (how === 'commit' && d.armed && L.rect) {
        if (d.kind === 'box') {
          const axes = classifyBox(d.start, d.last);
          if (axes !== null) {
            commit(boxToPins(d.start, d.last, axes, L.rect, d.startView, d.startPins, L.scales), d.pointerType);
            // Phone: Zoom is one-shot, so the next drag scrolls the page again instead of drawing an accidental box.
            if (d.pointerType !== 'mouse' && !L.fine) setMode((m) => (m === 'zoom' ? null : m));
          }
        } else {
          commit(panPins(d.startView, d.last.x - d.start.x, d.last.y - d.start.y, L.rect, L.scales), d.pointerType);
        }
      } else if (how === 'cancel' && d.kind === 'pan') {
        setPins(d.startPins);   // Esc / cancel: the view snaps back
      }
      if (d.armed) setDragging(false);
    };

    const onPointerDown = (e: PointerEvent) => {
      const L = live.current;
      if (e.pointerType === 'touch' || e.pointerType === 'pen') {
        const p = local(e);
        tapStart = { id: e.pointerId, t: e.timeStamp, x: p.x, y: p.y };
      }
      if (drag || pinch || !L.rect) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const p = local(e);
      if (!inRect(p, L.rect)) return;   // a press on an axis label starts nothing
      const kind: Drag['kind'] | null = L.mode === 'pan' ? 'pan'
        : e.pointerType === 'mouse' || L.mode === 'zoom' ? 'box' : null;
      if (kind === null) return;        // touch with no mode: native scroll and the tooltip, as before
      const d: Drag = {
        id: e.pointerId, pointerType: e.pointerType, kind, start: p, last: p,
        startView: L.view, startPins: L.clamped, armed: false,
        move: () => {}, up: () => {}, cancel: () => {}, key: () => {},
      };
      d.move = (ev) => {
        if (ev.pointerId !== d.id || drag !== d) return;
        d.last = local(ev);
        if (!d.armed && Math.hypot(d.last.x - d.start.x, d.last.y - d.start.y) >= MIN_DRAG_PX) {
          d.armed = true;
          try { el.setPointerCapture(d.id); } catch { /* non-capturable — proceed without */ }
          setDragging(true);
        }
        if (!d.armed) return;
        const rect = live.current.rect;
        if (!rect) return;
        if (d.kind === 'box') {
          const a = d.start, b = d.last;
          frame(() => drawBox(a, b, rect));
        } else {
          const dx = d.last.x - d.start.x, dy = d.last.y - d.start.y;
          frame(() => {
            const L2 = live.current;
            setPins(normalizePins(panPins(d.startView, dx, dy, rect, L2.scales), L2.full, L2.scales, L2.min));
          });
        }
      };
      d.up = (ev) => { if (ev.pointerId === d.id) endDrag('commit'); };
      d.cancel = (ev) => { if (ev.pointerId === d.id) endDrag('cancel'); };
      d.key = (ev) => { if (ev.key === 'Escape') endDrag('cancel'); };
      window.addEventListener('pointermove', d.move, { passive: true });
      window.addEventListener('pointerup', d.up, { passive: true });
      window.addEventListener('pointercancel', d.cancel, { passive: true });
      window.addEventListener('keydown', d.key);
      drag = d;
    };

    // Double tap (touch / pen) — detected on pointerup; a mouse uses the native dblclick below.
    const onPointerUp = (e: PointerEvent) => {
      const s = tapStart;
      if (!s || s.id !== e.pointerId) return;
      tapStart = null;
      const p = local(e);
      const tap: Tap = { t: e.timeStamp, x: p.x, y: p.y };
      if (tap.t - s.t > TAP_MS || Math.hypot(p.x - s.x, p.y - s.y) >= MIN_DRAG_PX) return;
      if (isDoubleTap(lastTap, tap)) { lastTap = null; reset(); } else lastTap = tap;
    };
    const onPointerCancel = (e: PointerEvent) => { if (tapStart?.id === e.pointerId) tapStart = null; };
    const onDblClick = () => reset();

    // The pinch — two fingers that STARTED on the chart (targetTouches), in every mode.
    const pts = (e: TouchEvent): [Pt, Pt] => [local(e.targetTouches[0]), local(e.targetTouches[1])];
    const endPinch = () => {
      if (!pinch) return;
      pinch = null;
      pending = null;
      setDragging(false);
      if (isZoomed(live.current.clamped)) showNoteOnce('touch');
    };
    const touchById = (list: TouchList, id: number): Touch | null => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
      return null;
    };
    // ⚠ Registered PASSIVE: a touchstart is never cancelled, so a tap always reaches the tooltip and the double tap.
    const onTouchStart = (e: TouchEvent) => {
      const L = live.current;
      stroke = null;                    // a new finger ends any scrub — a second one hands it over to the pinch
      if (e.targetTouches.length === 2 && L.rect) {
        if (drag) endDrag('abandon');   // a second finger turns a one-finger box or pan into a pinch
        pinch = { from: pts(e), startView: L.view };
        setDragging(true);
        return;
      }
      // Z6: a one-finger stroke in Scroll mode that starts on the plot (a press on an axis label stays native).
      if (L.mode !== null || e.touches.length !== 1 || e.targetTouches.length !== 1 || !L.rect) return;
      const t = e.targetTouches[0];
      const p = local(t);
      if (inRect(p, L.rect)) stroke = { id: t.identifier, start: p, lock: null };
    };
    const onTouchMove = (e: TouchEvent) => {
      const p = pinch;
      if (p) {
        if (e.targetTouches.length < 2) return;
        // Once the page has started scrolling this touch can't be claimed — let it go.
        if (!e.cancelable) { endPinch(); return; }
        e.preventDefault();
        const to = pts(e);
        frame(() => {
          const L = live.current;
          if (!L.rect || pinch !== p) return;
          setPins(normalizePins(pinchPins(p.startView, p.from, to, L.rect, L.scales), L.full, L.scales, L.min));
        });
        return;
      }
      // Z6 — the scrub: undecided until the stroke passes 8px, then locked for the rest of the touch.
      const s = stroke;
      if (!s) return;
      if (e.touches.length !== 1) { stroke = null; return; }   // another finger is down — let the stroke go
      const t = touchById(e.touches, s.id);
      if (!t) return;
      if (s.lock === null) {
        const q = local(t);
        s.lock = lockAxis(q.x - s.start.x, q.y - s.start.y);
        if (s.lock === null) return;    // under 8px — it may still be a tap, so nothing is cancelled
        if (s.lock === 'y') { stroke = null; return; }   // a vertical start scrolls, as before
      }
      // Locked sideways: hold the page still so recharts' tooltip scrubs, wobble and all. Once the page has taken the
      // touch it can't be claimed back (the pinch's own rule) — let it go.
      if (!e.cancelable) { stroke = null; return; }
      e.preventDefault();   // Z6 — a sideways scrub
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (pinch && e.targetTouches.length < 2) endPinch();
      if (stroke && touchById(e.touches, stroke.id) === null) stroke = null;   // the scrubbing finger lifted
    };
    // WebKit's own page pinch — a second guard (the viewport already disables page zoom).
    const onGestureStart = (e: Event) => e.preventDefault();

    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerCancel);
    el.addEventListener('dblclick', onDblClick);
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });   // the ONE non-passive listener (pinch; Z6 scrub)
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    el.addEventListener('gesturestart', onGestureStart);
    return () => {
      endDrag('abandon');
      pinch = null;
      stroke = null;
      if (raf !== null) cancelAnimationFrame(raf);
      el.removeEventListener('pointerdown', onPointerDown);
      el.removeEventListener('pointerup', onPointerUp);
      el.removeEventListener('pointercancel', onPointerCancel);
      el.removeEventListener('dblclick', onDblClick);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
      el.removeEventListener('gesturestart', onGestureStart);
    };
  }, [areaEl, commit, reset, showNoteOnce]);

  const plotStyle = useMemo<CSSProperties | undefined>(() => (plotRect
    ? { left: plotRect.left, top: plotRect.top, width: plotRect.width, height: plotRect.height }
    : undefined), [plotRect]);

  return {
    view, zoomed, mode, pressMode, zoomIn, zoomOut, reset, dragging,
    areaRef: setAreaEl, boxRef, plotStyle, plotWidth: plotRect?.width ?? 0, probe, note,
    touchAction: mode === null ? 'pan-y' : 'none',
  };
}
