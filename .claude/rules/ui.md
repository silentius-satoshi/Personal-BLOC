---
paths:
  - "src/components/**"
  - "src/styles/**"
  - "src/pages/**"
  - "src/App.tsx"
  - "src/utils/**"
  - "src/simulation/miningUtils.ts"
  - "src/hooks/useMiningSimulation.ts"
---

# Rules — components, styles, formatters and the Mining tab

Read first, for what you touch: `docs/claude/ui.md`, `docs/claude/screens.md`.

| Constraint | Rule |
|---|---|
| Every masked field goes through `ui/PassphraseInput` | Never hand-roll an `<input type="password">`. The shared widget bakes in the four iOS suppressions (an autocapitalized passphrase never decrypts) and the `onPointerDown`+`preventDefault` focus guard (an onClick-only toggle blurs the field and collapses the iOS keyboard mid-entry). A `grep -rn 'type="password"' src` must return ONLY `AppUnlockGate.tsx` + `StoreMigrationGate.tsx` — both unrendered, retained as the Option-3a rebuild basis. PINs use it too, passing `inputMode="numeric"` so the keypad survives reveal |
| `SummaryBar fmtUSD` | Local sign-preserving — NEVER replace with shared version |
| Mining electricity | Fiat overhead — 100% sats kept, never deducted |
| Mining strategy cards | Fixed presets — independent of per-device `soloMining` |
| `MiningOddsBar` | Reads store directly — not props |
| `fmtMining` | Inlined in `format.ts` — no circular import |
| Override a composed class's property on a DOUBLED selector, never beside `composes:` | A declaration in the composing rule ties the composed class's specificity (0,1,0), so the bundle's rule order decides, and that order is an accident of the import graph that differs between dev and production. P10 shipped Mining, Power Law and the Converter 600px wide in production while dev looked right. Put the override on `.x.x` (0,2,0), which wins in any order: `.main.main { max-width }`, `.chartBox.chartBox { height }`. Every single-class rule of the composing class counts, a media query's included, and so do shorthands (`border` covers `border-color`). `composedOverrides.test.ts` IS the audit, over every `*.module.css` under `src/` (P9–P11) |
| Never `position: fixed` under EdgeBackGesture's `.page`, and never a body `scroll-padding` | `.page` has `will-change: transform`, which makes it the containing block for its fixed descendants: a fixed element there scrolls away with the page (measured on the control dock, F2). Pin to the window's edge with `position: sticky` as the face's LAST child — `ControlDock` does, on all four engine faces (Decision, Cycling, Ownership — after its two-column `.shell`, F16 — and Strategy), and it also moves with the page through a swipe-back. In full mode a sticky element needs an ancestor that is no scroll container: `[data-active-tab="almanac"] .main` (Δ1). A body `scroll-padding-bottom` kept scrolled-to elements above the dock, but focusing the dock itself then jumped the page by ~400 px (F5). Pinned by `controlDockWiring.test.ts` (PREMISE, STICKY-CSS, ONE-DOCK, DOUBLED; on the parents P-ONE-DOCK and P-DOUBLED) and `e2e/controlDock.spec.ts`. Four Settings overlays already sit under `.page` (NostrAuthGate, ViewerLoginFlow, RecoveryKeyCeremony, RestoreBackupFlow — each `position: fixed`, rendered inline by SettingsMain in simple mode) — logged; not fixed in this run |
| `NumberInput` suffix | Avoid inside input — cursor issues; use external label |
| `NumberInput` saving | Every field declares how it saves — `save` is required. `'button'` for a figure read off Strike or Coinbase (the four dated setters `setCbLoanBalance`, `setCbLiquidationPrice`, `setAdvisorActualBlocBalance`, `setColdStorageBtc`; `setCbCollateralBtc`; `emitBalanceReading`): saved once by "Save — dated today" or Enter. `'leave'` for a plan setting (a field of the synced plan, or the manual BTC price): saved once on leaving or Enter. `'live'` only for a draft, a what-if or a read-only field. Leaving, Enter and Save go through ONE rule, `numberCommit` (`ui/numberInputModel.ts`, BL34–BL35): nothing unless typed, never the figure the field shows (a `'button'` field's re-entry aside — its save dates it). Never call `onChange` from `onBlur` or `onKeyDown` directly, and never make a plan or dated field `'live'`: a click in and out re-dated a dated figure (F-2c-1), writers that do more than save fired on a mere click, and typing saved every partial — a journal reading per keystroke on Coinbase's collateral. Pinned by `numberInputModel.test.ts` (WIRING, SITES) and `e2e/numberField.spec.ts` |
| A page closed from code blurs the focused field first | React runs no `onBlur` for a field it unmounts (react-dom 18 turns its events off for the commit), and a touch swipe — or a click dispatched from code — moves no focus: a typed `'leave'` field, or the goal field, would go unsaved (F1, BL34–BL35; measured with a real touch swipe). `EdgeBackGesture` blurs before a committed swipe's `onBack()` and before its forwarded tap's click. Pinned by `numberInputModel.test.ts` (GESTURE) and `e2e/numberFieldSwipe.spec.ts` |
| Tab hidden guard | `useEffect` in `AppShell` redirects when the active tab is hidden — or, since the plan of record's Run 4, is the CB Loan or Emergency tab with the Coinbase loan off |
| `SettingsMain` ALL_TABS | Keep in sync with `AppShell` `ALL_TABS_META` |
