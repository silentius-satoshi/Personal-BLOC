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

| Constraint | Rule |
|---|---|
| Chart zoom changes the VIEW only | Zoom state reaches the axes' `domain` / `ticks`, the Tooltip's `active` (with `isAnimationActive={false}` and `wrapperStyle={{ transitionProperty: 'none' }}` beside it), each series' `activeDot`, and the overlay — never a series' data, a domain-as-data or an engine input. On Decision, `buildChartSeries`, `chartDomain`, `xExtent` and `engineInputs` stay the full view; on PowerLaw, `chartData`. A narrowed axis needs `allowDataOverflow` (recharts widens it back to the data otherwise). Pinned by `chartZoomWiring.test.ts` (VIEW ONLY + the per-adopter recipe) |
| A zoom gesture's quiet outlives the gesture (Z17) | `quiet` is set at a drag's arm and a pinch's start; `endDrag` / `endPinch` never clear it. It wakes only on the first `touchmove` of a touch that started ALONE (a second finger clears `wake`) or on a `mousemove` (incl. a tap's compat mousemove) — never mid-gesture, and NEVER at touchstart: recharts still holds the old finger's place until the tap's mousemove, so a touchstart wake flashes the old tooltip. recharts draws its active dots off its own `isTooltipActive`, never the Tooltip's `active`, so every series needs `activeDot={!zoom.quiet}`. Never hide quiet by REMOVING the Tooltip: recharts then drops its move handlers and misses the wake event itself. Pinned by `chartZoomWiring.test.ts` and the Z17 e2e |
| The price reach contains home, and a reach equal to home is the old clamp bit for bit | `normalizePins(…, reach)` unions the reach with home axis by axis; a span at or above the reach's IS the reach (auto when it is home); a pin back at home is auto. HOME stays the fitted view — the opening view and Reset's. Only the Decision chart passes a reach (price $0.01–$10M); PowerLaw passes none, so it is byte-identical. ⭐26 pins reach = home against a frozen copy of the old `normAxis`; every `normalizePins(` call in the hook passes the reach (wiring) |
| The zoom toolbar never sits over the plot (Z18) | `ChartZoomToolbar` lives in each chart card's title row (`ChartHead`, min-height 32px — the two-line title is 31.5px, so the box can't move when the history arrives), right-aligned, one layout on every device: no media query may touch `.toolbar`, and it has no `position: absolute` and no `opacity`. The old fine-pointer overlay covered the end of the modeled path and stayed hit-testable at opacity 0. Pinned by `chartZoomWiring.test.ts`, the ROW / RIGHT / CLEAR e2e and STEADY |
| A chart's `touch-action` follows its zoom mode, and its one non-passive listener is the `touchmove` | `pan-y` in Scroll mode, `none` while Zoom or Pan is pressed. The `touchmove` (scoped to the chart area) is the ONLY non-passive listener: it cancels only a pinch or a Z6 sideways scrub, and only while `e.cancelable`. A `touchstart` is passive and never cancelled — taps must reach the tooltip and the double-tap reset — and a vertical stroke is never held. The lock is decided by the pure `lockAxis`, and the stroke lives in the gesture effect's closure, one per chart (never module state). Pinned by `chartZoomWiring.test.ts` and the Z6 e2e; the iOS arbitration is device-gated |
| Chart Y-axis | Always abbreviated — exact format causes label overlap |
