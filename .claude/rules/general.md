# Rules — every session

Each rule's full text — its mechanism, measures and history — is in `docs/claude/rules-in-full.md` § `general.md`.

These rows bind everywhere.

## Critical Constraints

| Constraint | Rule |
|---|---|
| An exact (deep-equal) golden may depend only on `+ − × ÷` | Store any input built with `Math.pow`/`log`/`exp`/`**` IN the golden and feed it back — never recompute it at test time. The engine is pure `+ − × ÷` (a G1 test fails on any approximated Math in `cyclingSim.ts`'s imports). A value that must be recomputed gets a tolerance (`toBeCloseTo`, or a relative 1e-12) |
| A hook may never sit to the right of `\|\|`, `&&`, or `?:` | Short-circuit makes it a conditional hook (React #311; `npm run lint`'s `react-hooks/rules-of-hooks` flags it): assign each `useStore` to its own `const` on its own line, then combine the VALUES |
| Never claim plan-data encryption-at-rest before Phase 5 | Copy must not conflate the two: the KEY is always keyVault-wrapped (passkey/PIN); plan DATA is plaintext at rest (`storeEncEnabled` off by default; default-on is Phase 5). Any copy touching at-rest posture states only that the key is protected and that this is **not a backup** |
| No plan-dependent write before the plan loads (5c) | A signed-in owner device writes no day event, monthly-log entry or plan edit, runs no month reconcile, and publishes no plan, journal, viewer snapshot or relay list until `planLoaded` — set only by an applied relay plan, a restored backup, minting the key, or the owner's confirmed "Start a new plan" after a pull found nothing (`planLoad.planMissing`: refused in the store, held at the publish). Never set `planLoaded` from a pull that found nothing, never sync it, never route a journal write or plan edit around the day-event mutators, `upsertLogEntry` / `deleteLogEntry` or `emitPlanSets`; clear it with any in-place reset of the plan. A failed plan load is recorded and said in plain words — never swallowed; logged by the error's name and the payload's size, never its contents |
| `strikeLtv` storage | Decimal; ×100 for display, ÷100 on save |
| Skip fields | Persisted + SYNCED via settings — reset only when user toggles back to Pay |
| `cbLiquidationPrice` | Synced (settings payload) with cbMonthlyPayment/cbPaymentStrategy/cbLtvTriggerPct/cbLtvTargetPct/cbRotateBackPct; 0 = not set — guard with a `liquidationPrice === 0` check before rendering the modeler |
| nostr-tools pin | EXACT 2.23.5; do NOT downgrade to 2.13 |
| The app restarts on a tap alone (BL51) | A new build is offered, never applied: `lib/appUpdate.ts`'s checks (started once, from `main.tsx`) only read `/version.json`; only `UpdateCard` and `UpdateCheck` call `applyUpdate`, and only its env (plus dev mode's DevPanel: reads it on opening, asks `update()` on its Refresh tap alone) reaches the service worker — no `update()` from anywhere else. The tap restarts the page only once the new worker is active, never while it installs. `registerSW({ immediate: true })` keeps its options (autoUpdate must restart the page when a new worker takes over). `version.json` stays out of the precache (`globPatterns` take no `.json`; `sw.ts` has no runtime route). Pins: `appUpdateWiring.test.ts` (ONE START, ONLY THE TAP, WORKER CALLS, STAMP FILE), `appUpdate.test.ts` (APPLY), `e2e/appUpdate.spec.ts` |
