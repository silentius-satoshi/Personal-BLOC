import { useLayoutEffect, type ReactNode } from 'react';
import type { ChartZoom } from '../../hooks/useChartZoom';
import type { PlotRect } from '../../lib/chartZoom';
import styles from './ChartZoomFrame.module.css';

/**
 * ChartZoomFrame — the shared chart-zoom gesture surface (spec `pbloc-spec-chart-zoom-v1.md`): the area the gestures
 * land on, the box overlay and the once-per-session note. The chart's ResponsiveContainer is its child; `useChartZoom`
 * owns the state. Its toolbar is `ChartZoomToolbar` (below), which each chart places in its card's title row (Z18).
 *
 *  - `div.area` is the gesture surface (the hook's listeners). It carries `touch-action` by mode and wraps the
 *    ResponsiveContainer with NO padding, so the probed plot rect is area-relative.
 *  - 🔴 Z1: `div.plot`, `div.box` and `div.note` are `pointer-events: none`. These positioned layers paint above the
 *    SVG — without it recharts gets no hover and no tap, and the tooltip dies. chartZoomWiring pins the CSS.
 */
export function ChartZoomFrame({ zoom, children }: { zoom: ChartZoom; children: ReactNode }) {
  return (
    <div ref={zoom.areaRef} className={styles.area} style={{ touchAction: zoom.touchAction }}
      data-testid="chart-zoom" data-zoomed={zoom.zoomed} data-mode={zoom.mode ?? 'none'}
      data-dragging={zoom.dragging} data-quiet={zoom.quiet}>
      {children}
      {zoom.plotStyle && (
        <div className={styles.plot} style={zoom.plotStyle} data-testid="chart-zoom-plot" aria-hidden="true">
          <div ref={zoom.boxRef} className={styles.box} />
        </div>
      )}
      {zoom.note && (
        <div className={`${styles.note} ${zoom.note.fading ? styles.noteFading : ''}`} role="status">
          {zoom.note.text}
        </div>
      )}
    </div>
  );
}

/**
 * ChartZoomToolbar — Zoom · Pan · + · − · Reset, in Plotly's and bitbo's order (chartZoomWiring pins it). Each chart
 * places it in its card's title row, right-aligned, on a phone and a computer alike — one layout, so it never covers
 * the plot (Z18: the old fine-pointer overlay sat over the end of the modeled path). Plain buttons (not the shared
 * inputs, which disable themselves for viewers): zoom writes nothing.
 */
export function ChartZoomToolbar({ zoom }: { zoom: ChartZoom }) {
  return (
    <div className={styles.toolbar} role="toolbar" aria-label="Chart zoom">
      <button type="button" className={styles.btn} aria-label="Zoom (drag a box)" title="Zoom (drag a box)"
        aria-pressed={zoom.mode === 'zoom'} onClick={() => zoom.pressMode('zoom')}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>
      </button>
      <button type="button" className={styles.btn} aria-label="Pan" title="Pan"
        aria-pressed={zoom.mode === 'pan'} onClick={() => zoom.pressMode('pan')}>
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5v13M1.5 8h13M8 1.5 6 3.5M8 1.5l2 2M8 14.5l-2-2M8 14.5l2-2M1.5 8l2-2M1.5 8l2 2M14.5 8l-2-2M14.5 8l-2 2" />
        </svg>
      </button>
      <button type="button" className={styles.btn} aria-label="Zoom in" title="Zoom in" onClick={zoom.zoomIn}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M8 3v10" /></svg>
      </button>
      <button type="button" className={styles.btn} aria-label="Zoom out" title="Zoom out" onClick={zoom.zoomOut}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10" /></svg>
      </button>
      <button type="button" className={styles.btn} aria-label="Reset view" title="Reset view"
        disabled={!zoom.zoomed} onClick={zoom.reset}>
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2v3h3" /></svg>
      </button>
    </div>
  );
}

interface ProbeOffset { left?: number; top?: number; width?: number; height?: number }

/**
 * Rendered by recharts through `<Customized component={zoom.probe}/>`, which clones it with the chart's props and
 * state — including `offset`, the plot rect relative to the SVG. Reports it after layout; draws nothing.
 */
export function PlotProbe({ onRect, offset }: { onRect: (r: PlotRect) => void; offset?: ProbeOffset }) {
  const left = offset?.left, top = offset?.top, width = offset?.width, height = offset?.height;
  useLayoutEffect(() => {
    if (left === undefined || top === undefined || width === undefined || height === undefined) return;
    if (![left, top, width, height].every(Number.isFinite) || !(width > 0) || !(height > 0)) return;
    onRect({ left, top, width, height });
  }, [left, top, width, height, onRect]);
  return null;
}
