---
paths:
  - "src/components/Charts/**"
  - "src/components/PowerLaw/**"
  - "src/components/Almanac/**"
  - "src/components/LivingOnBitcoin/**"
  - "src/components/**/*Chart*"
  - "src/components/ui/ChartZoom*"
  - "src/hooks/useChartZoom.ts"
  - "src/lib/chartZoom.ts"
---

# Rules — charts and chart zoom

Read first, for what you touch: `docs/claude/ui.md` (§ Chart zoom), `docs/claude/almanac.md`.

Each rule's full text — its mechanism, measures and history — is in `docs/claude/rules-in-full.md` § `charts.md`.

| Constraint | Rule |
|---|---|
| Chart zoom changes the VIEW only | Zoom state reaches the axes' `domain` / `ticks`, the Tooltip's `active` (with `isAnimationActive={false}` and `wrapperStyle={{ transitionProperty: 'none' }}` beside it), each series' `activeDot` and the overlay — never a series' data, a domain-as-data or an engine input: Decision's `buildChartSeries`, `chartDomain`, `xExtent` and `engineInputs`, and PowerLaw's `chartData`, stay the full view. A narrowed axis needs `allowDataOverflow`. Pinned by `chartZoomWiring.test.ts` (VIEW ONLY, the per-adopter recipe) |
| A zoom gesture's quiet outlives the gesture (Z17) | `quiet` is set at a drag's arm and a pinch's start; `endDrag` / `endPinch` never clear it. It wakes only on the first `touchmove` of a touch that started ALONE (a second finger clears `wake`) or on a `mousemove` (a tap's compat mousemove included) — never mid-gesture, NEVER at touchstart. Every series needs `activeDot={!zoom.quiet}`. Never hide quiet by REMOVING the Tooltip. Pinned by `chartZoomWiring.test.ts`, the Z17 e2e |
| The price reach contains home, and a reach equal to home is the old clamp bit for bit | `normalizePins(…, reach)` unions the reach with home axis by axis; a span at or above the reach's IS the reach (auto when it is home); a pin back at home is auto. HOME stays the fitted view — the opening view and Reset's. Only the Decision chart passes a reach (price $0.01–$10M); PowerLaw passes none. Every `normalizePins(` call in the hook passes the reach. Pinned by ⭐26 (`chartZoom.test.ts`), `chartZoomWiring.test.ts` |
| The zoom toolbar never sits over the plot (Z18) | `ChartZoomToolbar` lives in each chart card's title row (`ChartHead`, min-height 32px), right-aligned, one layout on every device: no media query may touch `.toolbar`; it has no `position: absolute` and no `opacity`. Pinned by `chartZoomWiring.test.ts`, the ROW / RIGHT / CLEAR e2e, STEADY |
| A chart's `touch-action` follows its zoom mode, and its one non-passive listener is the `touchmove` | `pan-y` in Scroll mode, `none` while Zoom or Pan is pressed. The `touchmove`, scoped to the chart area, is the ONLY non-passive listener; it cancels only a pinch or a Z6 sideways scrub, and only while `e.cancelable`. A `touchstart` is passive and never cancelled (taps must reach the tooltip and the double-tap reset); a vertical stroke is never held. The pure `lockAxis` decides the lock; the stroke lives in the gesture effect's closure, one per chart, never module state. Pinned by `chartZoomWiring.test.ts`, the Z6 e2e; the iOS arbitration is device-gated |
| Chart Y-axis | Always abbreviated — exact format causes label overlap |
