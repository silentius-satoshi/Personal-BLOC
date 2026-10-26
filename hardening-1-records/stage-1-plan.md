# Hardening 1 — Stage 1 plan (wrapped early: the owner's budget stop)

- **Base:** `c7f709eff95612dc75537e356ba5219d808dab02` (= `origin/batch-1`, c7f709e) · **branch:** `claude/hardening-1` (created at the base; nothing committed, nothing pushed) · spec v1.2 saved verbatim at `Claude outputs/hardening-1/spec.md`.
- **Stage 1 ran 2026-10-25 21:06Z – 2026-10-26 (UTC).** At 23:48Z the owner cut the budget (≈ $90 left): running agents finished, no new mutant, audit area or docs checker started; only the survivors and findings already in hand were verified (lean verifiers, effort medium).
- **Tools:** Node 22.22.0 and Node 26.12.0 (`/opt/node26`) both present; Playwright 1.61.1 with Chromium 1228 present — nothing moved to the Mac.

## 0. What the budget stop skipped

| Item | Planned (spec) | Done | Skipped |
|---|---|---|---|
| Mutants | cap 160 (HS 50, HE 40, HJ 30, HY 20, HK 20) | 149 planned, 143 run | 6 planned but never run (HK-15…HK-20); 11 of the cap never planned |
| Hunt verification | 5 verifiers, every survivor + 3 kill spot-checks each | survivors classified by 5 lean verifiers | the 15 kill spot-checks (the harness smoke test reproduced a T1 kill instead) |
| Audit areas | A1–A6 (8 auditors, 1 judge, 6 verifiers) | A1 (both lenses), A2, A4, A5, A6 audited; verified by 4 lean verifiers (A1's judge folded into its verifier) | **A3 — sync, keys, backups, viewers, privacy — not audited** (both lenses stopped within minutes of starting, nothing written) |
| Docs check (K5-A) | 14 checkers, 4 verifiers, a completeness pass | 5 checkers: `almanac.md` 1–2500, `file-structure.md` 1–1506; 1 verifier | 9 checkers: `file-structure.md` 1507–2310, `test-suite.md` (2,102 lines), `engines.md` (766), `daily-mode.md` (584), `journal.md` (455), `build-deploy.md` (402), `CLAUDE.md` (70) and the eight rules files (147 rows) — **5,474 of the 9,480 K5-A lines unchecked**; the completeness pass |
| Stages 2 and 3 | — | not started | everything (no test, gate item, e2e or docs line written) |

## 1. The base gate (once, at c7f709e, on this VM)

| Step | Result | Spec's figure at c7f709e |
|---|---|---|
| `npm run lint` | 0 problems (18 s) | 0 |
| `VERCEL_GIT_COMMIT_SHA=local npm run build` | ok — precache **14 entries, 2,174.56 KiB** (Node 22; 44 s) | 14 entries, 2,174.57 KiB (2,174.56 on Node 22) |
| `npx vitest run` — Node 22.22.0 | **2,914 passed + 6 skipped, 190 files** (189 + 1 skipped), 71 s | 2,914 + 6, 190 |
| `npx vitest run` — Node 26.12.0 | **2,914 passed + 6 skipped, 190 files**, 77 s | same |
| `npm run e2e` | **114 passed + 1 flaky (passed on its retry) + 2 skipped** (117), 6.8 min | 115 passed + 2 skipped, no retries |

**The flake is new** (§9 names only controlDock's LAYOUT 1023): `e2e/numberFieldSwipe.spec.ts:97` HELD — first attempt failed at L107 (`expect(drawn).toHaveValue('20000')`: "element(s) not found" for the Amount Drawn input after the "Strike Strategy" tap), the retry passed. The session re-ran it in isolation (both slots held, nothing on 5173): the test alone 0/2; the file with `--repeat-each=3` HELD 0/3, the other three 9/9; the file once 4/4. So it fails in isolation — by the config's own comment a bug, not a retry. A6 audited its root cause (§3). The gate otherwise green; the kill criterion was not met (Playwright exits 0 and every test passed, one on its retry) — the owner's call whether that counts as green.

## 2. The hunt

**How it ran.** A deterministic harness (`/tmp/hardening-1/bin/hunt.mjs`, outside the repo) planted each mutant as one exact edit (find occurs once, the file still parses), in a scratch worktree per target (`/tmp/hardening-1/hunt-<T>`, its own `npm ci`), and ran **four tiers**, stopping at the first red: **T1** the module's own tests; **T2** `vitest related <file> --run --bail=1` (the spec's two tiers); then, beyond the spec, **T3** every source-reading test (readFileSync/readdirSync — 48 files; `related` can't see a test that reads source as text) and **TSC** `tsc -b` (a mutant that only breaks the type check is a gate kill). Every run held one of two shared test slots (flock). Each file was restored from its copy and md5-checked against `git show <base>:<file>`: **all 143 planted mutants restored byte for byte**; all five worktrees `git status` clean afterwards. Smoke test before the hunt: the two §5.1 gaps survived all four tiers at the base (T2 ran 1,735 / 1,684 tests), a control mutant died in T1 in 1.3 s.

| Target | Planned / cap | Run | Killed (T1 · T2 · T3 · TSC) | Survived | Never run | Outside the listed files | Seconds |
|---|---|---|---|---|---|---|---|
| **HS** Safety, the viewer's figures, the plan card's words | 43 / 50 | 43 | 11 (10 · 1 · 0 · 0) | 32 | 0 | 13 | 4556 |
| **HE** the engine's older rules | 40 / 40 | 40 | 19 (16 · 3 · 0 · 0) | 21 | 0 | 9 | 2714 |
| **HJ** the journal's money | 26 / 30 | 26 | 2 (1 · 1 · 0 · 0) | 24 | 0 | 6 | 3012 |
| **HY** sync and the plan | 20 / 20 | 20 | 3 (3 · 0 · 0 · 0) | 17 | 0 | 8 | 2157 |
| **HK** keys, backups, viewers | 20 / 20 | 14 | 1 (1 · 0 · 0 · 0) | 13 | 6 | 15 | 1236 |
| **All** | 149 / 160 | 143 | 36 | 107 | 6 | — | 13675 (2 lanes, 21:53–23:50Z) |

The survival rate is high by design: the planners were told to aim at what no test pins (spec §5.1: "the hunt aims at the edges, not the core"), and several planted modules have no importing test at all (T2 ran 0 tests: e.g. the crypto worker, some .tsx components planted "outside the list" to reach a rule row). A survivor is a candidate, not a gap — §2.2 classifies each.

### 2.1 Mutants per rule file

| Rules file / doc | Mutants | Killed | Survived |
|---|---|---|---|
| .claude/rules/engine.md | 43 | 23 | 20 |
| .claude/rules/identity.md | 15 | 0 | 9 |
| .claude/rules/store.md | 14 | 1 | 13 |
| .claude/rules/sync.md | 14 | 3 | 11 |
| docs/claude/almanac.md | 9 | 2 | 7 |
| .claude/rules/ui.md | 9 | 3 | 6 |
| docs/claude/engines.md | 7 | 1 | 6 |
| .claude/rules/journal.md | 7 | 1 | 6 |
| docs/claude/journal.md | 7 | 1 | 6 |
| docs/claude/viewer.md | 6 | 0 | 6 |
| docs/claude/file-structure.md | 5 | 0 | 5 |
| .claude/rules/general.md | 5 | 1 | 4 |
| boundary (no rule row) | 4 | 0 | 4 |
| docs/claude/daily-mode.md | 3 | 0 | 3 |
| docs/claude/ui.md | 1 | 0 | 1 |

### 2.2 Every survivor, classified

**HS — Safety, the viewer's figures, the plan card's words** (32 survivors)

| Id | Class | Rule | Mutant: file:line — the bug | Base → mutant (or why) | New test file |
|---|---|---|---|---|---|
| HS-01 | GAP | engine.md — `STRIKE_MAX_DRAW_LTV` (spec §5.1 GA… | simulation/strikeCredit.ts:41 — fullyBackedPrice on Strike's 65% cure line instead of its 50% draw line… | 80000 → 61538.46 | strikeCreditHardening.test.ts |
| HS-02 | GAP | engines.md § `cbMetrics.ts` — shared CB LTV / l… | simulation/cbMetrics.ts:73 — accruedCbBalance's clamp dropped: a future as-of date (a reading dated … | 10000 → ≈7 | cbMetricsHardening.test.ts |
| HS-03 | GAP | boundary: accruedCbLiquidationPrice never ages … | simulation/cbMetrics.ts:84 — the entered liquidation price's clamp dropped: a future as-of LOWERS Sa… | 50000 → 36.51112072163979 | cbMetricsHardening.test.ts |
| HS-04 | GAP | engines.md § `cbMetrics.ts` — accruedCbLiquidat… | simulation/safetyView.ts:215 — an entered liquidation price with no as-of of its own is aged from the … | 50000 → 54260.28862645176 | safetyViewHardening.test.ts |
| HS-05 | GAP | viewer.md § Viewer V2 — C-trusted = real figure… | simulation/safetyView.ts:410 — the trusted viewer's Coinbase '$B balance' prints the balance as entere… | 108520.57725290352 → 100000 | safetyViewHardening.test.ts |
| HS-06 | GAP | viewer.md § Viewer V2 — the trusted Strike "Liq… | simulation/safetyView.ts:396 — the trusted viewer's Strike 'Liq at ~$P' divides by the liquidation LTV… | 58823.529411764706 → 588.2352941176471 | safetyViewHardening.test.ts |
| HS-07 | GAP | boundary: the trusted path's strikeDropPct clam… | simulation/safetyView.ts:391 — past Strike's liquidation LTV the trusted viewer's drop% goes negative … | 0 → -0.17647058823529416 | safetyViewHardening.test.ts |
| HS-08 | GAP | viewer.md § Viewer V2 — scaleSafetyView re-barL… | simulation/safetyView.ts:331 — a copy-paste of the credit line above: the safe viewer's Strike gauge b… | "act" → "safe" | safetyViewHardening.test.ts |
| HS-09 | GAP | boundary: scaleSafetyView's factor guard — an u… | simulation/safetyView.ts:324 — a snapshot sealed with no price (0, or absent on an older payload) scal… | [0.7,0.8,"act"] (strikeLtv, cbLtv, st… → [0,0,"safe"] | safetyViewHardening.test.ts |
| HS-10 | GAP | engines.md § `cbMetrics.ts` — the entered liqui… | simulation/safetyView.ts:222 — the owner's CB bar (and the trusted viewer's) bands against Morpho's 86… | [0.8333333333333334,1,"watch"] → [0.8333333333333334,1,"act"] | safetyViewHardening.test.ts |
| HS-11 | GAP | viewer.md § Viewer V2 — scaleSafetyView re-barL… | simulation/safetyView.ts:332 — the safe viewer's CB gauge ignores the owner's sealed cbLiqFrac and ban… | "watch" → "act" | safetyViewHardening.test.ts |
| HS-13 | GAP | boundary: > ↔ >= — at the liquidation price the… | simulation/runCoinbaseLoan.ts:135 — with BTC exactly at the liquidation price the CB Loan tab's modeler say… | true → false | runCoinbaseLoanHardening.test.ts |
| HS-14 | GAP | boundary: a dropped clamp — the liquidation pen… | simulation/runCoinbaseLoan.ts:145 — when the seizure is capped by the collateral held (an under-water loan)… | [1096.0334029227597,0,0,0] → [1096.0334029227597,0,-25000,-50000] | runCoinbaseLoanHardening.test.ts |
| HS-15 | GAP | boundary: >= ↔ > — the catch-up names cold when… | Almanac/planMonthView.ts:265 — with exactly enough cold to bring Coinbase within its limit, THIS MONTH… | "Move ₿0.717 from cold storage to Coi… → "Add ₿0.717 of collateral to Coinbase… | planMonthViewHardening.test.ts |
| HS-16 | GAP | file-structure.md § planMonthView.ts — monthTra… | Almanac/planMonthView.ts:423 — the scrubber's year paints a month whose bills go unpaid green ('within… | "linear-gradient(90deg, var(--amber) … → "linear-gradient(90deg, var(--green) … | planMonthViewHardening.test.ts |
| HS-17 | GAP | boundary: <= ↔ < at the dust floor — THE one 'o… | Almanac/supportPolicyView.ts:290 — exactly 50 cents over its limit at support, the policy card says 'Coinb… | {"roomUsd":-0.5,"roomMonths":0,"over"… → {"roomUsd":0,"roomMonths":0,"over":fa… | supportPolicyViewHardening.test.ts |
| HS-18 | GAP | engine.md — THE MOVE's copy lives in `moveCard`… | Almanac/decisionView.ts:505 — THE MOVE's why line prints TODAY's price as the support price ('needs a… | "Strike keeps what your $40,000 line … → "Strike keeps what your $40,000 line … | decisionViewHardening.test.ts |
| HS-19 | GAP | engine.md — THE MOVE's copy lives in `moveCard`… | Almanac/decisionView.ts:589 — 'Coinbase survives price down to 0.70× support ($X)' prices X off today… | "At its limit at support, Coinbase su… → "… 0.70× support ($69,767)." | decisionViewHardening.test.ts |
| HS-23 | GAP | journal.md — THIS MONTH, Daily and Daily's shee… | Almanac/decisionView.ts:200 — a seizure on the way down names its price in whole dollars inside THIS … | ["Coinbase liquidates the loan on the… → ["… at $57,141."] | decisionViewHardening.test.ts |
| HS-24 | GAP | engine.md — A run shown as THIS MONTH'S MOVE ca… | Almanac/decisionView.ts:650 — THE MOVE's one-short breaker warning says a month-end 'closed more than… | "… 31 Aug 2026 closed more than 10% u… → "… closed more than 90% under support… | decisionViewHardening.test.ts |
| HS-25 | GAP | boundary: a dropped dust floor — THE MOVE names… | Almanac/decisionView.ts:562 — Strike short of its line with a few cents of room left: THE MOVE's shor… | "… the policy's Strike limit leaves n… → "… leaves $0 of room." | decisionViewHardening.test.ts |
| HS-26 | GAP | engine.md — Every opening figure on a face incl… | Almanac/ownershipFaceView.ts:92 — the Strategy face's hero 'Yours' and its Milestones 'Yours' count the c… | 1 → 1.5 | ownershipFaceViewHardening.test.ts |
| HS-27 | GAP | ui.md § Date Formatting — local dates come from… | Settings/coldStorageView.ts:1 — Settings' 'Entered <day>' prints the UTC day: a cold total entered at 9… | "Entered 2026-10-27." → "Entered 2026-10-26." | coldStorageViewHardening.test.ts |
| HS-28 | GAP | ui.md — `NumberInput` saving ('live' hands on e… | ui/numberInputModel.ts:73 — typing 0 into a live draft (the Safety card's balance, the Log sheet) h… | 0 → null | numberInputModelHardening.test.ts |
| HS-29 | GAP | ui.md — `NumberInput` saving (numberCommit: sav… | ui/numberInputModel.ts:66 — a typed figure equal to the one the field shows at its decimals (0.1234… | null → 0.12345679 | numberInputModelHardening.test.ts |
| HS-31 | GAP | engine.md — A run shown as THIS MONTH'S MOVE ca… | Almanac/planRun.ts:224 — THIS MONTH's MOVE is built as if the model were never broken while its … | [true,"broken"] → [false,"ready"] | planRunHardening.test.ts |
| HS-34 | GAP | engine.md — Strike avail-credit invariant (the … | Daily/DailyModeView.tsx:136 — the trio pill's 'available' swaps price and drawn (positional arguments… | available 30000 (limit 40000) → available 0 (limit 5000) | dailyModeViewHardening.test.ts |
| HS-37 | GAP | general.md — `strikeLtv` storage (decimal; mult… | Viewer/ViewerHomeView.tsx:221 — the viewer's Strike LTV gauge is handed the stored fraction as a percen… | pct 50 → pct 0.5 | viewerHomeViewHardening.test.ts |
| HS-38 | GAP | ui.md — `SummaryBar fmtUSD` (local sign-preserv… | Summary/SummaryBar.tsx:5 — a deficit reads as a surplus figure: expenses $1,000 over income print … | "-$1,000" → "$1,000" | summaryBarHardening.test.ts |
| HS-39 | GAP | ui.md — Mining electricity (fiat overhead — 100… | simulation/miningUtils.ts:62 — the Miners tab's sats kept (MiningProjectionTable reads dailyEV_sats) a… | 4500 → 2100 | miningUtilsHardening.test.ts |
| HS-40 | GAP | ui.md — Every masked field goes through `ui/Pas… | ui/PassphraseInput.tsx:62 — one suppression dropped: iOS autocapitalizes the first letter of a reve… | autoComplete off, autoCorrect off, au… → autoCapitalize missing | passphraseInputHardening.test.ts |
| HS-43 | GAP | ui.md — `SettingsMain` ALL_TABS (keep in sync w… | Settings/SettingsMain.tsx:77 — a tab relabelled in one list only: Settings' tab manager says 'Mining' … | "Miners" (= AppShell fullLabel) → "Mining" | settingsMainHardening.test.ts |

**HE — the engine's older rules** (21 survivors)

| Id | Class | Rule | Mutant: file:line — the bug | Base → mutant (or why) | New test file |
|---|---|---|---|---|---|
| HE-02 | GAP | engine.md — Every support-policy stress figure … | simulation/cyclingSim.ts:1146 — The draw's Strike ceiling read at today's price: a Strike pool short of… | rows[1].strikeDrawn = 3000 → rows[1].strikeDrawn = 6000 | cyclingSimHardening.test.ts |
| HE-03 | GAP | engine.md — Every support-policy stress figure … | simulation/placement.ts:262 — THE MOVE's "short" line ("at support today the policy's Strike limit le… | strikeRoomUsd 15000 → strikeRoomUsd 20000 | placementHardening.test.ts |
| HE-04 | GAP | engine.md — The support policy's settings are t… | lib/planPolicy.ts:65 — A NaN-only guard: a non-finite saved setting (±Infinity) reads as the r… | every key → PLAN_POLICY_DEFAULTS[k] (… → Infinity → range max (70, 60, 2.5, 5,… | planPolicyHardening.test.ts |
| HE-06 | GAP | engine.md — Cold is never retrieved at or above… | simulation/cyclingSim.ts:1694 — G2's field narrowed by dropping a path: cold a Strike cure pulls at or … | rows[1].strikeCall "cured", coldRetri… → coldRetrievedAboveSupportBtc 0 | cyclingSimHardening.test.ts |
| HE-07 | GAP | engine.md — A stop at support can never exceed … | simulation/cyclingSim.ts:823 — The stop clamp fed the raw Strike cap, not the cap the engine runs (66.… | rows[0].strikeCeilingHeadroomUsd 3325… → rows[0].strikeCeilingHeadroomUsd 3400… | cyclingSimHardening.test.ts |
| HE-10 | GAP | engine.md — Under the policy, every Strike → Co… | simulation/cyclingSim.ts:1428 — A top-up-first release from Strike starts the 60-day hold ("Collateral … | rows[2].topUpFromStrikeBtc 0.03968254… → rows[2].topUpFromStrikeBtc 0, defense… | cyclingSimHardening.test.ts |
| HE-11 | GAP | almanac.md § Support-anchored policy (step 5: "… | simulation/cyclingSim.ts:1326 — The migration accepts a move that leaves Strike exactly ON its 50% draw… | rows[1].strikeToCbBtc 0 (strikeCollat… → rows[1].strikeToCbBtc 1 (strikeCollat… | cyclingSimHardening.test.ts |
| HE-12 | GAP | engine.md — `crashPlaybook` is the one crash-da… | simulation/crashPlaybook.ts:184 — The fallback top-up reuses the OPENING doom instead of re-asking after … | doomed true; steps [shiftToStrike 500… → steps [shiftToStrike 5000]; cold 0.02… | crashPlaybookHardening.test.ts |
| HE-13 | GAP | engine.md — `crashPlaybook` is the one crash-da… | simulation/crashPlaybook.ts:170 — The dust drop applied in shift-first too (the engine drops only after a… | steps [shiftToStrike 0.0010000000038] → steps [strikeToCoinbase 1.43e-8 ₿] | crashPlaybookHardening.test.ts |
| HE-16 | GAP | engine.md — Every crash-day step amount is floo… | Tools/crashPlaybookView.ts:206 — The 8-dp tier rounds: a 0.000009996 ₿ step prints 0.00001000 (more than… | "0.00000999"; null → "0.00001000"; "0.00000001" | crashPlaybookViewHardening.test.ts |
| HE-20 | EQUIVALENT | engine.md — The Strike cap never outranks Coinb… | simulation/cyclingSim.ts:1504 — The survival guard runs in months the CB top-up never runs: the reserve… | In a month with defenseShortfallUsd 0 Coinbase ends the defense at or under its cap, and cbSurvivalCollateral… | — |
| HE-23 | GAP | engine.md — Phase 4 priority | simulation/runBlocYearOne.ts:94 — The month-by-month table's phase classifies a paydown before creditExce… | rows[1] phase 4 (creditExceeded true,… → rows[1] phase 2; rows[2..11] phase 3 | runBlocYearOneHardening.test.ts |
| HE-26 | GAP | almanac.md § Support-anchored policy (step 8: "… | simulation/supportPolicy.ts:155 — At exactly 85% the call is treated as curable: cash and cold are spent … | state 'soldImmediate', soldBtc 0.5714… → state 'cured', cureCashUsd 20000 | supportPolicyHardening.test.ts |
| HE-27 | GAP | almanac.md § Support-anchored policy ("Pay down… | simulation/cyclingSim.ts:1264 — The pay-down's half-cent sweep "corrected" to 1e-9: a surplus within ha… | rows[1].strikeBalance 0 → rows[1].strikeBalance 0.00099999999998 | cyclingSimHardening.test.ts |
| HE-28 | GAP | almanac.md § Support-anchored policy (step 5: "… | simulation/cyclingSim.ts:1617 — The cure's cold → Strike move holds for one month, not two (the Strike … | cure at m1 (coldRetrievedBtc 0.011538… → rows[2].strikeToColdBtc 0.061538 | cyclingSimHardening.test.ts |
| HE-29 | GAP | file-structure.md § cyclingSim.ts ("Terminal fo… | simulation/cyclingSim.ts:1675 — Step 9 keeps sweeping after a seizure: once the price is back above sup… | liqMonth 1; rows[2..3].sweptToColdBtc… → rows[2].sweptToColdBtc 0.10229645 | cyclingSimHardening.test.ts |
| HE-30 | GAP | boundary: the band's top, k ∈ [depth, 1) — engi… | simulation/cyclingSim.ts:1404 — Top up first also ON support (k ∈ [1 − SUPPORT_EPS, 1]): the engine pou… | rows[1]: defenseDrawnUsd 3000, topUpF… → rows[1]: topUpFromColdBtc 0.085714, d… | cyclingSimHardening.test.ts |
| HE-31 | GAP | boundary: firstUnheldMonth is ulp-tolerant (cyc… | simulation/cyclingSim.ts:1567 — Dropped float guard: a top-up that restores Coinbase exactly onto its l… | firstUnheldMonth null → firstUnheldMonth 1 | cyclingSimHardening.test.ts |
| HE-33 | GAP | file-structure.md § planSearch.ts (M4: a run wh… | simulation/planSearch.ts:159 — With every path policy-ignored the field is empty and the crown falls t… | worstIndex 1, worstBy 'cushion' → worstIndex 0, worstBy 'index' | planSearchHardening.test.ts |
| HE-39 | GAP | engine.md — `getCollateralForTier` | MonthBreakdown/MonthBreakdown.tsx:37 — The month-by-month table sizes the tier's collateral at the year-end pr… | collateralBtc = 5_000 / (0.15 × 100_0… → collateralBtc = 5_000 / (0.15 × 180_0… | MonthBreakdownHardening.test.ts |
| HE-40 | EQUIVALENT | boundary: crashPlaybook — a shift whose shortfa… | simulation/crashPlaybook.ts:178 — A shift that exactly restores the line is not "held": shortfallBtc is r… | When shiftShortfallUsd is exactly 0 the fallback is skipped either way (> 0 test, crashPlaybook.ts:184); the … | — |

**HJ — the journal's money** (24 survivors)

| Id | Class | Rule | Mutant: file:line — the bug | Base → mutant (or why) | New test file |
|---|---|---|---|---|---|
| HJ-02 | GAP | journal.md — A Coinbase borrow/paydown is journ… | store/dailyRouting.ts:160 — monthOf stops gating on isMonthlyMeaningful ("rerollMonth filters anywa… | null → 1 | dailyRoutingHardening.test.ts |
| HJ-03 | GAP | journal.md — A buy's dollars are the owner's | store/dailyRouting.ts:100 — The lag check counts journal-only events: a Coinbase borrow or a cold m… | true → false | dailyRoutingHardening.test.ts |
| HJ-04 | GAP | journal.md — Strike collateral (v20 Collateral-… | simulation/logUtils.ts:309 — deriveStrikeCollateral's strictly-after filter goes ts-only (deriveCbCo… | 1 → 1.3 | logUtilsHardening.test.ts |
| HJ-05 | GAP | journal.md — Strike collateral (v20 Collateral-… | simulation/logUtils.ts:301 — deriveStrikeCollateral's anchor pick drops its ts tiebreak (date >=, ar… | 0.9 → 0.6 | logUtilsHardening.test.ts |
| HJ-06 | GAP | journal.md § Coinbase borrow & paydown events (… | simulation/logUtils.ts:345 — unreconciledCbFlows' anchor goes ts-primary — copy 2 of the (date, ts) … | {events:0, anchorCbBal:70000, suggest… → {events:1, anchorCbBal:50000, suggest… | logUtilsHardening.test.ts |
| HJ-07 | GAP | journal.md — `deriveCurrentPosition` | simulation/logUtils.ts:32 — deriveCurrentPosition trusts the log's order: an unsorted monthlyLog (s… | {btcHeld:1, blocBalance:9000, lastLog… → {btcHeld:1, blocBalance:3000, lastLog… | logUtilsHardening.test.ts |
| HJ-08 | GAP | store.md — Zustand v11 migration | store/persistConfig.ts:79 — The v11 btcHeld backfill made unconditional: migrateState runs on EVERY… | monthlyLog[0].btcHeld 0.62 → 1 | persistConfigHardening.test.ts |
| HJ-09 | GAP | store.md — Zustand v11 migration | store/persistConfig.ts:82 — The v11 expensesActual default made unconditional: the next bump replac… | monthlyLog[0].expensesActual 2500 → 3500 | persistConfigHardening.test.ts |
| HJ-10 | GAP | store.md — Zustand v19 migration | store/persistConfig.ts:87 — The v19 backfill made unconditional ("only where undefined" dropped): t… | monthlyLog[0].confirmed false → true | persistConfigHardening.test.ts |
| HJ-11 | GAP | store.md — Zustand v19 migration | store/persistConfig.ts:86 — The v19 source backfill made unconditional: the next bump stamps every … | monthlyLog[0].source 'daily' → 'manual' | persistConfigHardening.test.ts |
| HJ-12 | GAP | store.md — Zustand v19 migration | store/persistConfig.ts:92 — The C2 seed loses its empty-journal guard: every later bump appends ano… | dayLog kinds ['draw'] → ['draw','cbCollateralReading'] | persistConfigHardening.test.ts |
| HJ-13 | GAP | store.md — Zustand v20 migration | store/persistConfig.ts:174 — The v20 cache-seed ignores the stored cache: at the next bump an owner … | strikeCollateralBtc 0.8 → 0.62 | persistConfigHardening.test.ts |
| HJ-14 | GAP | journal.md § Strategy-Month Calendar Fix — anni… | store/dailyRouting.ts:16 — strategyMonthDate steps one month too far: a month the journal creates … | new entry date '2026-06-01' → '2026-07-01' | dailyRoutingHardening.test.ts |
| HJ-15 | GAP | journal.md § Strategy-Month Calendar Fix — anni… | store/slices/advisorJournalSlice.ts:129 — The one-shot reconcile's ascending loop stops at 11: a draw the calenda… | month 12 expensesActual 1000 → 0 | advisorJournalSliceHardening.test.ts |
| HJ-16 | GAP | journal.md § Strategy-Month Calendar Fix — anni… | store/slices/advisorJournalSlice.ts:133 — The reconcile passes m − 1 to priorStocksForMonth (which already steps … | month 3 {strikeBal:3000, confirmed:tr… → {strikeBal:3000, confirmed:false} | advisorJournalSliceHardening.test.ts |
| HJ-17 | GAP | daily-mode.md § Daily Mode (P2a — store wiring;… | store/dailyRouting.ts:119 — The emptied-month cleanup deletes any entry, not only a daily-owned one… | no delete → deleteLogEntry(1) | dailyRoutingHardening.test.ts |
| HJ-18 | GAP | daily-mode.md § Daily Mode (P4c-3b — reconcile … | store/slices/advisorJournalSlice.ts:106 — The sign-off clears provisional: "Confirm as provisional" stores provis… | {confirmed:true, provisional:true} → {confirmed:true, provisional:false} | advisorJournalSliceHardening.test.ts |
| HJ-20 | GAP | journal.md § Logging Consolidation §5b — Readin… | store/dailyRouting.ts:59 — readingCtx omits cbLiqPrice: deleting the reading that set the Coinbase… | {oldDate:'2026-01-20', strikeBal:0, c… → {oldDate:'2026-01-20', strikeBal:0, c… | dailyRoutingHardening.test.ts |
| HJ-21 | GAP | journal.md § Logging Consolidation — One Ledger… | Daily/calendarModel.ts:157 — Strike's minimum (a minPayment event) summed into the stream's paydown:… | {paydown:0, minPayment:200} → {paydown:200, minPayment:0} | calendarModelHardening.test.ts |
| HJ-22 | GAP | daily-mode.md § Daily Mode (P4c-1a — Week\|Month… | Daily/calendarModel.ts:90 — buildDayCells forgets withdraw: a day whose only event is a collateral … | ['logged'] → [] | calendarModelHardening.test.ts |
| HJ-23 | GAP | almanac.md § M-L1 — Ledger face (seventh Almana… | lib/ledgerCsv.ts:145 — The CB cells swapped under an unchanged header: with hasCbLoan the CSV'… | row '1,2026-06-01,0,0,0,0,,0,60000,0.… → '1,2026-06-01,0,0,0,0,,0,0.4,60000' | ledgerCsvHardening.test.ts |
| HJ-24 | GAP | almanac.md § M-L1 — Ledger face (seventh Almana… | lib/ledgerCsv.ts:102 — csvCell quotes a cell but no longer doubles an embedded quote: a cell h… | row '1,"2026-01-01""x",0,0,0,0,,0' → '1,"2026-01-01"x",0,0,0,0,,0' | ledgerCsvHardening.test.ts |
| HJ-25 | GAP | boundary: THIS MONTH's expenses prompt fires at… | simulation/logUtils.ts:69 — The re-anchor prompt fires at exactly 5% drift: three done months avera… | {show:false, avg:4200} → {show:true, avg:4200} | logUtilsHardening.test.ts |
| HJ-26 | GAP | engines.md § `coldStorageBtc` — a REAL balance,… | simulation/logUtils.ts:375 — isAfterColdAnchor loses its non-finite guard: a NaN coldStorageBtcAsOf … | 1.2 → 1 | logUtilsHardening.test.ts |

**HY — sync and the plan** (17 survivors)

| Id | Class | Rule | Mutant: file:line — the bug | Base → mutant (or why) | New test file |
|---|---|---|---|---|---|
| HY-02 | GAP | sync.md — The plan log stays inside one publish… | lib/planEvents/compact.ts:26 — the budget trim measures String.length, not UTF-8 bytes: a log with non… | kept 115; payload 32,557 B (<= 32,768) → kept 150; payload 42,462 B (> 40,960 … | compactHardening.test.ts |
| HY-03 | GAP | sync.md — The plan log stays inside one publish… | lib/nostr/syncEngine.ts:231 — publishPlanEventsNow persists the compacted log but sends the uncompact… | publishEncrypted data = { events: [th… → publishEncrypted data = { events: all… | syncEngineHardening.test.ts |
| HY-04 | GAP | sync.md — The journal syncs as pages, and nothi… | lib/nostr/publish.ts:44 — the guard is fed UTF-16 code units, not bytes: a page or plan with mult… | throws PayloadTooLargeError before to… → passes the guard; throws 'signer miss… | publishHardening.test.ts |
| HY-05 | GAP | sync.md — The journal syncs as pages, and nothi… | lib/nostr/syncEngine.ts:191 — the records:v1 stub goes out dated by the local clock alone: when a dev… | stub publishEncrypted minCreatedAt ar… → stub publishEncrypted minCreatedAt ar… | syncEngineHardening.test.ts |
| HY-06 | GAP | sync.md — The journal syncs as pages, and nothi… | lib/nostr/syncGuard.ts:46 — off by one at the step: a payload of exactly 40,960 B plain — which pad… | no throw → throws PayloadTooLargeError | syncGuardHardening.test.ts |
| HY-07 | GAP | sync.md — The journal syncs as pages, and nothi… | lib/nostr/syncEngine.ts:247 — the plan channel's size refusal is treated as a signer failure: Reconne… | returns false; planDirty false; nostr… → returns false; planDirty true; nostrR… | syncEngineHardening.test.ts |
| HY-09 | GAP | sync.md — `publishRecords` cadence | store/slices/advisorJournalSlice.ts:84 — upsertLogEntry — every monthly write funnels here: a sign-off, a reopen… | publishRecordsNow called once (after … → publishRecordsNow not called | advisorJournalSliceHardening.test.ts |
| HY-10 | GAP | sync.md — Records merge | lib/nostr/sync.ts:327 — recordsDirty no longer breaks the merge's ties: an unpublished local ed… | local entry kept (setMonthlyLog not c… → relay entry wins (setMonthlyLog calle… | syncHardening.test.ts |
| HY-11 | GAP | sync.md — The plan is event-sourced; only the p… | lib/nostr/sync.ts:118 — the prefs watermark admits the copy already applied: this device's own … | hydratePrefs called 0 times → hydratePrefs called 1 time | syncHardening.test.ts |
| HY-13 | GAP | sync.md — The dirty-gated retry never starts an… | hooks/useNostrSync.ts:117 — isAuthenticated dropped from the retry effect's deps (no exhaustive-dep… | deps include isAuthenticated → deps omit isAuthenticated | useNostrSyncHardening.test.ts |
| HY-14 | GAP | sync.md — Nostr reliability fix ("Foreground/la… | lib/nostr/syncNow.ts:20 — the foreground rebuild widened from NIP-46 to the local key: every sync… | restoreSigner not called → restoreSigner called once | syncNowHardening.test.ts |
| HY-15 | GAP | general.md — No plan-dependent write before the… | lib/nostr/sync.ts:178 — a pull that finds the v2 journal (manifest) but no plan and no records:… | planPull { status: 'unreadable', reas… → planPull { status: 'none' } | syncHardening.test.ts |
| HY-16 | GAP | general.md — `cbLiquidationPrice` (0 = not set) | store/slices/dayLogSlice.ts:130 — the not-set sentinel read as a price: a Coinbase balance re-anchor with… | reading has no cbLiqPrice → reading.cbLiqPrice = 0 | dayLogSliceHardening.test.ts |
| HY-17 | GAP | store.md — Zustand v7 migration ("adds cbPaymen… | store/persistConfig.ts:106 — the v7 default overwrites the stored value: at the next store-version b… | cbLtvTriggerPct 80 → cbLtvTriggerPct 75 | persistConfigHardening.test.ts |
| HY-18 | GAP | store.md — Zustand v8 migration | store/persistConfig.ts:128 — btcPriceMode forced to 'live' on migrate: a user who typed a BTC price … | 'manual' → 'live' | persistConfigHardening.test.ts |
| HY-19 | GAP | store.md — Zustand v10 migration | store/persistConfig.ts:130 — the stored NIP-46 login is dropped on migrate: at the next store-versio… | 'bunker://x' → null | persistConfigHardening.test.ts |
| HY-20 | GAP | store.md — Zustand v13 migration | store/persistConfig.ts:110 — the Coinbase balance's as-of date is dropped on migrate: accruedCbBalan… | '2026-01-01' → null | persistConfigHardening.test.ts |

**HK — keys, backups, viewers** (13 survivors)

| Id | Class | Rule | Mutant: file:line — the bug | Base → mutant (or why) | New test file |
|---|---|---|---|---|---|
| HK-01 | GAP | identity.md — The words string | lib/nostr/keyVault.ts:222 — unwrapSecretKey 'simplified' to return deriveSkFromEntropy(bytes) direc… | {skLen:32, entropyAfter:[0 x16]} → {skLen:32, entropyAfter:[5 x16]} | keyVaultHardening.test.ts |
| HK-02 | GAP | identity.md — `WrapMeta.payloadKind` (the compa… | lib/nostr/keyVault.ts:46 — PBKDF2 iterations 'tuned' 600,000 → 310,000 for slow phones with no mig… | iterations [600000] → iterations [310000] | keyVaultHardening.test.ts |
| HK-03 | GAP | identity.md — A held key buffer is zeroed on su… | lib/crypto/cryptoClient.ts:157 — the worker-path 'copy' becomes a view, so postMessage TRANSFERS the cal… | {out:'ncryptsec1fake', callerLen:32, … → {out:'ncryptsec1fake', callerLen:0} | cryptoClientHardening.test.ts |
| HK-04 | GAP | identity.md — Malformed payload ≠ wrong passphr… | lib/crypto/cryptoClient.ts:105 — the worker's classified kind is dropped and every ok:false response bec… | CryptoError kind 'malformed' → CryptoError kind 'passphrase' | cryptoClientHardening.test.ts |
| HK-06 | GAP | identity.md — A held key buffer is zeroed on su… | lib/nostr/establishOwner.ts:47 — the '.slice()' into NSecSigner is optimized away: NSecSigner stores the… | {pubOk:true, valid:true} → throws 'invalid scalar: out of range' | establishOwnerHardening.test.ts |
| HK-07 | GAP | identity.md — A held key buffer is zeroed on su… | lib/nostr/session.ts:74 — restoreSigner hands NSecSigner the unwrapped buffer itself, then 'sk.fi… | {pubOk:true, valid:true} → non-null signer whose signEvent throw… | sessionHardening.test.ts |
| HK-08 | GAP | identity.md — ⚠ The `restoreSigner` single-flig… | lib/nostr/session.ts:132 — the ownership check is 'simplified' away: the doomed pinless restore (s… | {aNull:true, cIsB:true, cNull:false, … → {aNull:true, cIsB:false, cNull:true, … | sessionHardening.test.ts |
| HK-09 | GAP | identity.md — The encrypted branch's payload MU… | Auth/NostrAuthGate.tsx:244 — the copy of decryptState.sk is 'optimized away': after a cancelled Face… | encrypted branch assigns `payload = d… → `payload = decryptState.sk;` (alias o… | NostrAuthGateHardening.test.ts |
| HK-10 | GAP | identity.md — Import `payloadKind` is THREE-WAY… | Auth/NostrAuthGate.tsx:249 — the words branch keeps the default payloadKind 'sk': a 12-word import w… | `payload = entropyFromWords(input.val… → `payload = entropyFromWords(input.val… | NostrAuthGateHardening.test.ts |
| HK-11 | GAP | general.md — Never claim plan-data encryption-a… | Auth/NostrAuthGate.tsx:694 — the import notice's copy drifts back to a security promise the code doe… | "The app keeps your key protected on … → "The app keeps your key and your plan… | NostrAuthGateHardening.test.ts |
| HK-12 | GAP | store.md — Zustand v15 migration (moved OUT of … | store/bootstrap.ts:39 — the one-time back-fill reads the wrapped key out of a legacy blob into … | seed 'WRAPPED', personal-bloc-writer-… → seed 'WRAPPED', personal-bloc-writer-… | bootstrapHardening.test.ts |
| HK-13 | GAP | store.md — Zustand v17 migration (viewerMode de… | store/persistConfig.ts:151 — the v21 clean-cut reset is copied one block down onto the viewer-side f… | viewerMode true → viewerMode false | persistConfigHardening.test.ts |
| HK-14 | GAP | store.md — Zustand v18 migration (LEAVES any ex… | store/persistConfig.ts:155 — migrate 'cleans up' the plaintext viewer key the row says it must leave… | viewerSecretKey 'aa'.repeat(32) → viewerSecretKey null | persistConfigHardening.test.ts |

Never run: HK-15, HK-16, HK-17, HK-18, HK-19, HK-20.

**Totals:** GAP 105 · EQUIVALENT 2.

### 2.3 The GAPs proposed for Stage 2 tests

- **`src/simulation/__tests__/strikeCreditHardening.test.ts`** (new) — 1: HS-01
- **`src/simulation/__tests__/cbMetricsHardening.test.ts`** (new) — 2: HS-02, HS-03
- **`src/simulation/__tests__/safetyViewHardening.test.ts`** (new) — 8: HS-04, HS-05, HS-06, HS-07, HS-08, HS-09, HS-10, HS-11
- **`src/simulation/__tests__/runCoinbaseLoanHardening.test.ts`** (new) — 2: HS-13, HS-14
- **`src/components/Almanac/__tests__/planMonthViewHardening.test.ts`** (new) — 2: HS-15, HS-16
- **`src/components/Almanac/__tests__/supportPolicyViewHardening.test.ts`** (new) — 1: HS-17
- **`src/components/Almanac/__tests__/decisionViewHardening.test.ts`** (new) — 5: HS-18, HS-19, HS-23, HS-24, HS-25
- **`src/components/Almanac/__tests__/ownershipFaceViewHardening.test.ts`** (new) — 1: HS-26
- **`src/components/Settings/__tests__/coldStorageViewHardening.test.ts`** (new) — 1: HS-27
- **`src/components/ui/__tests__/numberInputModelHardening.test.ts`** (new) — 2: HS-28, HS-29
- **`src/components/Almanac/__tests__/planRunHardening.test.ts`** (new) — 1: HS-31
- **`src/components/Daily/__tests__/dailyModeViewHardening.test.ts`** (new) — 1: HS-34
- **`src/components/Viewer/__tests__/viewerHomeViewHardening.test.ts`** (new) — 1: HS-37
- **`src/components/Summary/__tests__/summaryBarHardening.test.ts`** (new) — 1: HS-38
- **`src/simulation/__tests__/miningUtilsHardening.test.ts`** (new) — 1: HS-39
- **`src/components/ui/__tests__/passphraseInputHardening.test.ts`** (new) — 1: HS-40
- **`src/components/Settings/__tests__/settingsMainHardening.test.ts`** (new) — 1: HS-43
- **`src/simulation/__tests__/cyclingSimHardening.test.ts`** (new) — 10: HE-02, HE-06, HE-07, HE-10, HE-11, HE-27, HE-28, HE-29, HE-30, HE-31
- **`src/simulation/__tests__/placementHardening.test.ts`** (new) — 1: HE-03
- **`src/lib/__tests__/planPolicyHardening.test.ts`** (new) — 1: HE-04
- **`src/simulation/__tests__/crashPlaybookHardening.test.ts`** (new) — 2: HE-12, HE-13
- **`src/components/Tools/__tests__/crashPlaybookViewHardening.test.ts`** (new) — 1: HE-16
- **`src/simulation/__tests__/runBlocYearOneHardening.test.ts`** (new) — 1: HE-23
- **`src/simulation/__tests__/supportPolicyHardening.test.ts`** (new) — 1: HE-26
- **`src/simulation/__tests__/planSearchHardening.test.ts`** (new) — 1: HE-33
- **`src/components/MonthBreakdown/__tests__/MonthBreakdownHardening.test.ts`** (new) — 1: HE-39
- **`src/store/__tests__/dailyRoutingHardening.test.ts`** (new) — 5: HJ-02, HJ-03, HJ-14, HJ-17, HJ-20
- **`src/simulation/__tests__/logUtilsHardening.test.ts`** (new) — 6: HJ-04, HJ-05, HJ-06, HJ-07, HJ-25, HJ-26
- **`src/store/__tests__/persistConfigHardening.test.ts`** (new) — 12: HJ-08, HJ-09, HJ-10, HJ-11, HJ-12, HJ-13, HY-17, HY-18, HY-19, HY-20, HK-13, HK-14
- **`src/store/__tests__/advisorJournalSliceHardening.test.ts`** (new) — 3: HJ-15, HJ-16, HJ-18
- **`src/components/Daily/__tests__/calendarModelHardening.test.ts`** (new) — 2: HJ-21, HJ-22
- **`src/lib/__tests__/ledgerCsvHardening.test.ts`** (new) — 2: HJ-23, HJ-24
- **`src/lib/planEvents/__tests__/compactHardening.test.ts`** (new) — 1: HY-02
- **`src/lib/nostr/__tests__/syncEngineHardening.test.ts`** (new) — 3: HY-03, HY-05, HY-07
- **`src/lib/nostr/__tests__/publishHardening.test.ts`** (new) — 1: HY-04
- **`src/lib/nostr/__tests__/syncGuardHardening.test.ts`** (new) — 1: HY-06
- **`src/store/slices/__tests__/advisorJournalSliceHardening.test.ts`** (new) — 1: HY-09
- **`src/lib/nostr/__tests__/syncHardening.test.ts`** (new) — 3: HY-10, HY-11, HY-15
- **`src/hooks/__tests__/useNostrSyncHardening.test.ts`** (new) — 1: HY-13
- **`src/lib/nostr/__tests__/syncNowHardening.test.ts`** (new) — 1: HY-14
- **`src/store/slices/__tests__/dayLogSliceHardening.test.ts`** (new) — 1: HY-16
- **`src/lib/nostr/__tests__/keyVaultHardening.test.ts`** (new) — 2: HK-01, HK-02
- **`src/lib/crypto/__tests__/cryptoClientHardening.test.ts`** (new) — 2: HK-03, HK-04
- **`src/lib/nostr/__tests__/establishOwnerHardening.test.ts`** (new) — 1: HK-06
- **`src/lib/nostr/__tests__/sessionHardening.test.ts`** (new) — 2: HK-07, HK-08
- **`src/components/Auth/__tests__/NostrAuthGateHardening.test.ts`** (new) — 3: HK-09, HK-10, HK-11
- **`src/store/__tests__/bootstrapHardening.test.ts`** (new) — 1: HK-12

### 2.4 SUSPECT mutants (the mutant matches the rules or docs better than the base — findings for the queue, never tests)

None.

### 2.5 The rule rows no mutant could break (named, with why)

Row coverage reported by the planners (each row owned by one target): **88 rows mutated, 45 not executable** (the rest listed as another target's). Not executable:

- HS · engine.md "The Decision face's Print never clears its body class …" — Its code is DecisionFace.tsx's printSchedule and C1 effect (DecisionFace.tsx:593-612), none of…
- HS · ui.md "Mining strategy cards" — The presets are MiningMain.tsx's handleStrategySelect (MiningMain.tsx:18-29), a click handler …
- HS · ui.md "`MiningOddsBar`" — A component-structure rule (MiningOddsBar.tsx:16 reads the devices from the store, not props):…
- HS · ui.md "`fmtMining`" — A module-placement rule (inlined in utils/format.ts so there is no circular import): a one-edi…
- HS · ui.md "Override a composed class's property on a DOUBLED sele…" — CSS: hunt.mjs check parses every mutated file as TypeScript (syntaxErrors → ts.transpileModule…
- HS · ui.md "Never `position: fixed` under EdgeBackGesture's `.page`" — CSS and device layout (a will-change containing block), not plantable through the TS-parsing h…
- HS · ui.md "`NumberInput` suffix" — A layout convention (no suffix inside the input: the caret misbehaves on device); no logic in …
- HS · general.md "A hook may never sit to the right of `||`, `&&`, or `?…" — HS's fourteen modules are pure — none calls a hook — so the shape can only live in a .tsx; and…
- HE · engine.md "`ltvTriggered` mode" — History row: runAdvisor (and its ltvTriggered mode) left the code in 5e (D5-A); nothing runs t…
- HE · engine.md "`ltvTriggered` band" — History row: the three-threshold band ran only in runAdvisor, deleted in 5e (D5-A); cbRotateBa…
- HE · engine.md "`computeLiquidationAnalysis`" — An import-graph rule (runCoinbaseLoan.ts imports only ./ltv). A single edit adding an import o…
- HJ · journal.md "`MonthlyLogOverlay`" — A React component row (portal to document.body, centered modal, 0-indexed initialMonth, openIn…
- HY · general.md "Skip fields" — the Pay/Skip toggles retired at Run 3: no component reads or writes advisorSkip* (planYearWiri…
- HY · store.md "Zustand v9 migration" — what the row states is no longer code: migrateState carries lastRecordsSyncAt ?? null (src/sto…
- HY · store.md "Zustand v16 migration" — advisorMonthStartBalance is inert since Run 3 — no reader anywhere (planYearWiring.test.ts:134…
- HY · store.md "Zustand v14 migration" — showPlanIncomeBar/StrikeBar/CbBar are inert: no reader (SettingsMain.tsx:841 'The store keeps …
- HY · store.md "Zustand v12 migration" — cbRotateBackPct is inert since Run 3 — no reader (planYearWiring.test.ts:134 INV6; grep: only …
- HK · identity.md "Backup ceremony stamps once, self-waking" — the stamp's call site is RecoveryKeyCeremony (render-only); dropping its `nostr` arg leaves `c…
- HK · identity.md "✅ FIXED (P0) — every unlock surface for a `scheme:'pin…" — component-only: the code lives in LocalUnlockGate and NostrAuthGate.handleUnlockExisting (JSX/…
- HK · identity.md "A bare nsec must save an encrypted backup BEFORE it es…" — component-only: the code lives in NostrAuthGate.handleLocal's nsec branch and the remediation …
- HK · identity.md "`nip49.encrypt` is ~1s of SYNCHRONOUS scrypt — yield b…" — React commit timing (setEncrypting → 30 ms yield → scrypt) in RecoveryKeyCeremony / NostrAuthG…
- HK · identity.md "Reproducing onboarding-transition crashes" — a process note about `npm run dev` and the gate suffixes — no code to mutate
- HK · identity.md "No attestation checkbox on the IMPORT path" — component-only: the code lives in NostrAuthGate's localCanContinue / JSX (JSX/state), which on…
- HK · identity.md "The ceremony verifies the artifact the user SAVED, not…" — CAP SKIP (executable, not planted — H-K's 20 went to rows no test pins): the verifyEncrypted b…
- HK · identity.md "No save, no Continue" — component-only: the code lives in RecoveryKeyCeremony (savedOnce / invalidateArtifact / share'…
- HK · identity.md "`RevealRecoveryKey` is view-only" — component-only: the code lives in RevealRecoveryKey (JSX/state), which only a render reaches —…
- HK · identity.md "Ceremony idempotency" — component-only: the code lives in RecoveryKeyCeremony's step flow (JSX/state), which only a re…
- HK · identity.md "Never auto-strip a handoff token's `:npub` suffix" — component-only: the code lives in NostrAuthGate's render guard and handleLocal's `.includes(':…
- HK · identity.md "The ceremony's save aids derive the sk from the STRING…" — component-only: the code lives in RecoveryKeyCeremony's ensureArtifact (JSX/state), which only…
- HK · identity.md "Encrypt is a one-shot on tap; guard the stale result" — component-only: the code lives in RecoveryKeyCeremony's prepRef token (JSX/state), which only …
- HK · identity.md "The QR PNG comes from `QRCodeCanvas`, not SVG rasteriz…" — component-only: the code lives in RecoveryKeyCeremony (a hidden canvas, marginSize={4}) (JSX/s…
- HK · identity.md "Recovery grid is capture UX only" — the rule is that the component never authorizes on recoveryGrid's hints — the authority (skFro…
- HK · identity.md "`handleLocal` is one path" — component-only: the code lives in NostrAuthGate.handleLocal (its structure) (JSX/state), which…
- HK · identity.md "`classifyRecoveryInput`" — CAP SKIP (executable, not planted — H-K's 20 went to rows no test pins): recoveryInput.ts is p…
- HK · identity.md "`remotePlanFound`" — CAP SKIP (executable, not planted — H-K's 20 went to rows no test pins): syncSlice.recordRemot…
- HK · identity.md "The `NoPlanNotice` mount" — component-only: the code lives in AppShell / ViewerHomeView (`{ownerNav && notice}`) (JSX/stat…
- HK · identity.md "Backup ladder mutual exclusivity" — component-only: the code lives in NoPlanNotice / BackupNagCard self-gates (JSX/state), which o…
- HK · identity.md "Ceremony has exactly TWO triggers" — component-only: the code lives in BackupNagCard, RECOVERY and the Identity & Security row (Set…
- HK · identity.md "`unwrapSecretKey` return type" — CAP SKIP (executable, not planted — H-K's 20 went to rows no test pins): pinned by keyVault.te…
- HK · identity.md "NIP-06 derivation constants" — CAP SKIP (executable, not planted — H-K's 20 went to rows no test pins): nip06Key.ts takes nos…
- HK · identity.md "Provenance stamp ordering" — component-only: the code lives in the establishment call sites (NostrAuthGate ×4, OwnerKeySetu…
- HK · identity.md "Onboarding verifies by default (R2c-6a, SUPERSEDES the…" — component-only: the code lives in OwnerKeySetup K2 (save + two-word quiz → stamp; handleGenera…
- HK · identity.md "Seed-phrase hygiene copy — two variants, don't cross t…" — component-only: the code lives in OwnerKeySetup K2, RecoveryKeyCeremony and NostrAuthGate (cop…
- HK · identity.md "NIP-46 mobile login" — a device / relay-timing rule (warm the relay in the foreground before the deep link) in the NI…
- HK · general.md "nostr-tools pin" — a package.json version pin — the platform files are never touched (spec §1.2) and the harness …

## 3. The audit — verified findings, ranked

A3 (sync, keys, backups, viewers, privacy) was not audited (§0).

- A1 The engine and the money math: 13 raised (two lenses, merged to 12) → 12 confirmed · 0 refuted · 0 unverified
- A2 The journal: 9 raised → 9 confirmed · 0 refuted · 0 unverified
- A4 Screens and words: 10 raised → 10 confirmed · 0 refuted · 0 unverified
- A5 Start-up, offline, the platform: 8 raised → 8 confirmed · 0 refuted · 0 unverified
- A6 The tests themselves: 6 raised → 6 confirmed · 0 refuted · 0 unverified

| # | Id | Sev. | Lane | File:line | Finding | Fix sketch |
|---|---|---|---|---|---|---|
| 1 | A1-1 | Critical | Heavy | simulation/cyclingSim.ts:1774 | The never-draw baseline never liquidates: its Coinbase loan compounds through any crash with no 86% test, and its coins are pooled across venues. So the verdict (faces, Decis… | Give the baseline the Coinbase leg's own seizure (debt against Coinbase co… |
| 2 | A2-1 | Critical | Heavy | simulation/logUtils.ts:277 | Editing, backfilling or un-deleting an older balance reading makes that reading's Coinbase collateral the current one. The live CB LTV, the crash-day gate and the plan's run … | Order deriveCbCollateral by (date, ts) as deriveStrikeCollateral and deriv… |
| 3 | A2-2 | Critical | Heavy | lib/backup/validatePlanBackup.ts:74 | A Strike balance re-anchored while no Strike collateral is recorded writes strikeLtv = Infinity into the month entry. JSON turns it into null, and the restore validator then … | Never store a non-finite LTV in a reading or month entry: leave it absent,… |
| 4 | A2-3 | Critical | Heavy | simulation/logUtils.ts:309 | Correcting a just-logged Strike deposit, or tapping Undo after deleting it, counts the deposit twice in Strike collateral. The sheet's own readout says ₿1.12; the store then … | Keep an edited or restored strike move out of its anchor's window: separat… |
| 5 | A2-4 | Critical | Heavy | simulation/logUtils.ts:166 | A month's recorded closing balances come from its latest reading by ts, not by date. Editing or backfilling an earlier reading in the month therefore replaces the month-end S… | Select the month's stock reading by (date, ts) in rollupMonth and priorSto… |
| 6 | A2-5 | Critical | Heavy | store/slices/advisorJournalSlice.ts:44 | Changing the 'Strategy start date' in Settings re-buckets the journal but leaves the month log on the old months. The next event then double-counts in the Ledger, and signed … | On a start-date change, re-roll all twelve months (the reconcile without i… |
| 7 | A4-1 | Critical | Light | components/Viewer/ViewerHomeView.tsx:144 | With the Coinbase loan switched off (onboarding's "No"), the Dashboard's "Where the coins sit" and "Who holds the coins" count the store's placeholder 1.48 ₿ on Coinbase as t… | Feed the venue and ownership bars Coinbase's coins through planCbCollatera… |
| 8 | A4-3 | Critical | Heavy | components/LivingOnBitcoin/StrategyCards.tsx:50 | The Living on Bitcoin tab prints a negative net worth as a positive one ("$6,863" for −$6,863) through the sign-dropping fmtUSD, and at zero holdings prints "Real Return -Inf… | Print net worth sign-preserving, show '—' for a return over a zero base, s… |
| 9 | A1-2 | Medium | Heavy | components/Almanac/decisionView.ts:153 | A crash month whose fallback top-up restores Coinbase still prints 'The defense falls $X short — Coinbase stays over its defense line', and THIS MONTH / Daily show a red 'Coi… | Print the short only when the month ends over the line (row.cbLtv > cap, t… |
| 10 | A1-3 | Medium | Heavy | components/Tools/crashPlaybookView.ts:70 | isCrashDay open-codes the LTV as `value > 0 && debt / value >= trigger`, so a Coinbase loan with debt and no collateral (LTV ∞) is never a crash day: the Emergency Console ac… | isCrashDay: `ltvOf(f.cbDebt, f.cbCollateralBtc, f.price) >= f.triggerPct /… |
| 11 | A1-4 | Medium | Heavy | simulation/cyclingSim.ts:1576 | Gate G2 ('cold is never retrieved at or above support for a position that opens inside both ceilings') fails when spare income cannot repay capitalised interest, and the poli… | Owner call: either scope G2 and the alarm to 'opened over, or went over, i… |
| 12 | A1-5 | Medium | Light | components/Almanac/decisionView.ts:115 | Every month after a Coinbase seizure the schedule tells the owner to 'Buy $X of bitcoin and pledge it to Coinbase'. The loan is gone, the plan never borrows again, and the ru… | After liqMonth, word the buy without 'pledge it to Coinbase'. Separately, … |
| 13 | A1-6 | Medium | Light | components/Almanac/supportPolicyView.ts:512 | After a Coinbase seizure the unpaid-bills line blames 'the credit line and the limits at support'. In fact the plan stops borrowing only because Coinbase was liquidated, and … | When the first unpaid month is at or after liqMonth (way down) or after it… |
| 14 | A1-7 | Medium | Light | components/Almanac/decisionView.ts:539 | THE MOVE's batch line rounds a sub-threshold move up to the threshold and says '0.010 ₿ is under the 0.01 ₿ threshold' for any total in [0.0095, 0.01). | Floor the figure on the sub-threshold lines (Math.floor(x*1000)/1000, the … |
| 15 | A2-6 | Medium | Heavy | store/dailyRouting.ts:153 | A signed month's 'Expenses actually paid' adjustment is overwritten by the ledger's draws on any later re-roll (a reading added, a buy logged). The re-review seeds from the d… | Keep the signed expensesActual apart from the rollup's draws (an override … |
| 16 | A2-7 | Medium | Heavy | components/Daily/EventSheet.tsx:773 | The past-date note promises 'this month is marked provisional until a reading is logged'. With no reading in the prior month, the month is instead written with a $0 Strike ba… | Mark a month with flows and no reading as provisional even without prior s… |
| 17 | A2-8 | Medium | Heavy | simulation/simpleModePlan.ts:98 | Strike's minimum shows MISSED for the first part of every strategy month that starts after the due day. The chip compares today's calendar day with the due day but counts pay… | Decide DUE / MISSED against the due date that falls inside the strategy mo… |
| 18 | A2-9 | Medium | Light | components/Almanac/LedgerFace.tsx:247 | The Ledger's footnote '† includes a non-draw / minimum payment.' is false. The dagger sits on the Paydown cell, which never includes Strike's minimum or the NDP, and the mini… | Reword the footnote (e.g. '† Strike's minimum / NDP paid this month — not … |
| 19 | A4-2 | Medium | Heavy | components/SimpleMode/SafetyDashboard.tsx:101 | A Strike balance with no Strike collateral reads as maximally safe in the Strike card's liquidation cushion — "$100,000.00 above liq ~$0.00 · 100% drop away" — beside its own… | With debt and no collateral, give no liquidation price ("no collateral — p… |
| 20 | A4-4 | Medium | Light | components/Daily/dailyView.ts:30 | Daily's activity row for a Strike balance reading taken with no Strike collateral reads "(0.0% LTV)" once the app reloads ("Infinity% LTV" before), through an open-coded LTV … | Print a reading's LTVs through fmtLtvPct and read a null LTV as non-finite… |
| 21 | A4-5 | Medium | Light | components/Almanac/ScenarioFace.tsx:37 | The Scenario face prints "Strike LTV Infinity% → Infinity% NaNpp", "+Infinitypp" and "Crash LTV … Infinity%" whenever Strike collateral is zero against a Strike balance — a l… | Print the LTV cells through fmtLtvPct and the pp chip as '—' for a non-fin… |
| 22 | A4-6 | Medium | Light | components/Collateral/TierCards.tsx:28 | The Smart BLOC tab's Custom tier says "Day-one LTV: 0.0% · 80% crash → 0% Safe" for a month's expenses drawn on ₿0.0000 of collateral, and the LTV guard exempts the whole fil… | Make the zero-collateral custom LTV infinite and print it through fmtLtvPc… |
| 23 | A4-7 | Medium | Light | utils/format.ts:59 | The Mining face's figures disagree with its words: a negative net prints "$-1.0620", the sats net subtracts electricity under the face's own "100% of mined sats kept", and wi… | Format a negative mining dollar as '−$1.06'; show the sats net without ele… |
| 24 | A4-8 | Medium | Light | components/Almanac/CyclingFace.tsx:1171 | Cycling, Ownership and Strategy say "This run: $0 over 0 borrows — a blended 2.00% of the amount moved" and that the move "still pays for itself after ~3.6 months at that ble… | With no borrows, say 'No sweep to Coinbase on this run' and give the tier-… |
| 25 | A5-1 | Medium | Heavy | components/Viewer/ViewerHomeView.tsx:208 | Offline (or with no price answer this session), the owner's home-screen Safety pill reads 'All positions safe · live' and the full-mode price badge reads 'LIVE' for a price f… | Derive the pill's word and the sidebar badge from btcPriceUpdatedAt (and a… |
| 26 | A5-2 | Medium | Heavy | store/persistConfig.ts:148 | migrateState ignores the stored version, so the next store-version bump re-runs v21's roster wipe on every device (viewers [] and nextViewerIndex 0) and the relay pull never … | Pass zustand's fromVersion into migrateState and gate each step (`if (from… |
| 27 | A5-3 | Medium | Heavy | hooks/useStrikeData.ts:42 | A Strike outage (upstream 503) is passed through by the proxy and read by the client as 'key not configured': polling stops for the session and the widget keeps its green dot… | Have the proxies answer an upstream failure with 502 (or tag the body), an… |
| 28 | A6-1 | Medium | Light | simulation/__tests__/cyclingSim.test.ts:833 | The ⭐ "the Strike leg never breaches the margin-call LTV at the stressed price" makes no assertion at all: its fixture repays Strike in month 1, so its filter skips all 241 r… | Give the test a fixture that keeps Strike debt after month 0, count the ro… |
| 29 | A1-8 | Minor | Heavy | components/Tools/crashPlaybookView.ts:198 | fmtStepBtc's FLOOR_GUARD (1e-7 of the last printed place = 1e-12 ₿) is larger than STRIKE_RELEASE_EPS's cushion when Strike's keep is under 0.001 ₿, so a binding Strike relea… | Scale the guard to the cushion (e.g. guard relative to btc × 1e-12, or flo… |
| 30 | A1-9 | Minor | Heavy | simulation/placement.ts:234 | THE MOVE and the engine's step 5 apply different 'under 50% after' tests (≤ 50% × (1 − 1e-9) through strikeReleasableBtc vs `< strikeMaxDrawLtv` open-coded in the migration),… | Have step 5 test the move through strikeReleasableBtc (move ≤ releasableNo… |
| 31 | A1-10 | Minor | Light | components/Almanac/CyclingFace.tsx:770 | With the policy off, a refinance capped exactly at the defense line leaves a float overage that the debt shift books as a defense, so a face can print 'LTV stop defense: $0 o… | Gate the policy-off note and the ⇄ flag on shownUsd (or drop a sub-half-ce… |
| 32 | A1-11 | Minor | Light | components/Almanac/decisionView.ts:79 | In a shift-first crash month the schedule (and THIS MONTH's rows) lists the cold → Coinbase top-up before the debt shift. The engine and the Emergency Console do the reverse. | Order a crash month's kinds by the playbook's order for that row (shift fi… |
| 33 | A1-12 | Minor | Light | components/Almanac/decisionView.ts:299 | coinbaseLoanLine says nothing when the plan opens a Coinbase loan through pledged buys and a refinance, because it looks only for a Strike → Coinbase release. | Key the line on the first row with Coinbase collateral or a refinance (cbC… |
| 34 | A4-9 | Minor | Light | components/Almanac/OwnershipFace.tsx:897 | The Ownership (and Strategy) chart's ₿ axis rounds its ticks to one decimal, so a small stack's axis reads "0.0₿ \| 0.0₿ \| 0.1₿ \| 0.1₿ \| 0.1₿". | Choose the tick decimals from the domain's span (2–3 dp under 1 ₿). |
| 35 | A4-10 | Minor | Light | components/Viewer/goalTileView.ts:28 | The Dashboard's goal tile (and Settings → Your plan with a goal set) prints a dust net-coins debt as a negative zero — "−₿0.000 of ₿1.000", read aloud "minus 0.000 bitcoin" —… | Apply goalNowView's '-0.000' → '0.000' rule inside goalPair (once), so the… |
| 36 | A5-4 | Minor | Heavy | hooks/useNostrAutoRestore.ts:24 | On a nip07/nip46 reload of a device that has not loaded its plan, 'Loading your plan…' never shows: optimistic auth renders the app before syncNow reaches firstPullStarts. | Call firstPullStarts (or a 'pending' mark) before syncNow's first await, o… |
| 37 | A5-5 | Minor | Heavy | api/_lib/ownerAuth.js:19 | The Strike proxies accept a NIP-98 token dated in the future for as long as its date stays ahead of the server's clock — the 60-second window bounds age only. | In validateOwnerRequest, also reject `event.created_at > now + 60` (unpack… |
| 38 | A5-6 | Minor | Heavy | lib/nostr/proxyAuth.ts:11 | The NIP-98 token cache never hits in use: it is one slot shared by the two URLs signed together each poll, and its 50 s life is shorter than the 60 s poll. | Key the cache by `${method} ${url}` in a Map and either poll under the tok… |
| 39 | A5-7 | Minor | Light | lib/demo/demoSeed.ts:1 | demoSeed.ts's header says the seed runs 'On the PUBLIC deploy (VITE_DEMO=1)' — the deploy where, since C1, VITE_DEMO must never be set because real users live there. | Change the header to 'On the SANDBOX deploy (personal-bloc-demo, VITE_DEMO… |
| 40 | A5-8 | Minor | Light | hooks/useStrikeData.ts:90 | useStrikeData's `active` guard never trips: the effect passes the flag by value, so a poll in flight when the effect is torn down still writes the Strike fields. | Pass a getter or ref (`() => active`) or an AbortController signal into fe… |
| 41 | A6-2 | Minor | Light | e2e/numberFieldSwipe.spec.ts:106 | The HELD e2e passes only by retry: its one tap on "Strike Strategy" ~0.3 s after the CDP touch swipe sometimes gets no click from Chromium, and the test neither waits for the… | At L106 re-open the subpage with `click()` (the step tests the held figure… |
| 42 | A6-3 | Minor | Light | simulation/__tests__/goalAmount.test.ts:193 | G3 adds timeouts to three sweeps but misses slower ones with no timeout of their own: goalAmount L193 (2.6 s) and cyclingSimPolicy L1412 (1.3 s) outlast placement L108 and cr… | Add goalAmount.test.ts L193 (closing L208) and cyclingSimPolicy.test.ts L1… |
| 43 | A6-4 | Minor | Light | simulation/__tests__/cyclePath.test.ts:68 | The exp∘log canary is the one test in 1,830 that fails when approximated Math moves by one ulp: an exact `toBe` on `Math.exp(Math.log(CYCLE_LOW_MULT))`, the shape general.md'… | Pin the shortcut directly (spy Math.exp to return 1 ulp off; cycleMultAt a… |
| 44 | A6-5 | Minor | Light | components/Auth/NostrAuthGate.tsx:693 | No unit test names 68 of the 117 component files (not 74), and the riskiest of them carry sentences a wiring test could pin, starting with the at-rest copy general.md says on… | One source-reading test: grep src/components for at-rest claims about plan… |
| 45 | A6-6 | Minor | Light | simulation/__tests__/goalAmount.test.ts:301 | The assertion labelled "KEPT non-vacuous on both sides" cannot fail: `expect.any(Number)` accepts a zero count. | Delete L301 (L302 is the check) or make it `toBeGreaterThan(0)` on each si… |

**Refuted and dropped: 0.** Each finding's evidence and the verifier's re-check are in `audit-<A>-verified.json`.

**The screen scan (A4):** 137 screens at 390 px, 168 at 1280 px; faces: ◔ Halving Clock, ₿ Cycle Clock, ⛏ Mining, ₿ Power Law, 丰 Sats, 🚨 Emergency, ▤ Ledger, ⚖ Scenario, ♻ Cycling, ⚖ Ownership, ◈ Strategy, ◆ Decision. Sideways scroll: none. Broken text: none. Console errors: Failed to load resource: net::ERR_FAILED @ https://api.coinbase.com/v2/prices/BTC-USD/spot (benign: The scan's own hermetic stub aborts the live quote (as e2e/controlDock.spec.ts …); [vite] failed to connect to websocket. … (browser) localhost:5181/ <--[WebSocket (failing… (benign: Caused by the scan's own over-broad page.routeWebSocket(/.*/) closing Vite's HM…).
E1's console allowance as verified: "Failed to load resource: net::ERR_FAILED (https://api.coinbase.com/v2/prices/BT…" — The hermetic stub (controlDock.spec.ts L20) aborts the live quote and Chromium logs every aborted f….

**The e2e flake (A6):** A test race in numberFieldSwipe.spec.ts HELD (L97): after the CDP touch swipe the test waits only for the menu row (L104), then taps it once (L106) and reads the field (L107) without confirming the subpage opened. The tap that follows the swipe sometimes produces no click, so SettingsRow onClick (SettingsMain.tsx:482) never runs and the menu stays up. Not an app defect. The exact Chromium mechanism is unconfirmed, as A6 says. — verifier: CONFIRMED.

## 4. The docs check (almanac.md whole; file-structure.md 1–1506)

| Piece | Lines | TRUE | STALE | FALSE | HISTORY | UNCHECKABLE |
|---|---|---|---|---|---|---|
| AL-1 | almanac.md 1-399, 400-882 | 343 | 10 | 3 | 30 | 17 |
| AL-2 | almanac.md 883-1211, 1212-1504, 1505-1666 | 319 | 0 | 1 | 33 | 33 |
| AL-3 | almanac.md 1667-2046, 2047-2362, 2363-2500 | 325 | 3 | 1 | 16 | 27 |
| FS-1 | file-structure.md 1-471, 472-852 | 381 | 7 | 6 | 13 | 7 |
| FS-2 | file-structure.md 853-1241, 1242-1506 | 378 | 5 | 1 | 17 | 14 |
(the checkers' counts, before verification)

**Verified:** 25 STALE lines confirmed, 12 FALSE claims confirmed, 0 reclassified, 0 refuted. TRUE sample: almanac.md 20 checked, 0 wrong; file-structure.md 20 checked, 0 wrong.

### 4.1 STALE lines — the corrections Stage 2 would make (pointer only, in place)

| Doc:line | Claim | before → after | Evidence |
|---|---|---|---|
| almanac.md:381 | the liquidated branch must survive being appended to the ca… | `(three unit cases pin it)` → `(four unit cases pin it)` | The M10 describe in cyclingFaceView.test.ts:760-787 has FOUR cases (7… |
| almanac.md:397 | cyclingSim.test.ts (26) | `cyclingSim.test.ts` (26)` → `cyclingSim.test.ts` (100)` | grep -cE '^\s*(it\|test)\(' src/simulation/__tests__/cyclingSim.test.t… |
| almanac.md:397 | powerLaw.test.ts (10, all RELATIONAL against a fixed UTC da… | ``powerLaw.test.ts` (10, all` → ``powerLaw.test.ts` (18, all` | grep -cE '^\s*(it\|test)\(' src/simulation/__tests__/powerLaw.test.ts … |
| almanac.md:412 | btcGained(row, base, rowPriceOverride?) → {gross, net} | ``{gross, net}`` → ``{gross, yours}`` | The field is now `yours`, not `net`: BtcGain {gross, yours} (cyclingF… |
| almanac.md:457 | FACES now covers all three engine faces (Cycling, Ownership… | `covers **all three** engine faces (Cycling, Ownership, **UnifiedFace.…` → `covers **all four** engine faces (Cycling, Ownership, **UnifiedFace.t…` | resetMirror.test.ts:20: const FACES = ['CyclingFace.tsx', 'OwnershipF… |
| almanac.md:470 | useStressLens ... (both faces) | `, both faces)` → `, all four engine faces)` | useStressLens( is called by four faces: CyclingFace, OwnershipFace, U… |
| almanac.md:500 | Its expected-callers list now names THREE faces (Cycling, O… | `names THREE faces (Cycling, Ownership, UnifiedFace)` → `names FOUR faces (Cycling, Ownership, UnifiedFace, DecisionFace)` | stressAnchor.test.ts:104-115: 'all four engine faces (Cycling, Owners… |
| almanac.md:528 | cyclingFaceView.test.ts (19) | ``src/components/Almanac/__tests__/cyclingFaceView.test.ts` (19)` → ``src/components/Almanac/__tests__/cyclingFaceView.test.ts` (136)` | grep -cE '^\s*(it\|test)\(' src/components/Almanac/__tests__/cyclingFa… |
| almanac.md:585 | Wired (real-cold spec v1): all three engine faces pass getC… | `all three engine faces pass` → `all four engine faces pass` | Four engine faces pass it: CyclingFace.tsx:213, OwnershipFace.tsx:236… |
| almanac.md:605 | the Cycling cold split adds a `− ₿X retrieved for the top-u… | ``− ₿X retrieved for the top-up`` → ``− X ₿ used to defend the loans`` | The row's copy is now '− X ₿ used to defend the loans' (cyclingFaceVi… |
| almanac.md:2162 | the crash row's console link appears only when `hasCbLoan &… | ``hasCbLoan && ltvTriggered`` → ``consoleRuns`` | DecisionFace.tsx:827-829 the link renders on {consoleRuns && …}; cons… |
| almanac.md:2265 | resetMirror's cold regex is /\bopeningColdBtc: (?:[^,\n]*? … | ``/\bopeningColdBtc: (?:[^,\n]*? : )?s\.openingColdBtc\b/`` → ``/\b(?:openingColdBtc\|coldBtc): (?:[^,\n]*? : )?s\.openingColdBtc\b/`` | resetMirror.test.ts:74 regex is now /\b(?:openingColdBtc\|coldBtc): (?… |
| almanac.md:2445 | AlmanacConsentSheet: createPortal scrim/sheet mirroring Eve… | `(createPortal scrim/sheet mirroring` → `(the shared `DraggableSheet`, as` | AlmanacConsentSheet.tsx:1,21 wraps the shared DraggableSheet (P1), as… |
| file-structure.md:99 | placement.ts — PURE LEAF: supportPolicy + cbDefense + cbMet… | `+ emergencyModel + ltv.` → `+ emergencyModel + ltv + goal.` | src/simulation/placement.ts:14 `import { goalOf, netCoinsBtc, atGoalO… |
| file-structure.md:150 | cyclingSim.ts — §2 wall side B: imports ONLY … + the zero-i… | `the zero-import ltvOf (./ltv) +` → `the zero-import ltvOf (./ltv) + the zero-import ./goal +` | src/simulation/cyclingSim.ts:7 `import { netCoinsBtc, atGoalOf, goalO… |
| file-structure.md:149 | cyclingSim imports from runCoinbaseLoan 'CB_LLTV/CB_LIF/cbB… | `fee-bracket constants (runCoinbaseLoan, a leaf)` → `fee-bracket inverse cbMaxDrawForHeadroom (runCoinbaseLoan, a leaf)` | src/simulation/cyclingSim.ts:1 imports `CB_LLTV, CB_LIF, cbBorrowFee,… |
| file-structure.md:149 | cyclingSim imports 'defendCbLtv/topUpToCbLtv (cbDefense)' (… | `defendCbLtv/topUpToCbLtv (cbDefense)` → `defendCbLtv/topUpToCbLtv and the other defense leaves (cbDefense)` | src/simulation/cyclingSim.ts:2-5 imports defendCbLtv, topUpToCbLtv, t… |
| file-structure.md:214 | openingColdBtc is WIRED from the three engine faces (real-c… | `WIRED from the three engine faces` → `WIRED from the four engine faces` | Four faces pass it: DecisionFace.tsx:321, UnifiedFace.tsx:205, Owners… |
| file-structure.md:491 | useRelayStatus probes only the urls passed in (SettingsMain… | `settingsPage==='network' ? nostrRelays` → `settingsPage==='network' && !backupGated ? nostrRelays` | src/components/Settings/SettingsMain.tsx:258 `useRelayStatus(settings… |
| file-structure.md:636 | demoSeed.ts — Imports ONLY utils/format + type-only shapes | `Imports ONLY utils/format + type-only shapes` → `Imports ONLY utils/format, lib/storeVersion, simulation/runCoinbaseLo…` | src/lib/demo/demoSeed.ts:15-18 — imports toLocalISO (utils/format), C… |
| file-structure.md:989 | futures.worker is 'a precache entry (8 since)' — the precac… | `(8 since)` → `(14 at c7f709e)` | git show 0228baf (the line's origin) wrote 'the precache, which is **… |
| file-structure.md:1327 | PassphraseInput adopted at ALL 16 RENDERED masked fields | `ALL 16 RENDERED` → `ALL 18 RENDERED` | grep -rn '<PassphraseInput' src (non-test) by file: NostrAuthGate 5, … |
| file-structure.md:1328 | NostrAuthGate's masked fields: remediation encrypt · ncrypt… | `NostrAuthGate (remediation encrypt · ncryptsec unlock · PIN · Confirm…` → `NostrAuthGate (remediation encrypt · saved-key PIN unlock · ncryptsec…` | NostrAuthGate.tsx has 5 PassphraseInputs: :608 remediation encrypt (b… |
| file-structure.md:1331 | the list of hosts ends at SharingPage (PIN) — LocalUnlockGa… | `SharingPage (PIN).` → `SharingPage (PIN), LocalUnlockGate (PIN).` | LocalUnlockGate.tsx:75-81 <PassphraseInput className={styles.input} i… |
| file-structure.md:1336 | 'One default beats 16 chances to forget one' — the count of… | `beats 16 chances` → `beats 18 chances` | same count as L1327: 18 <PassphraseInput> sites rendered (grep by fil… |

### 4.2 FALSE claims — findings (never corrected here)

- **almanac.md:92** — "Simple mode: an inline FA book-solid SVG icon button (15px Daily / 16px Monthly, matching each view's existing grid ico…" — Both views now render the shared HeaderNavCluster (DailyModeView.tsx:226-232, SimpleModeView.tsx:132-139); its single Almanac button is a 15px SVG (H…
- **almanac.md:391** — "the Almanac's only *background* network call remains the consented useChainTip" — Other Almanac faces poll on their own: the Power Law face calls useBtcPrice (PowerLawFace.tsx:2,55), which fetches the spot price every 10 s (useBtcP…
- **almanac.md:404** — "cyclingFaceView.ts has a TYPE-only import of CyclingRow (from the engine)" — cyclingFaceView.ts:1-3 imports VALUES from the engine (allInEquity, baselineAllInEquity, neverDrawTie) beside the types, plus value imports from owne…
- **almanac.md:1333** — "Call tones: `capWarn` / `capTone` / Ownership's cap note map `sold` → red, `cured` → amber." — capTone (UnifiedFace.tsx:352-353: sold→styles.stateBad, cured→styles.stateWarn) and Ownership's cap note (OwnershipFace.tsx:729: sold→var(--red), els…
- **almanac.md:2456** — "owner-only block; viewers use the badge" — ViewerSettings.tsx:105-125 — viewers now have their own DEVICE "Live block height" switch (sets consent + enables), not only the badge | VERIFIER: CO…
- **file-structure.md:388** — "emergencyModel ⚠ NAMED FOLLOW-UP (not fixed here): runAdvisor (4 copies) + AdvisorMain (1 …) still open-code `x > 0 ? a…" — `grep -n '> 0 ?' src/simulation/runAdvisor.ts src/components/Advisor/AdvisorMain.tsx` → no hits; runAdvisor.ts:1-40 holds only getCurrentStrategyMont…
- **file-structure.md:473** — "useBtcPrice.ts — Coinbase API, 60s interval" — src/hooks/useBtcPrice.ts:7 `const POLL_MS = 10_000; // display refresh cadence` and :57 `setInterval(() => void fetchPrice(), POLL_MS)` — it polls ev…
- **file-structure.md:473** — "useBtcPrice syncs store on every fetch (gated by btcPriceMode)" — src/hooks/useBtcPrice.ts:38-47 — in 'live' mode it calls setBtcPrice only when the price moved ≥ STORE_SYNC_THRESHOLD 0.1% (:9) or STORE_SYNC_MS 60 s…
- **file-structure.md:528** — "usePointerDrag.ts — NO consumer yet (P0 is foundation-only; P1+ wire it)" — `grep -rln usePointerDrag src` (non-test) → src/components/ui/SwipeStrip.tsx, ui/DraggableSheet.tsx, ui/EdgeBackGesture.tsx, Daily/MonthEventsModal.t…
- **file-structure.md:541** — "useReducedMotion.ts — NO consumer yet (P1+)" — `grep -rln useReducedMotion src` (non-test) → ui/SwipeStrip.tsx, ui/DraggableSheet.tsx, ui/EdgeBackGesture.tsx, hooks/useCountTo.ts:2 (doc line 476 i…
- **file-structure.md:704** — "parseGoalInput(raw): empty → null (clears), an amount above zero → it, anything else → undefined (changes nothing)" — src/lib/planGoal.ts:39 `if (v === 0) return null;` — a typed 0 clears the goal (null), not undefined; pinned by src/lib/__tests__/planGoal.test.ts:26…
- **file-structure.md:1434** — "(AlmanacView mounts the adjacent faces during a gesture, null at rest — no heavy hooks on a peek) — present tense" — AlmanacView.tsx renders no SwipeStrip: grep -n 'SwipeStrip\|renderPane' AlmanacView.tsx → only :46 '…the horizontal swipe pager (SwipeStrip) was REMO…

## 5. G1–G3 and E1 — as planned, premises re-checked at c7f709e

Measured by the session in a scratch worktree (`/tmp/hardening-1/gate-scratch`), each file put back and md5-checked against the base.

- **G1 — ESLint skips `Claude outputs/`.** `eslint.config.js` L7's `ignores` is `['dist/**', 'dev-dist/**', 'node_modules/**', 'coverage/**', 'playwright-report/**', 'test-results/**']`: no `Claude outputs/**`. Red-first premise holds: a throwaway `Claude outputs/hardening-1/g1probe.js` (`const unused = 1;`) makes `eslint .` exit 1 ("1 problem (1 error)"). Planned as spec'd.
- **G2 — the gate type-checks the e2e.** A `tsconfig.e2e.json` built from `tsconfig.node.json`'s flags (lib `ES2023`+`DOM`+`DOM.Iterable`, `types: ["node"]`, `tsBuildInfoFile ./node_modules/.tmp/tsconfig.e2e.tsbuildinfo`, include `e2e/**/*.ts` + `playwright.config.ts`), referenced from `tsconfig.json`: `tsc -b` → **0 errors** (17 spec files + helpers). A planted `const __planted: number = "not a number"` in `e2e/helpers.ts` → `tsc -b` exits 2 (TS2322 + TS6133). Premise holds. Planned as spec'd.
- **G3 — three slow sweeps get 60 s.** The three tests named are sweeps with no timeout of their own: `placement.test.ts` L108 (20,001 positions — 1.10 s under the hunt's load), `supportPolicyView.test.ts` L505 (the "liquidated" case runs the whole reach grid — 1.15 s), `crashPlaybookView.test.ts` L569 (every card string — 0.75 s). Premise holds. Beside them: L523's exhaustive A5-path sweep (2.46 s, the file's slowest) already carries `20_000`. **A6-3 (confirmed) adds two slower sweeps with no timeout:** `goalAmount.test.ts` L193 (2.6 s) and `cyclingSimPolicy.test.ts` L1412 (1.3 s) — the reviewer may add them to G3 in the go message.
- **E1 — `e2e/everyScreen.spec.ts`.** `seedLoanAndGoto` is at `e2e/helpers.ts` L49; the stubs are `controlDock.spec.ts` L20–21 (inside `hermetic()`, L19–22: the Coinbase quote aborted, blockchain.info fulfilled); the sub-nav is ONE array, `visibleFaces` (`AlmanacView.tsx` L108–124) — 12 faces with the loan and a logged Ledger, fewer when gated — so the test can enumerate from it with a minimum count. A4's throwaway scan already did the walk (137 screens at 390 px, 168 at 1280 px, port 5181). The verified console allowance: the aborted Coinbase quote's "Failed to load resource: net::ERR_FAILED" (the hermetic stub itself). Its real defects are audit findings (A4-*), each a `test.fail()` case under K4-A. ⚠ Stage 3's "e2e twice" may meet the HELD flake (A6-2) on this VM: its fix is an edit to an existing test, which this run may not make (§1.2) — a call for the reviewer.

## 6. The agents run, and their tokens

33 agent transcripts (25 finished their job; 8 were stopped: the two A3 auditors, FS-3 and TS-1 within minutes of starting by the budget stop, and a first set of four verifiers replaced by leaner ones). Cost at Opus 5.5 list prices ($4 in, $20 out, $0.20 cache read; cache writes priced at $5/M); the session's own loop is not in it.

| Workflow | Agent | In | Cache write | Cache read | Out | ≈ $ |
|---|---|---|---|---|---|---|
| 059781db | survivors:HE | 0k | 122k | 2960k | 52k | $2.24 |
| 059781db | survivors:HJ | 0k | 73k | 936k | 18k | $0.91 |
| 059781db | survivors:HK | 0k | 67k | 930k | 15k | $0.81 |
| 059781db | survivors:HS | 0k | 145k | 2059k | 29k | $1.72 |
| 059781db | survivors:HY | 0k | 60k | 883k | 13k | $0.75 |
| 1b497115 | audit:A4 | 0k | 957k | 37632k | 116k | $14.63 |
| 1b497115 | audit:A5 | 0k | 284k | 24705k | 109k | $8.54 |
| 1b497115 | audit:A6 | 0k | 1564k | 36267k | 140k | $17.88 |
| 1b497115 | docs:AL-1 | 0k | 286k | 20661k | 71k | $6.98 |
| 1b497115 | docs:AL-2 | 0k | 316k | 30778k | 90k | $9.53 |
| 1b497115 | docs:AL-3 | 0k | 258k | 27627k | 77k | $8.35 |
| 1b497115 | docs:FS-1 | 0k | 285k | 27340k | 73k | $8.35 |
| 1b497115 | docs:FS-2 | 0k | 229k | 21729k | 67k | $6.84 |
| 1b497115 | docs:FS-3 | 0k | 59k | 1136k | 5k | $0.63 |
| 1b497115 | docs:TS-1 | 0k | 38k | 312k | 1k | $0.27 |
| 2902bee4 | audit:A1-inv | 0k | 671k | 26646k | 134k | $11.36 |
| 2902bee4 | audit:A1-seq | 0k | 987k | 22625k | 121k | $11.88 |
| 2902bee4 | audit:A2-one | 0k | 305k | 18622k | 86k | $6.96 |
| 2902bee4 | audit:A3-inv | 0k | 193k | 5324k | 16k | $2.36 |
| 2902bee4 | audit:A3-seq | 0k | 45k | 312k | 1k | $0.30 |
| 2902bee4 | plan:HE | 0k | 387k | 24869k | 128k | $9.47 |
| 2902bee4 | plan:HJ | 0k | 325k | 16573k | 102k | $6.97 |
| 2902bee4 | plan:HK | 0k | 335k | 19003k | 110k | $7.68 |
| 2902bee4 | plan:HS | 0k | 533k | 52295k | 134k | $15.81 |
| 2902bee4 | plan:HY | 0k | 313k | 22189k | 92k | $7.84 |
| 7f5d0b6b | verify:A1A2 | 0k | 149k | 2463k | 27k | $1.77 |
| 7f5d0b6b | verify:A4 | 0k | 87k | 2461k | 19k | $1.31 |
| 7f5d0b6b | verify:A5A6 | 0k | 80k | 2022k | 15k | $1.10 |
| 7f5d0b6b | verify:DOCS | 0k | 95k | 2149k | 19k | $1.29 |
| bc96e5a1 | survivors:HE | 0k | 69k | 1598k | 8k | $0.82 |
| bc96e5a1 | survivors:HS | 0k | 125k | 1775k | 8k | $1.14 |
| c99e5eb3 | verify:A1 | 0k | 101k | 682k | 3k | $0.71 |
| c99e5eb3 | verify:A2 | 0k | 56k | 962k | 3k | $0.53 |
| all | 33 agents | 4k | 9602k | 458525k | 1899k | $177.71 |

Since the budget message (23:48Z): the four agents then running finished (A1-inv $11.36, A2 $6.96, FS-1 $8.35, FS-2 $6.84 in all, part of it before 23:48), the four stopped stubs cost $3.56, the first four verifiers $3.20, and the nine lean verifiers $11.90.

## 7. The tree

- `git status --porcelain` in the main checkout: **empty** (`Claude outputs/` is git-ignored). Branch `claude/hardening-1` at `c7f709e`, nothing committed, nothing pushed, no PR.
- All 15 scratch worktrees under `/tmp/hardening-1/` are clean at the base (every probe deleted); no server or test left running.
- The run's records, all in `Claude outputs/hardening-1/`: `spec.md`, `mutants-{HS,HE,HJ,HY,HK}.json`, `results-*.json`, `survivors-*.json`, `audit-{A1-inv,A1-seq,A2-one,A4-one,A5-one,A6-one}.json`, `audit-{A1,A2,A4,A5,A6}-verified.json`, `docs-{AL-1,AL-2,AL-3,FS-1,FS-2}.json`, `docs-verified.json`, this plan.

## 8. Notes for the reviewer

- **How strong the verification is.** Hunt: all 105 GAPs carry a recorded input and differing base and mutant outputs from a batched probe run on the base and under the mutant (HS-01/HS-02 from the session's own probe); the verifiers spent 81 tool calls on 107 survivors, so the proposed assertions are drafts for Stage 2's writers to firm up against each rule. Audit: the lean verifiers re-ran evidence for about 28 of the 45 findings (A1 9/12, A2 6/9, A4 9/10, A5 1/8, A6 3/6); the rest were confirmed by re-tracing the code. None was refuted — a reason to weigh the traced ones, the five A2 Criticals first, before they reach the queue as Heavy calls. Docs: every STALE and FALSE re-checked; the 40-claim TRUE sample found 0 wrong.
- **Possible overlaps with §9 to rule on:** A4-1 (the seed 1.48 ₿ counted with the loan off) vs "the Coinbase leg with the loan off"; A4-8 ("$0 over 0 borrows — a blended 2.00%") vs "the zero-state words"; A2-8 (the minimum's MISSED chip) vs "Strike's minimum, two estimates"; A2-1 / A2-4 (readings ordered by ts, not date) sit next to "a typed loan balance gives way to an earlier same-day reading".
- **105 GAPs is more than one Stage 2 can test.** The planners aimed every mutant at behavior no test pins, so nearly every survivor is a real gap; the go message should pick (the two §5.1 gaps HS-01/HS-02 first, then the Heavy-lane ones). Each GAP's input, outputs and proposed assertion are in `survivors-<T>.json`.
- **Deviations from the spec, all measured, none touching the repo:** (1) the harness designates `batch-1` for this session; the spec's `claude/hardening-1` was used (local only). (2) Two tiers beyond the spec's two (T3 source readers, TSC) — no mutant was killed in either. (3) The budget stop used the harness's stop marker with the reason "budget stop", not the restore-failure kill. (4) The gate's e2e flake was re-run in isolation (3 targeted runs) beyond "e2e once". (5) A6 counts 68 components no test names, not 74.
- **Not done, by the budget stop:** A3's audit; 9 of 14 docs checkers and the docs completeness pass; 6 HK mutants; Stages 2 and 3.
