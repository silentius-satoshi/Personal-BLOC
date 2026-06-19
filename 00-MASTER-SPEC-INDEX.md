# Personal ₿LOC — Master Spec Index

**Current shipped baseline: store **v16** · 218/218 tests · HEAD `76b8d03` (branch `main`).**
**Last rebuilt:** after the **security arc** (writer local-nsec signer → owner-pubkey gate → NIP-98 proxy auth) + the position-box relayout arc. Historical record of what shipped. **The security arc is now CONFIRMED on-device (iOS Face-ID local signer, owner-gate, NIP-98 all verified Jun 18).** The OPEN tail's live queue is now just the position-box eyeball + the queued viewer-access spec.

> **Reading this:** Most specs below are **SHIPPED** (committed to `main`). The few **OPEN** items are
> at the bottom. Spec files live in `/mnt/user-data/outputs/`. When a spec has multiple versions, the
> **highest version is authoritative** (lower versions are superseded drafts). Volatile facts (exact
> test count, exact synced-field list) should be verified in code/CLAUDE.md — they drift.

> **Store-version rule (for any future bump):** assign the next integer, write the migration additively
> (`field: persisted.field ?? default`), bump `version:` in `useStore.ts`, update CLAUDE.md in the
> SAME commit. **Note:** the entire arc below shipped at **v14 with NO bump** — every change either used
> existing fields, added *additive optional* entry fields, or was ephemeral/display-only — **until the writer local-nsec signer**, which bumped **v14 → v15** (additive device-local fields). The security arc after it (owner-gate, NIP-98) added no further bump.

---

## Current state (verify against code)

- **Store version:** `v15` (`useStore.ts` `version: 15`) — bumped at the writer local-nsec signer (was v14 through the position-box arc).
- **Tests:** `215` passing (`npm run build && npx vitest run`) — grew across the security arc (191 position-box era → 197 local signer → 201 owner-gate → 215 NIP-98). Volatile — verify in code.
- **Verify gate:** `npm run build` (= `tsc -b && vite build`) + `npx vitest run`. **`tsc --noEmit` is a
  NO-OP** (root tsconfig references-only).
- **Branch:** `main`. Repo: `github.com/silentius-satoshi/Personal-BLOC`.
- **Store-version history:** v7 (records start) → … → **v11** (collateral reality/sandbox) → **v12**
  (cb-reverse-rotation: `cbRotateBackPct`) → **v13** (dashboard freshness: `cbLoanBalanceAsOf`,
  `cbLiquidationPriceAsOf`, `strikeLiquidationLtvPct`) → **v14** (Monthly Playbook bar flags, device-local).

---

## SHIPPED — post-rebuild arc (newest; the work since the v14/188 index rebuild `dc4f286`)

Chronological (oldest → newest). All committed to `main`, all at store v14.

| Spec (highest version) | Commit | What it shipped |
|---|---|---|
| `safety-dashboard-cb-bar-fixes-spec-v1` | `49b29c1` | CB dashboard bar: **whole-card tap-to-anchor** (mirrors Strike card's whole-container tap; root `<button>`→`<div role=button>` to legally nest the editBox, keydown self-guard), marker **ticks** (75%/86%) + price moved to a `.priceNote` subtext (fixes right-end label collision), ONE calm `.anchorNudge` for never-anchored (was 3 amber warnings). Root cause of "nothing happens on tap" was discoverability, not a broken handler. |
| `strike-edit-and-position-boxes-spec-v1` | `e1eb6f3` | Strike card **view-aware inline edit** (capacity → BLOC balance + credit line; liquidation → BLOC balance + liq LTV %; own state, `stopPropagation`, synced setters). Removed the **redundant** Strike `LTV` line + the **entire CB LOAN column** from "This Month" (both shown by the dashboard bars; orphaned `currentStrikeLtv`/`cbStatus`/`classifyLtv` removed). **Two-box** layout (dropped the outer card to avoid card-in-card; 2-up grid, stacks <560px). |
| `remove-fold-cc-spec-v1` | `d7356d7` | **Removed Fold CC entirely** (user switched to a variable-rate Gemini card — unmodelable). Gone across 9 files: store `showFoldCC`/`foldRewardRate` (non-synced → no migration), sim `foldRate`/`foldBTCThisMonth`/`fbtc`/`comb` (combined stack collapses to `btc`), Settings toggle, Playbook Fold row, BtcStackChart "+ Fold CC" variant. Build is the orphan guard. |
| `morpho-rate-display-assist-spec-v1` | `487bfba` | **Morpho borrow-rate display-assist** (Settings). New `api/morpho-rate.js` (same-origin POST proxy → `api.morpho.org/graphql`, `s-maxage=300`), `useMorphoRate` + pure `parseMorphoRate`. Shows live cbBTC/USDC (Base) borrow APY as a **labeled read-only reference** beside the manual `cbAprPct` — NEVER overwrites (Coinbase may add a spread). +3 tests (→191). |
| `editable-bloc-draw-cb-payment-spec-v1` | `2f86be8` | **Editable BLOC draw + CB payment** in the log confirm sheet (mirrors BTC-bought/expenses); edits **authoritative over projection** — edited draw recomputes logged Strike balance/LTV (`loggedStrikeBal`), edited CB drives the re-anchor (`effectiveCbPayment`, per-mode seed `projectedCbAmount`). CB row **hidden in ltvTriggered until `cbLtvTriggered` fires**; labeled per mode ("CB payment"/"CB paydown"). |
| `morpho-rate-cb-editbox-spec-v1` | `83fefc1` | The same Morpho rate reference line added to the **SafetyDashboard CB anchor editBox** (the contextually-best second home — where the user reconciles against Coinbase). Reuses `useMorphoRate`; local `.editHint` class. |
| `confirm-sheet-interest-ndp-spec-v1` | `8337050` | **Interest/mo replaces Expenses** in the confirm sheet (the BLOC draw already = expenses, so logged `expensesActual` auto-set to the draw; **Settings `expenses` untouched**). Edited interest authoritative over the logged balance (`effectiveInterest`). Added an **editable NDP amount** beside the yearly checkbox (new additive optional `MonthlyLogEntry.ndpPaid`; records + stamps, does not reduce the balance). |
| `simple-mode-playbook-smartbloc-ux-spec-v1` | `b47e4fe` | **Simple Mode playbook ← Smart BLOC UX, reality-engine-backed.** Added the conditional **LoC Paydown row** (appears in scrubbed months where `paydown > 0`, fed by `expectedPaydown`/`selectedPlan.paydown` — the behavior that was missing), Smart BLOC's **% allocation** + "(after paydown)/(100% of income)" subtext, a **"Line of Credit" separator**, and a **paydown segment** on the INCOME ALLOCATION bar. STRIKE/COINBASE bars + Pay/Skip pills + "this month also" strip + logged states all kept. |
| `advisor-match-smartbloc-paydown-ceiling-spec-v1` | `bd6750d` | **The calculation fix.** `runAdvisor` now defends the 15% BLOC ceiling with **up to 100% of income** (`min(income, balance − target)`), matching `runBLOC` — removed the prior **30%-of-income paydown cap** in both strategy paths. This is why Simple Mode's STRIKE LTV now snaps back to ≤15% like Smart BLOC (was drifting above). Behavioral: high-LTV months divert more income to paydown, less to BTC. Repurposed a now-invalid `cbLtvTrigger` assertion into a **ceiling-defense check** (`blocLtv ≤ 0.151`). |
| `simple-mode-playbook-polish-spec-v1` | `edc0fcc` | **The styling polish** (matches Smart BLOC's restraint). Single inline header ("Month X of 12 · [state] · LTV Z% — paydown triggered", coral when `hasPaydown`, de-boxed state badge + BTC price right); **two-tone scrubber** fill (red paydown / green rest, keyed to `barPaydownPct`) + **M1–M12 tick markers**; dot-row **`%` moved above the amount**; **red Interest** amount; calmer rows (8px dots, `--text-secondary` labels, lighter dividers, weight-600). 3 bars + pills + state badge kept. |
| `playbook-remove-income-bar-header-restructure-spec-v1` | `caa614d` | **Polish the polish.** Removed the now-**redundant INCOME ALLOCATION bar** (the two-tone scrubber already encodes the per-month paydown/buy split; its "$X / $X ✓" is always true in projected months + still surfaced in the confirm sheet for the current month) + its dead Settings toggle (store field `showPlanIncomeBar` kept — vestigial, `planBars.test.ts` asserts it). Header restructured to **two lines**: Month + state badge on top; LTV/paydown-flag + BTC price on their own `.scrubMeta` line above the scrubber. STRIKE/COINBASE bars + scrubber (`barPaydownPct`) unchanged. |
| `position-boxes-polish-spec-v1` | `a99b0cd` | **Position-box rebalance.** STRIKE BLOC (overloaded) de-noised + THIS MONTH (~80% empty) filled: removed "fully backed above $X" (kept only the amber collateral-limited line), gated the CB-buffer line on `> $0`, restructured the cramped "after this month" run-on into a clean labeled `.eomProjection` block (balance · LTV · ₿), **relocated the NDP reminder to THIS MONTH** gated on `ndp.status !== 'ok'` (hidden when paid/far-off, resurfaces when close), and moved the Pay/Skip pills **before** the amount (`flex:1` label pins the amount right → no x-shift across current/projected/logged). |
| `position-boxes-clarity-pass-spec-v1` | `f6ff5c6` | **Position-box clarity pass** (6 changes). Safety status moved to the **top of SafetyDashboard** as its prominent headline (render-position + style only; derivation unchanged). Removed the redundant **dot-pips "Month X of 12" progress row** (scrubber shows position). THIS MONTH: mislabeled redundant **"Cash:" folded into the ₿ line** as a `~$` cost sub-label (the value was the income→BTC budget, not cash). Both position blocks: **"credit line used: $X · Y% LTV"** (STRIKE retitled "CURRENT STRIKE BLOC", current LTV via `currentBlocLtv = computeStrikeLtv(...)` — matches the Strike bar) + **"collateral: ₿ X · $Y"** with live USD (₿ × `btcPrice`, both at flat live price = `eomLtv`'s basis). Projection ₿ un-faded. |
| `position-three-box-layout-spec-v1` | `eb6be60` | **Position area → three boxes in a row.** The two-box layout was lopsided (left crammed CURRENT + the AFTER `.eomProjection` + Avail/conditionals → "credit line used · LTV" wrapped; THIS MONTH ~85% empty). Split into **three equal boxes**, reordered to the narrative — **CURRENT STRIKE BLOC → THIS MONTH → AFTER THIS MONTH** (now → action → projected). `.eomProjection` retired (`.eom*` CSS removed) → AFTER promoted to a peer box; Avail + CB-buffer/collateral/rotation conditionals stayed in CURRENT. `.positionRow` grid → 3 cols, stacks to 1 at ≤760px; equal heights via grid `stretch`. |
| `position-boxes-final-relayout-spec-v1` | *(pending push)* | **Final relayout.** Three-box split still wrapped at ⅓ width → dropped the inline "credit line used:"/"collateral:" labels (titles carry the meaning), reordered **asset-first**, parens format (`₿ X ($Y)` / `$bal (Z% LTV)`) → each line fits one row. THIS MONTH filled with a **Draw** line beside **Buy** (both labeled, Buy ₿-only, "(proj)" in the title). **Fixed a latent bug:** `availCredit` is eom-based → moved to AFTER; CURRENT got `currentAvail = strikeAvailableCredit(creditLine, currentBtcHeld, btcPrice, advisorActualBlocBalance)` — each box's Avail matches its own basis. `.usedLabel` retired. |
| `position-three-box-layout-spec-v1` | `eb6be60` | **Position area → 3 boxes in a row** (CURRENT STRIKE BLOC → THIS MONTH → AFTER THIS MONTH). The two-box layout crammed CURRENT + the AFTER `.eomProjection` + Avail into the left box (wrapping) while THIS MONTH sat empty. `.eomProjection` retired → AFTER promoted to a peer box; `.positionRow` grid → 3 cols, stacks to 1 at ≤760px; equal heights via grid `stretch`. |
| `position-boxes-final-relayout-spec-v1` | `72db3a7` | **Final relayout.** Dropped the inline "credit line used:"/"collateral:" labels (titles carry meaning → fixes ⅓-width wrapping), reordered **asset-first**, parens format (`₿ X ($Y)` / `$bal (Z% LTV)`). THIS MONTH filled with a **Draw** line beside **Buy** (Buy ₿-only, "(proj)" in title). **Fixed a latent bug:** `availCredit` is eom-based → moved to AFTER; CURRENT got a new `currentAvail = strikeAvailableCredit(creditLine, currentBtcHeld, btcPrice, advisorActualBlocBalance)` — each box's Avail matches its own basis. `.usedLabel` retired. |
| --- SECURITY ARC (Nostr Steps 4 + perimeter) --- | | |
| `writer-local-nsec-signer-spec-v1` | `f3ded52` | **🔑 Nostr Step 4 · writer encrypted local-nsec signer (iOS-only, Face ID).** A third auth option beside NIP-07/NIP-46 — gives iOS one-tap reliability without the NIP-46 deeplink race. Built on a new **identity-agnostic `keyVault`** (PRF/Face-ID primary, PIN fallback; PBKDF2→HKDF→AES-GCM via WebCrypto; unwrapped key in memory only) — the queued viewer-access Phase 3 will reuse it. **Hard backup gate** (the device copy is convenience-only, structurally unreachable until "I have my nsec backed up" is checked). `LocalUnlockGate` = the "authenticated-but-locked" relaunch screen; `useNostrAutoRestore` skips optimistic auth for `'local'` (Face ID needs a gesture). `restoreSigner` `'local'` branch unwraps → `NSecSigner` → pubkey-match → `sk.fill(0)`. Device-local never-synced `writerKeyWrapped`/`writerKeyWrapMeta`; `nostrSigningMethod` gains `'local'`. **Store v14 → v15.** `NSecSigner` is a drop-in signer → publish path unchanged. |
| `owner-pubkey-gating-spec-v1` | `7993215` | **🔒 Owner-pubkey gate.** App render + Strike fetch gated on `isAuthenticated && nostrPubkey === VITE_OWNER_PUBKEY` (pure `isOwnerPubkey` helper, **unset-env → no lockout** fallback). Closes two gaps: (1) `useStrikeData` was fetching **unconditionally** before the auth gate (un-authenticated visitors triggered `/api/strike-balances`) → now `useStrikeData(enabled)`, owner-only; (2) any valid nsec got in → a foreign key now sees `PrivateAppNotice`, not the dashboards. **Viewer carve-out documented-not-built:** the viewer spec adds `\|\| viewerMode` + delivers viewer Strike via the encrypted snapshot (Option B). Store v15 (no bump). |
| `nip98-proxy-auth-spec-v1` | `60ac02f` | **🔐 NIP-98 proxy auth — no more bundle secret.** `VITE_APP_PROXY_SECRET` was embedded in the deployed bundle (extractable → anyone could `curl` the Strike proxy). Replaced with **NIP-98**: the Strike proxies require a Nostr-signed kind-27235 request, verified server-side (kind/ts/url/method + schnorr `verifyEvent`) and matched against `OWNER_PUBKEY` (server hex env) — 401 (no/bad/expired) / 403 (valid sig, non-owner key). Bundle now holds **no secret**. Client signs via a **~50s token cache** (`proxyAuth.ts`) so NIP-46 doesn't round-trip per 60s poll (local/NIP-07 instant). `api/_lib/ownerAuth.js` = the unit-tested validation (handles both `validateToken`'s false-return AND throw). **All three proxies gated** (balances + rates + **invoices** — parity, same removed secret). New env: `OWNER_PUBKEY` + `PUBLIC_ORIGIN` (server; the latter = exact deploy origin for the `u`-tag match, trailing-slash-sensitive); `APP_PROXY_SECRET`/`VITE_APP_PROXY_SECRET` **removed**. Store v15. |
| --- SECURITY ARC: on-device fixes (iOS local-signer debugging) --- | | |
| (fix) PRF eval ArrayBuffer | `c33af01` | iOS Safari `navigator.credentials.create()` threw a bare `TypeError` because the WebAuthn PRF `eval.first` was passed as a base64url **string** — must be an **ArrayBuffer**. Fixed both PRF call sites in `keyVault.ts`. (Also surfaced: Proton Pass passkeys lack PRF support → use **iCloud Keychain**, which has it; PIN fallback remains for non-PRF providers.) |
| (fix) NSecSigner key copy | `5522326` | **The real local-signer bug.** `new NSecSigner(sk)` holds a **reference** to the `Uint8Array`, not a copy — so the best-effort `sk.fill(0)` zeroing **corrupted the live signer's key** → 32 zero bytes → `invalid scalar: out of range` on every NIP-44 decrypt/sign. Fixed both sites (`NostrAuthGate.tsx`, `session.ts`) with `new NSecSigner(sk.slice())`; `sk.fill(0)` now clears only the local plaintext. **This is why the local signer appeared to work (correct pubkey) but couldn't decrypt.** Confirmed empirically + on-device (`signer probe: OK`). |
| --- SIMPLE MODE ACCURACY + POLISH ARC (CB LTV-trigger fidelity) --- | | |
| `simplemode-ltv-triggered-draw-fix` | `15232e4` | **Current-month draw halving fixed.** Simple Mode's current month applied CB-tier draw rules (halve at tier 2 / zero at tier 1) even in **LTV-Triggered** mode, where the engine suspends them — producing a phantom halved draw + "Cover from savings" at CB LTV ≥ 65% though the 75% trigger hadn't fired. Branched `expectedBlocDraw`/`expectedBtcBuying` on `isLtvTriggered`, mirroring `runAdvisor` (full draw, income-funded BTC). Monthly-mode tier logic intact. Display-only. |
| `start-of-month-balance-split` | `06adf6f` | **`advisorActualBlocBalance` was overloaded** — live-drawn AND the projection's start-of-month base. Mid-month the AFTER box stacked the full month draw on the live balance (~$6,250 vs the true ~$3,750+interest). Added `advisorMonthStartBalance` (settable, syncs) feeding ONLY `deriveAdvisorStart`'s month-1 base; `advisorActualBlocBalance` stays live-drawn everywhere. THIS MONTH shows remaining draw (`plan − (live − start)`); AFTER = start + full draw + interest = true eom. Forward-compatible with the parked 12-month cycle rollover (Gap B). **Store v15→v16.** |
| `cb-buffer-relocate-runway` | `d297241` | **CB buffer relocated + reframed.** Was in CURRENT STRIKE BLOC (a CB metric under a Strike heading) keyed to the 65% target while the engine acts at 75%. Moved to THIS MONTH behind a divider, banded: < 75% → "CB runway" (headroom to trigger), ≥ 75% → "CB paydown" (the engine's draw). |
| `position-box-polish` (×2) | `7acdbe7`, `fc3cf24` | **Display polish:** orange ₿ amount + USD parenthetical as ghost subtext (CURRENT/AFTER); dropped the "collateral-limited" line; CB runway shown as % gap to trigger; debt-line LTV paren also → subtext; **Monthly Playbook** header prefix + current→eom LTV transition on the Strike/CB bars (e.g. "5.0% → 7.2% LTV"). |
| `cb-bar-liquidation-price-fix` | `5138c59` | **CB bars now reflect the authoritative liquidation price.** Both CB bars (SafetyDashboard + playbook) divided LTV by the static `CB_LLTV` (86%), ignoring the user-set liquidation price (which captures interest/oracle/buffers). Derived `cbLiqFrac = balance/(collateral×liqPrice)` as the fill/marker/level denominator (fallback `CB_LLTV`); SafetyDashboard uses `accruedBalance` basis so the no-price case is an exact `CB_LLTV` no-op. Display-only. |
| `safetydashboard-cushion-ltv-gaps` | `6d2bd87` | **SafetyDashboard CB cushions → LTV-point gaps.** "↓X% to trigger · ↓Y% to liquidation" were BTC price-drop %; changed to LTV-point gaps (`trigger% − LTV`, `cbLiqFrac − LTV`) to match the playbook "CB runway" and the user's LTV-headroom mental model. Price view stays in the priceNote. Display-only. |
| --- VIEWER ACCESS (read-only sharing for dad) --- | | |
| `viewer-access-spec-v2` Phase 1 | `76b8d03` | **🔭 Writer-side encrypted snapshot.** When the owner publishes settings/records, ALSO publishes one combined `viewer:v1` event (kind 30078, `d=personal-bloc:viewer:v1`) sealed to a configured viewer pubkey via `publishEncrypted` — settings + records + **live Strike balances (Option B)**. Fire-and-forget, gated on `viewerPubkey`, **log-only on failure, never touches the owner's dirty/reconnect/sync state** (zero-risk). Extracted `buildSettingsPayload` (single source — settings:v1 + the snapshot can't drift). New device-local NEVER-synced `viewerNpub`/`viewerPubkey` (mirror `writerKeyWrapped`). VIEWER ACCESS UI in Settings (npub validate + Remove/revoke). Store v16 (additive, no bump). 3 invariant tests (viewer fields absent from the synced payload). **Phase 2 (viewer read client) / Phase 3 (passkey-gated key) not yet built.** |

---

## SHIPPED — the Simple Mode redesign arc (prior; through the v14/188 rebuild)

### Foundation & engine
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `btc-price-live-sync-spec-v1` | ±`btcPriceMode` | Live Coinbase spot (`useBtcPrice`), live/manual mode. Foundational. |
| `cb-paydown-cap-spec-v1` | none (row fields) | Caps the ltvTriggered CB paydown; adds `cbPaydownCapped`/`cbPaydownShortfall` to `AdvisorMonthRow`. |
| `cb-reverse-rotation-spec-v2` | **v12** | **The substantive engine bug.** Added the missing `cbRotateBackPct`, keyed reverse rotation off it (band `rotate-back 55 < target 65 < trigger 75`). v1 superseded. |

### Collateral model (reality/sandbox)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `collateral-reality-sandbox-spec-v4` | v11-era | Dated collateral adjustments, pending/graduation, reality-vs-sandbox split, delete-recompute. `advisorActualBtcHeld` = frozen month-0 baseline; `getCurrentBtcHeld()` = baseline + logged + pending. v1–v3 superseded. |
| `initial-btc-collateral-display-spec-v1` | none | Settings shows read-only "Initial BTC collateral" (baseline) above "Current BTC collateral" + green "since start" delta. |

### Monthly log + workflow
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `monthly-log-spec-v1` | — | Monthly log foundation (merged-commit loop, `MonthlyLogEntry`). |
| `simple-mode-workflow-spec-v2` | — | Simple Mode operating workflow (§2–§9 shipped). v1 superseded. |
| `editable-btc-bought-log-spec-v1` | none | "Log this month" confirm sheet's BTC-bought figure editable (was hardwired projection). |
| `simple-mode-checklist-removal-spec-v1` | — | Removed the old checklist UI. |

### Outlook projection
| Spec | Store | What it shipped |
|---|---|---|
| `outlook-cb-quiet-triggered-spec-v1` | none | Option A — quiet CB columns in ltvTriggered (muted non-trigger months, amber fired month). |
| `outlook-projection-legend-spec-v1` | none | Symbol/tier legend beneath the projection table (shared Advisor tab + Simple Mode Outlook). |

### Strike-BTC trio (initial / current / dry-powder)
| Spec | Store | What it shipped |
|---|---|---|
| `strike-btc-dry-powder-fetch-spec-v1` | none | Fetch Strike spendable BTC (`available`) — display-only "dry powder," never in LTV math. Settings row. |
| `strike-dry-powder-inputspanel-widget-spec-v1` | none | (superseded) inline dry-powder line in the USD widget. |
| `strike-two-widgets-usd-drypowder-spec-v1` | none | Split into two parallel sidebar widgets: STRIKE USD HOLDINGS + STRIKE BTC DRY POWDER. |

### Safety dashboard (Spec B) + Monthly Playbook (the big restyle)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `simple-mode-dashboard-bars-spec-v3` | **v13** | **Safety Dashboard** (CB + Strike LTV bars, Safe/Watch/Act), shared `cbMetrics` helper (unified CB-tab + Sidebar + LiqSim authority), balance/liq-price freshness. v1/v2 superseded. |
| `monthly-playbook-restyle-spec-v1` | **v14** | **The Monthly Playbook.** Month scrubber (replaces carousel), colored-dot 3-row layout, 3 stacked bars, skip-aware **projection-vs-reality split**, summary paragraph. New pure `simpleModePlan.ts`. |
| `monthly-playbook-followups-spec-v1` | none | Current-actuals headline (was EoM projection), logged-current edit affordance, **decoupled Strike dashboard bar from `hasCbLoan`**, shared `computeStrikeLtv`. |

### MonthlyLogOverlay (edit-modal fixes)
| Spec | Store | What it shipped |
|---|---|---|
| `monthly-log-overlay-fixes-spec-v1` | none | Off-by-one, centered modal, header/arrows inside the card, `openInEditMode`. |
| `monthly-log-overlay-nesting-fix-spec-v1` | none | Collapsed a modal-in-modal regression + single-column form. |
| (inline fix, no spec file) | none | Transparent-modal fix: `.modalCard` `--bg-base` → `--bg-card`. |

### Price chart (Spec C)
| Spec (highest version) | Store | What it shipped |
|---|---|---|
| `simple-mode-price-chart-spec-v2` | none | BTC price chart: Coinbase candles via `api/btc-candles.js` proxy, 1H/1D/1W toggle, recharts AreaChart, `useBtcHistory` + pure `parseCandles`. v1 superseded. ⚠ live data only on a Vercel deploy. |

### Housekeeping
| Spec | Store | What it shipped |
|---|---|---|
| `bg-base-token-fix-spec-v1` | none | Defined the missing `--bg-base: #09090E` (referenced 25×, undefined → transparent). |
| `cleanup-bundle-spec-v1` | — | (historical) bundled cleanup. |
| `remove-pull-to-refresh-spec-v1` | — | Removed pull-to-refresh. |

### Nostr (sync stack — shipped earliest, stable)
| Specs | What it shipped |
|---|---|
| `nostr-live-sync`, `nostr-merge-sync`, `nostr-sync-integrity`, `nostr-sync-reliability`, `nostr-cleanup-consolidation`, `nostr-nip46-session-persistence` (all `-spec-v1`) | NIP-46 auth (Primal), per-month merge with tombstones, `mergeRecords`/`syncNow`, transport hardening (`ExponentialBackoff`), session persistence. Stack: `@nostrify/react ^0.6.2` + `@nostrify/nostrify ^0.52.2`, `nostr-tools` exact `2.23.5`, `websocket-ts@2.3.0`. |

---

## OPEN — remaining tail

| Item | Type | Notes |
|---|---|---|
| **Deploy verification — 3 fetch features** | smoke | The `api/` serverless proxies run only on a **Vercel preview/prod deploy**, NOT under `npm run dev`. Verify on deploy: (1) **price chart** candles render; (2+3) the **Morpho rate** line reads a plausible single-digit % in BOTH the Settings APR field and the CB anchor editBox — confirm the fraction→percent ×100 coercion (not 612% or 0.06%); `cbAprPct` never auto-changes. Locally all three correctly show their "unavailable" state. |
| **Two-engine parity eyeball** | smoke | After the paydown-ceiling fix, confirm with matching inputs that Simple Mode's STRIKE LTV trajectory + paydown timing now **track Smart BLOC's** (the prior divergence was the 30% cap). |
| **Playbook side-by-side eyeball** | smoke | Polish + income-bar removal shipped (HEAD `caa614d`). Confirm the two playbooks read as **siblings** side-by-side, and the two-tone scrubber thumb **drags on iOS** (native range-input cross-browser check). |
| **Vercel env changes (security arc)** | ✅ DONE (Jun 18) | `VITE_APP_PROXY_SECRET`+`APP_PROXY_SECRET` removed; `OWNER_PUBKEY` + `PUBLIC_ORIGIN` (= `https://personal-bloc.vercel.app`) set. Confirmed live (401s + Strike render prove it). |
| **iOS local signer (Step 4)** | ✅ DONE (Jun 18) | Verified on iCloud-Keychain PRF: paste nsec → Face ID → `signer probe: OK 21ms`, `sync ok`; **reload → unlock screen → Face ID → data loads**; backup gate blocks unchecked; foreign nsec → private notice. (Two bugs fixed en route — PRF-string `c33af01`, signer-key-copy `5522326`.) |
| **Owner-gate** | ✅ DONE (Jun 18) | Owner → full app + live Strike; foreign nsec → "private app" notice (confirmed on-device). |
| **NIP-98 proxy** | ✅ DONE (Jun 18) | Owner → live Strike renders (happy path = the on-device `sync ok`); `curl` no token AND garbage token → **401** `{"error":"Unauthorized"}`; `PUBLIC_ORIGIN` correct (no per-fetch 401s). 403-for-different-key not hand-tested (covered by the foreign-nsec lockout + unit tests w/ real schnorr). |
| **Position-box arc (eyeball)** | deploy/device | Three boxes read as siblings, no ⅓-width wrapping, clean 3→1 stack at ≤760px; **CURRENT vs AFTER Avail are different numbers** (the eom-vs-current bugfix); live price ticks both collateral USDs together; LTVs match the dashboard bars; pill alignment holds across scrub; NDP hidden at far-off `ok`. |
| **iOS local-key NIP-46 signer** | parked (MAX) | Standing rec; transient iOS deeplink races. Not blocking. |
| **Viewer-access Phase 2 (viewer read client)** | queued (MAX) | Spec v2 at `/mnt/user-data/outputs/viewer-access-spec-v2.md`. **Phase 1 shipped (`76b8d03`).** Phase 2 = the read-only viewer: first-run Writer/Viewer choice, generate the viewer key (`NSecSigner(sk.slice())` — the signer-copy lesson applies), follow the owner pubkey, `fetchViewerSnapshot` + live sub, hydrate read-only (incl. Strike from the snapshot), and **add `|| viewerMode` to the owner-gate** so the viewer passes into read-only render. Store 16→17. Phase 3 = passkey-gated viewer key (reuses `keyVault.ts`), 17→18. Original notes: **Two amendments from the security arc to fold in when built:** (a) the owner-gate's non-owner branch becomes `isAuthenticated && !isOwner && !viewerMode` (a provisioned viewer passes into read-only render); (b) the `ViewerSnapshot` + `publishViewerSnapshotNow` carry `strikeUsdBalance`/`strikeBtcAvailable` and the viewer hydrate path renders them read-only (**Option B** — dad sees live Strike via the encrypted snapshot, NEVER fetches the proxy; the owner-only fetch gate + NIP-98 403-for-non-owner is correct as-is). **Reuses the now-shipped `keyVault.ts`.** Phases renumber **15→16→17** (the writer local signer took the 14→15 slot the spec assumed). The natural next feature. |
| **Mining tab integration** | parked (MAX) | Spec produced earlier, iterating; outside this arc. |
| **`--bg-base` semantic consolidation** | optional cosmetic | Token defined (bug fixed). A future pass *could* alias backgrounds → `--bg-app`; no functional gain. |

---

## Key invariants (for future work)

- **`advisorActualBtcHeld`** = frozen month-0 baseline (never back-solved). **`getCurrentBtcHeld()`** =
  baseline + logged buys + pending (the "reality read"). Use the latter for current-state displays.
- **`cbMetrics` / `accruedCbBalance` / `computeStrikeLtv`** are the shared single-source helpers — CB
  LTV / liq-price / Strike LTV route through them so dashboard / CB tab / Liq Sim / headline can't
  disagree.
- **`simpleModePlan.ts`** (`deriveForMonth` / `isOperatingMonth` / `composeMonthSummary`): the
  projection-vs-reality split. Current month = skip-adjusted reality; other months = clean projection;
  logged = actuals. **`deriveForMonth.paydown`** is the income→BLOC paydown the playbook's LoC Paydown
  row renders (current month uses `expectedPaydown`).
- **`runAdvisor` defends the 15% BLOC ceiling with up to 100% of income** (`min(income, balance − target)`,
  `blocLtvCeiling = 0.15`) — matches `runBLOC.ts`. (The old 30%-of-income cap was the source of the
  Simple-Mode-vs-Smart-BLOC divergence.)
- **The `effective*` override pattern** (confirm sheet): `customX ?? projected` for the BLOC draw
  (`effectiveDrawAmount`), CB payment (`effectiveCbPayment`, per-mode seed), and interest
  (`effectiveInterest`). Un-edited always = the projection; an edit is authoritative over the logged
  entry / re-anchor. `expensesActual` is auto-set to the BLOC draw (Settings `expenses` is the
  independent projection assumption — NOT touched by the per-entry actual).
- **`MonthlyLogEntry` optional fields** travel through the records-sync merge with no migration:
  `cbBal?`, `collateralAdjustment?`, **`ndpPaid?`** (additive pattern — add new per-entry data this way,
  never a store bump).
- **Device-local (NOT synced)** flags: `devMode`, `expenseReanchorDismissedAt`, `showPlanIncomeBar`/
  `showPlanStrikeBar`/`showPlanCbBar`. Keep OUT of `SETTINGS_FIELDS`/payload (persist via `...rest`).
- **Strike API:** payments/trading only — balances endpoint exposes NO collateral/pledged field, no
  BLOC/loan endpoints, and **no lending APR endpoint** (`api/strike-rates.js` fetches the BTC↔USD
  exchange-rate ticker, NOT the borrow APR). The BLOC APR is variable (US Prime + margin, ≤quarterly) +
  account-specific → stays a **manual input** (`blocApr`).
- **Morpho rate (display-assist):** the "Coinbase loan" is an on-chain-confirmed cbBTC/USDC, 86%-LLTV
  position in **Base market `0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836`**
  (chainId 8453). Live borrow APY via `api.morpho.org/graphql` `marketById(...).state.borrowApy` through
  the `api/morpho-rate` proxy. **Schema quirk:** this endpoint's `Market` type uses **`marketId`, NOT
  `uniqueKey`**. Shown as a **labeled reference only** (Settings APR field + CB editBox) — NEVER
  overwrites the manual `cbAprPct` (Coinbase may add a spread; user observed ~4.89% Morpho vs ~5.15%
  Coinbase). `borrowApy` is a decimal fraction (×100 for %).
- **Coinbase:** spot via `api.coinbase.com` (`useBtcPrice`, direct — CORS-OK); candles via
  `api.exchange.coinbase.com` through the **`api/btc-candles` same-origin proxy**. **All `api/`
  functions run only on a Vercel deploy, NOT `npm run dev`.**
- **Power Law** `1.16e-17 × days^5.82`. **Morpho** liquidates instantly at 86% LLTV (no grace), LIF ≈
  1.04384. **Strike** 65% warning / 70% margin call / 85% partial liquidation (72h window).
- **Tokens:** `--bg-app` #09090E, `--bg-base` #09090E, `--bg-card` #111318, `--bg-input` #0D0E14,
  `--bg-hover` #13141F.
