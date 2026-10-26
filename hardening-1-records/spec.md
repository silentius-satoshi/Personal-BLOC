# Personal ₿LOC — Hardening 1: the mutation hunt, the audit and the docs check — one ultracode run in a cloud session (spec v1.2)

**Status: v1.2 — re-based 2026-10-25 on `c7f709e` (builds 2c, 2d and 2e landed 2026-10-24/25), not yet run.** v1.2 re-measures the gate at the new tip, re-confirms the two gaps there (§5.1), adds the new view modules to H-S, the newest known issues to §9, the owner's steps as Appendix B, and corrects the docs count (§7.1). v1.1 added the docs check (§7), re-aimed the hunt after a second probe, added K6 and the leftover-credit plan (§12), and the cloud fallback for `/effort ultracode` (§0). v1.0 replaced Sweep 1 as the ultracode run; Sweep 1's other sixteen items — screens, words and docs — stay in `pbloc-spec-sweep-1-v1.md` §5 as a Light batch for ordinary sessions (§12). Paste this whole file as the first message of a Claude Code **cloud** session (§0). It runs in three stages and stops after Stage 1 for the owner's review.

**What it does, in one line:** it changes no app code. It plants realistic bugs in the money and data core — one at a time, in scratch copies — to find the rules no test would catch and writes those tests; it audits the whole app with every finding re-checked by a second agent; and it reads the reference docs every build depends on against the code, claim by claim.

**Why this and not a feature:** ultracode can't stop for a call mid-run, and the owner's builds are single-agent with a review between steps by design (BL30) — a face built unattended by many agents would be rebuilt after the owner's first look. What many agents do better than one, unattended, is check: plant, verify, cross-read. So the credit buys checking, and the features keep their process.

**Locked inputs:**
- **BL30's lanes.** Heavy — the plan's money math, Safety, sync, keys, backups and data formats — is never edited unattended. This run only *reads* the Heavy core and *adds tests* beside it: a new test can fail, but it can't change what the app does.
- **The repo's law:** `CLAUDE.md`, `.claude/rules/` — every rule row is a target — and `docs/claude/`.
- **Batch 1** (`batch-1`; spec `pbloc-spec-batch-1-v1.md` v0.24): builds 2b–2e are committed and pushed — `c7f709e` = `origin/batch-1`, 2026-10-25 14:05, every look passed — so the run has one base, `batch-1`'s tip, and nothing in flight to collide with (K1). Next in the batch is build 3, the FIRE face's engine: its plan can be written while this runs (plan mode is read-only); this branch merges into `batch-1` before build 3's commit, and that commit lands on top (Appendix B).
- **The work queue's backlog** — §9's known issues are never reported as new.

---

## 0. For the owner — the setup (done before this file is pasted; agents: context only)

1. **GitHub — a temporary lock** (2 minutes; the one hard guarantee). A cloud session can push to any branch, and auto mode doesn't block a push to `main`. Repository → Settings → Rules → Rulesets → New branch ruleset: target `main` and `batch-1`; rules Restrict updates, Restrict deletions, Block force pushes; bypass list empty; Active. Set it to Disabled whenever you push to `batch-1` yourself (FIRE build 3's commit, say), then back to Active while the run is live.
2. **A cloud environment** (claude.ai/code → environment selector → new), named `pbloc-hardening`:
   - Network: **Custom** — tick "Also include default list of common package managers", and add `cdn.playwright.dev` and `playwright.download.prss.microsoft.com` (Playwright 1.61.1's browser hosts; the Trusted list has neither).
   - Environment variables: `BASH_DEFAULT_TIMEOUT_MS=900000` and `BASH_MAX_TIMEOUT_MS=1200000` (the full vitest, the e2e and a mutant's run outlast Claude Code's 2-minute default).
   - Setup script (cached when it finishes in about 5 minutes):
     ```bash
     #!/bin/bash
     set -euo pipefail
     # Chromium for the e2e, at the repo's Playwright pin, with its system libraries
     npx -y playwright@1.61.1 install --with-deps chromium &
     # Node 26 beside the VM's Node 22 (CI's) — the Mac runs 26.12.0
     ( curl -fsSL https://nodejs.org/dist/v26.12.0/node-v26.12.0-linux-x64.tar.xz -o /tmp/node26.tar.xz \
       && mkdir -p /opt/node26 && tar -xJf /tmp/node26.tar.xz -C /opt/node26 --strip-components=1 && rm /tmp/node26.tar.xz ) &
     wait
     ```
3. **The session:** Claude desktop → new session → **Cloud** (not Local — only cloud sessions use the $250 credit) → repository `silentius-satoshi/Personal-BLOC`, branch `batch-1`, environment `pbloc-hardening`, permission mode **Auto**. Send, one message each: `/model opus`, then `/effort xhigh`, then `/effort ultracode`. If the session refuses `/effort ultracode` (a cloud session takes `/effort` only with a value, and the ultracode toggle may not be offered there), skip it and paste this file with the single word `ultracode:` as its first line — the keyword runs the task as a workflow all the same.
4. **Watch the spend:** the usage menu shows the credit left; `/workflows` shows each agent's tokens. Expected about $160–220 of the $250 (§10). If the credit left falls under $60 before Stage 2 ends, send: `Stop Stage 2 after the current commit; go to Stage 3.` The credit expires 2026-11-04, 11:59 PM PT.

---

## 1. Rules for every agent — binding in all three stages

### 1.1 How to work
- Read `CLAUDE.md` and `.claude/rules/general.md` first, then the rules file of every area you touch; grep `docs/claude/file-structure.md` for a file before reading it. After a compaction, read them again.
- Ground every claim in `file:line` at the base commit, with the command and its output. Observe; don't reason from memory.
- **The base** is the commit the session started on — `batch-1`'s tip, `c7f709e` or later. Stage 1 records it; every stage works from it, on the session's own branch (its name starts `claude/`).
- Mutants, probes and scratch scripts live outside the repo, in scratch worktrees under `/tmp/hardening-1/` (`git worktree add /tmp/hardening-1/<name> <base>`, then `npm ci` there — never a symlinked `node_modules`). Never commit a mutant; restore every mutated file from a copy and check its md5 (never with `git checkout` or `git restore`).
- The run's records live in `Claude outputs/hardening-1/` in the main checkout (git-ignored): `.md` and `.json` only (ESLint reads that folder until G1 lands).
- Fixtures are synthetic — round, invented numbers (the repo is public) — and nothing written carries an amount of the owner's.
- **CPU:** the VM has 4 vCPUs. At most two agents run tests at once; the full vitest and the e2e run alone. Before any e2e run nothing may listen on port 5173 (Playwright would reuse another worktree's server). Never set `CI`.

### 1.2 Never touch
- **Every existing source and test file**, except the exact lines G1–G3 name (§8). New test files only — so nothing this run writes can change a screen or collide with a later fix on `batch-1`. Docs change only in Stage 2's docs commits (§7).
- **The goal amount and its stand-down** need few mutants: builds 2 and 2b planted 140 between them (94 + 46), so the goal paths in `goal.ts`, `planGoal.ts`, `cyclingSim.ts`, `placement.ts` and `supportPolicy.ts` come last in H-E, at most five mutants, and no new test sets a goal on another target's fixtures.
- **The rules, `.claude/rules/**`:** read, never edited — a rule row the code contradicts is a finding for the owner (§7.3).
- **The platform:** `package.json`, `package-lock.json` (no new dependency — mutants are planted by hand, not by a tool), `vite.config.ts`, `playwright.config.ts`, `vercel.json`, `.github/**`.

### 1.3 Never do
- Edit app behavior, a test's expectation, a retry or a timeout (beyond G3); skip or `.only` a test.
- Write a test that pins today's output where today's output contradicts a rule or a doc: that is a finding, not a test (§5.4).
- Rewrite a doc's history, style or structure; delete a "History —" row or a "retired/DELETED" note (§7.2).
- Push anything but the session's own branches (their names start `claude/`); force-push; merge into or rebase `batch-1` or `main`; open, merge or comment on a pull request; tag; deploy.

### 1.4 Kill criteria — stop and report, never work around
- The base gate (Stage 1, step 3) isn't green.
- A mutant can't be restored byte for byte → stop the hunt; report the file and both md5s.
- A new test goes red on the base → it isn't a gap test; it's a finding — take it out and report it.

---

## 2. Stage 1 — discovery (read-only on the repo; commits nothing; then stops)

1. **Start:** confirm the branch name starts `claude/` (if it doesn't, create `claude/hardening-1` at HEAD and work there), the base commit, and `git status --porcelain` empty. Save this file verbatim to `Claude outputs/hardening-1/spec.md`.
2. **Tools:** `npm ci`; `node -v` (22) and `/opt/node26/bin/node -v` (26.12.0); `npx playwright --version` (1.61.1) and Chromium present. If Chromium is missing, E1 and the screen scan move to the owner's Mac; if Node 26 is missing, vitest runs on Node 22 alone — say so at the top of the plan.
3. **The base gate, once:** `npm run lint`; `VERCEL_GIT_COMMIT_SHA=local npm run build` (precache entries and KiB); `npx vitest run` on Node 22 and Node 26 (passed, skipped, files); `npm run e2e` once (passed, skipped, passed-on-retry). At `c7f709e`: lint 0; the build ok, 14 entries, 2,174.57 KiB (2,174.56 on Node 22); vitest 2,914 passed + 6 skipped, 190 files (Node 26 on the Mac and Node 22 on a mirror alike); e2e 115 passed + 2 skipped, twice, no retries (build 2e's report, `Claude outputs/batch-1/build-2e-report.md`).
4. **The hunt** (§5): plan the mutants from the rules, run them in scratch worktrees, classify every survivor.
5. **The audit** (§6) and its screen scan, and **the docs check** (§7), beside the hunt.
6. **The plan file:** `Claude outputs/hardening-1/stage-1-plan.md` —
   - the base and the gate table;
   - the hunt: mutants per target and per rule, killed / survived / skipped, seconds; every survivor with its class (EQUIVALENT, GAP, SUSPECT), its input, both outputs and the rule it touches; the GAPs proposed for tests, each with the new test file and test name it will get; the rules no mutant could break (named, with why);
   - the audit's verified findings, ranked;
   - the docs check: every STALE line with its correction, before → after; every FALSE claim as a finding; the counts per doc;
   - G1–G3 and E1 as planned, with their premises re-checked at the base;
   - the agents run and their tokens so far; `git status --porcelain` (empty).
7. **Print the plan in full as the last message, then stop.** Wait for the owner's go (Appendix A).

## 3. Stage 2 — the tests and the docs (after the owner's go, with the review's changes)

- **One target = one worktree = one commit** of new test files, subject `Hardening 1 · <target>: tests for <n> rules no test caught (<IDs>)`, one line. G1–G3 and E1 are their own commits (`Hardening 1 · gate: …`, `Hardening 1 · e2e: every screen`); the docs corrections one commit per doc (`Hardening 1 · docs: <doc> — <n> stale lines`). Light builders (G, E, docs) on Sonnet 5.5; the gap tests on the session's model.
- **Each gap test:** names the rule it pins (`.claude/rules/<file>` and the row's first words, or the `docs/claude/` section) in its title or a one-line comment; uses the GAP's input; is shown **red under its mutant and green on the base**, with both commands and outputs; uses synthetic round fixtures; holds exact goldens only for `+ − × ÷` (the general rule — a `Math.pow` input is stored, never recomputed). A new test under `src/components/` must also pass every wiring test that walks that folder (several read tests too) and never names a test-only engine input.
- **Each docs correction:** only a STALE line (§7.2), changed in place, the rest of the line untouched.
- **A verifier per target** — a fresh agent with only this spec, the GAP list and the commit: re-plants each GAP's mutant once and sees the new test red, restores it (md5) and sees it green, and checks each test asserts its cited rule rather than today's output. One fix round; a second fail drops that test, with the reason. The docs commits get one verifier for all: every changed line against the code, nothing changed beyond the list.
- **Integration, serial**, in the main checkout on the session branch: G first, then each target, then E, then the docs. Each commit is cherry-picked onto a throwaway integration worktree at the branch's tip and gated there — lint, the build, the full vitest (Node 22), and the e2e once after E. Green → cherry-pick it onto the session branch and `git push -u origin HEAD`. Red → it stays out, reported with the output. No `git reset --hard`, no history rewriting.
- **The run's own docs:** one last commit — `docs/claude/test-suite.md` gains each new file's entry (its tests and the rule each pins) and one "Hardening 1" entry with the suite before → after and the hunt's totals; `docs/claude/file-structure.md` gains the new files.

## 4. Stage 3 — the check and the report

1. **A whole-branch review** — a fresh agent (K6): the diff `<base>..HEAD` against §1 and the rules. It looks for: any change to an existing source or test file beyond G1–G3; a docs change beyond the STALE list; a test that pins today's output against a rule; a vacuous test (green under its own mutant); a fixture that isn't synthetic. Findings graded Critical / Medium / Minor; a Critical gets one fix round, else its commit is reverted (`git revert`) and reported.
2. **The final gate:** lint; `VERCEL_GIT_COMMIT_SHA=local npm run build`; vitest on Node 22 and Node 26; `npm run e2e` twice.
3. **The report** — `Claude outputs/hardening-1/report.md`, printed in full as the last message: the branch, base, HEAD and commits; the gate table, base and final; the hunt's totals (mutants, killed, equivalent, gaps tested, suspects); per new test file, its tests and the rules they pin; the docs lines changed (file — line — before → after); the review's findings; the audit's findings, the FALSE claims and the SUSPECT mutants, ranked, each with its lane; anything open.
4. Push the session branch one last time. Then stop.

---

## 5. The hunt

### 5.1 Why, and where
Each build plants bugs for the rules it adds — 8 to 94 in Batch 1's builds. What no build has done is sweep the older rules at once. **Measured while writing this spec**, on `3569b8d`: 23 realistic bugs planted by hand, each run against every test that imports its file (`vitest related`, a thousand tests or more each) — **20 caught, 3 not.** The two gaps below were planted again on `c7f709e` (2026-10-25): both still survive — build 2b's new `goalViews` test reads `fullyBackedPrice` only at zero collateral, where any formula gives 0.
- The recently swept core is tight: all 7 in `cbDefense.ts` (the crash defense), all 5 in `logUtils.ts` (the rollup, the venue default, the reading anchor's sign and its zero), all 4 in the backup and viewer whitelists (`settingsFields.ts`, `validatePlanBackup.ts`) — caught.
- The gaps are at the older edges, in `strikeCredit.ts` and `cbMetrics.ts`:
  - **GAP:** `strikeAvailableCredit`'s `fullyBackedPrice` — printed on the Ownership face ("the full line is backed again above $X") and the Advisor tab ("fully backed above $X") — has no test at all. On Strike's 65% cure level instead of its 50% draw line, a $40,000 line on 1 ₿ reads "backed again above $61.5k" instead of $80k, and the whole suite stays green.
  - **GAP:** `accruedCbBalance`'s `Math.max(0, …)`, which keeps a future as-of date from shrinking the Coinbase debt Safety reads, is pinned only by wiring tests that read its call sites: without it, every test passes.
  - Equivalent in effect: which limit "binds" at exactly equal limits (`<` → `<=`).

So the hunt aims at the edges, not the core: the modules and rule rows that predate the planted-bug era (before the support policy, September 2026), the figures a screen prints that no engine fixture reaches, and the viewer's scaled figures.

### 5.2 The targets, in priority order

| Target | Files (the goal paths excluded, §1.2) | Its rules |
|---|---|---|
| **H-S** Safety, the viewer's figures and the plan card's words | `src/simulation/{safetyView,cbMetrics,strikeCredit,runCoinbaseLoan}.ts`, `computeViewerSafety` and the safe snapshot's scaler, `src/components/Almanac/{planMonthView,supportPolicyView,decisionView,cyclingFaceView,ownershipFaceView,futuresView,coldCardView}.ts`, `src/components/Viewer/goalTileView.ts`, `src/components/Settings/coldStorageView.ts` (`numberInputModel.ts` last: build 2d planted 28 against it) | `engine.md`, `journal.md` (the cents row), `identity.md` (the viewer rows), `ui.md` |
| **H-E** the engine's older rules | `src/simulation/{cyclingSim,supportPolicy,placement,crashPlaybook,monteCarlo,planSearch}.ts` — the rows older than Policy v2 first | `engine.md` |
| **H-J** the journal's money | `src/simulation/logUtils.ts` (every export the probe didn't reach), `src/components/Daily/{calendarModel,dailyView}.ts`, the day-event mutators and the sign-off (`src/store/dailyRouting.ts`, `src/store/slices/advisorJournalSlice.ts`), `src/lib/ledgerCsv.ts` | `journal.md`, `store.md` |
| **H-Y** sync and the plan | `src/lib/planEvents/**`, `src/lib/nostr/**` except `keyVault.ts` (folds, merges, guards, size limits), the plan-load guard | `sync.md`, `store.md`, `general.md` (5c) |
| **H-K** keys, backups, viewers | `src/lib/nostr/keyVault.ts`, `src/lib/crypto/**`, `src/lib/backup/{exportPlan,validatePlanBackup,recoveryFile}.ts`, `src/store/settingsFields.ts`, `src/lib/store/wipeLocalPlanData.ts` | `identity.md`, `store.md` |

### 5.3 The mutants
- **From the rules first:** every row of a target's rules files gets at least one mutant that would break it. A row no mutant can break is reported as such ("not executable"), with why.
- **Then the boundaries and guards:** `>` ↔ `>=`; a dropped clamp, dust floor or `Number.isFinite` guard; a sign; a swapped constant (40% ↔ 50% ↔ 65%, 86%, the buffers); a swapped venue (Strike ↔ Coinbase ↔ cold); a month off by one; a rounding direction (floor ↔ round — the console floors by rule); a dropped `.slice()` or zeroing (keys); an inverted filter or strip list; a figure a screen prints computed from the wrong field.
- **One exact edit each,** written as `{ id, target, file, find, replace, rule }` in `Claude outputs/hardening-1/mutants-<target>.json`, `find` occurring exactly once (the probe's J4 — the reading anchor's ordering — occurs twice on purpose: such a rule gets one mutant per copy, or is reported).
- **Two tiers:** first the mutated module's own test files (seconds); a mutant that survives them gets `npx vitest related <file> --run --bail=1` (all the tests that import it, directly or not — 40 to 110 s each on 2 vCPUs). Survivors of both are survivors.
- **Caps:** 160 mutants in all — H-S 50, H-E 40, H-J 30, H-Y 20, H-K 20; a target that hits its cap reports what it skipped. The hunt is CPU-bound, not agent-bound: its runners share the two test slots (§1.1).

### 5.4 The survivors
A fresh verifier takes each survivor and classifies it:
- **EQUIVALENT** — no input can tell it from the base; say why in one line.
- **GAP** — an input where the base and the mutant differ, shown by running both, and the base follows its rule: a test is proposed (Stage 2).
- **SUSPECT** — the mutant matches the rules or the docs better than the base does: a finding for the queue, never a test.

---

## 6. The audit (Stage 1, beside the hunt; read-only; nothing built from it)

Evidence runs in scratch worktrees, never in the repo. The two highest-stakes areas get two independent auditors each — one tracing **invariants and boundaries**, one tracing **sequences over time** (months, sign-in and sign-out, devices on mixed versions, partial pulls, a backup from an older build) — and a judge merges their findings.

| Area | Auditors | Scope | Read first |
|---|---|---|---|
| A1 The engine and the money math | 2 | the engine, the support policy, THE MOVE, crash day, the futures | `.claude/rules/engine.md`, `docs/claude/engines.md`, `crash.md` |
| A2 The journal | 1 | day events, the rollup, sign-off, readings, the Ledger and its CSV | `journal.md`, `docs/claude/journal.md`, `daily-mode.md` |
| A3 Sync, keys, backups, viewers, privacy | 2 | `src/lib/nostr`, `src/lib/planEvents`, `src/lib/crypto`, the key vault, backups, viewer snapshots, amount-free logs | `sync.md`, `identity.md`, `store.md`, `docs/claude/nostr.md`, `recovery.md` |
| A4 Screens and words | 1 | sentences that can be false, a figure that disagrees with its word, NaN/∞/"$0" paths — plus the **screen scan**: a throwaway Playwright script visiting every screen at 390 and 1280 px for sideways scroll, console errors and broken text | `docs/claude/almanac.md`, `screens.md`, `ui.md` |
| A5 Start-up, offline, the platform | 1 | `sw.ts` and its precache, caching, the CSP in `vercel.json`, the fonts, `api/`, a phone's first load | `docs/claude/build-deploy.md`, `recovery.md` |
| A6 The tests themselves | 1 | goldens recomputed with `Math.pow`, e2e passing only by retry, sweeps near vitest's 5 s limit, tests whose name promises more than they check, the 74 components no test reads (no render harness by design — which of them carry a sentence or a figure a wiring test could pin) | `docs/claude/test-suite.md` |

- **A finding:** ID (`A3-2`), severity — **Critical** (a wrong money figure, a seizure or safety misstatement, data loss, a key or privacy leak), **Medium** (a false sentence, a figure that disagrees with its word, a guard that doesn't guard) or **Minor** — `file:line`, one sentence, the evidence (command and output, or the code path with values), why it matters, the lane a fix needs, a one-line fix sketch. At most 10 per area, ranked.
- **A fresh verifier per area** re-runs each finding's evidence and marks it CONFIRMED, REFUTED or UNVERIFIED with its reason. Refuted findings are dropped and counted.

## 7. The docs check (Stage 1 reads; Stage 2 corrects the stale pointers)

### 7.1 Why
`CLAUDE.md`, `.claude/rules/` (147 rule rows) and `docs/claude/` are what every Claude Code session reads before it changes a file — 13,110 lines of reference at `c7f709e`. A present-tense claim the code no longer bears out steers the next build wrong, and the owner's rule is that no drift piles up. **Measured on `c7f709e`:** the docs name 1,484 distinct code identifiers in backticks; 82 of them (5.5%) exist nowhere in the code — most on purpose ("History —", "retired", "DELETED" rows), which is exactly why only a reading check, not a grep, can tell drift from history.

### 7.2 What a checker does
One agent per doc — the three long ones (`almanac.md` 2,365 lines, `file-structure.md` 2,214, `test-suite.md` 1,963) split by `##` into pieces under 500 lines. For every checkable claim — a path, a `file:line`, an identifier, a count, a present-tense statement of behavior ("X reads only through Y", "Z never writes W") — it looks at the base and records `{ doc, line, claim, verdict, evidence, correction }`:
- **TRUE** — holds.
- **STALE** — the pointer moved: a renamed identifier, a line number that drifted, a file that moved, a count the code has since changed where the sentence itself still holds. The correction is the pointer alone, in place.
- **FALSE** — a present-tense claim the code contradicts. Never corrected here: a finding, with its evidence, for the owner's reviewer (the code may be what regressed).
- **HISTORY** — a row that says it is history, or a note of what was removed: left alone, whatever it names.
- **UNCHECKABLE** — a claim about a device, a lender or a decision: left alone.
Rules rows (`.claude/rules/*.md`) are checked the same way but never edited: their STALE and FALSE entries are both findings (§1.2).

### 7.3 Scope and caps
- **K5-A (default):** the docs the builds read most — `engines.md`, `almanac.md`, `journal.md`, `daily-mode.md`, `test-suite.md`, `file-structure.md`, `build-deploy.md`, `CLAUDE.md` and the eight rules files: about 14 checker agents and 4 verifiers (a verifier re-checks every STALE and FALSE entry, and a sample of 20 TRUEs per doc).
- **K5-B:** all 18 docs — about 22 checkers and 6 verifiers.
- The corrections land in Stage 2 (§3), one commit per doc.

## 8. The gate items and the e2e (from Sweep 1)

- **G1 — ESLint skips `Claude outputs/`.** `eslint.config.js` L7's `ignores` gains `'Claude outputs/**'` (flat config doesn't read `.gitignore`; a script left there once stopped a gate, and this run keeps its records there). Red-first: a throwaway `.js` with a lint error in `Claude outputs/hardening-1/` fails `npm run lint` before and passes after; delete it.
- **G2 — the gate type-checks the e2e.** A new `tsconfig.e2e.json` with `tsconfig.node.json`'s flags (lib `ES2023` + `DOM` + `DOM.Iterable`, `types: ["node"]`, its own `tsBuildInfoFile`), including `e2e/**/*.ts` and `playwright.config.ts`, referenced from `tsconfig.json`. Measured at `3569b8d` and again at `c7f709e` (17 spec files now): 0 errors under those flags, and at `3569b8d` a planted type error in an e2e file failed `npx tsc -b` with it.
- **G3 — three slow sweeps get 60 s:** `{ timeout: 60_000 }` on `placement.test.ts` L108, `supportPolicyView.test.ts` L505 and `crashPlaybookView.test.ts` L569 — 0.7–1.2 s each on an idle machine, with no timeout of their own against vitest's 5 s default; this run is the busy machine the queue named. No assertion changes. (None of the three files is one of build 2b's.)
- **E1 — `e2e/everyScreen.spec.ts`.** With the loan seed (`seedLoanAndGoto`, plus logged months if the Ledger face needs them) and the existing stubs (as `controlDock.spec.ts` L20–21): every Almanac face the sub-nav offers — enumerated from the sub-nav, so a new face is covered without editing the test, with a minimum count — and every simple-mode view at 390 × 844; every full-mode tab and Settings at 1280 × 800. On each: no sideways scroll (`scrollWidth ≤ innerWidth + 1`); no `pageerror` and no `console.error` beyond a listed allowance, each with its reason; no visible "NaN", "Infinity", "undefined" or "[object Object]". About 90 s at most; green twice, no retry. A real defect it finds is an audit finding (A4) and lands as a `test.fail()` case named for it, red the day it's fixed (K4). New file only.

## 9. Known issues — the queue already has these; never report them as new

- `toCents` rounds half cents down where the screen rounds them up — 65,614 of 1,000,001 half cents from $0.005 to $10,000.005; $3,037.50 at 15.52% gives $39.285, the to-do $39.29 and the review's field $39.28 (measured 2026-10-24; Heavy).
- The two GAPs of §5.1 (`fullyBackedPrice`, the accrual clamp) — this run's own tests close them.
- Sweep 1's other sixteen items — screens, words and docs (its §5; a later Light batch).
- Coinbase's two fields (Settings → Coinbase Loan; the Coinbase sidebar) show the balance and liquidation price as entered, not accrued, and the Safety editor starts from them; a figure re-typed or saved unchanged re-anchors it today [batch-1 spec v0.17 §2.2d]. Three other inputs save on leaving what they show (`SliderInput`'s tap-to-edit box, the goal field, the tier cards' custom collateral), and the goal field and that edit box don't save when the app goes to the background — build 2e fixed `NumberInput`'s plan settings only [batch-1 spec v0.17, v0.21]. Until the batch merges, the live app keeps the old behavior on those two Coinbase fields.
- Strike's minimum, two estimates; cents on the faces (BL19); the month log's edit form (unrounded values, "CB Balance" starting at 0).
- A re-signed old month moves the NDP date; a typed loan balance gives way to an earlier same-day reading; signed-out work merging into a key's plan; the escape hatch re-gating a verified key; the sync hook reaching Face ID on a locked phone; the roster's viewer counter; a second device's "Backed up ✓"; an undecryptable journal page.
- The policy-off engine's Strike leg (margin × 0.95); a trusted → safe downgrade keeping the trusted figures; the `records:v1` bridge and the other 5b/5c sync follow-ups; the Decision face reading only today's breaker offline.
- The never-draw verdict without a goal tying by float residue; simple mode's statement minimum writing 0; the zero-state words; a pledged buy's edit splitting it from its deposit; THIS MONTH, Daily and the Advisor tab fetching the whole history; the Coinbase leg with the loan off.
- The Emergency Console's boundary print and fixed stage ladder; Safety's amber title naming Coinbase for Strike; the Advisor's Coinbase card's balance; "Draw trigger LTV"; the plan's limit printed three ways; the expenses prompt's whole-dollar Keep; the two gain words; Strategy's slider head; the Decision chart's title; the four Settings overlays; `controlDock.spec`'s LAYOUT 1023 flake.
- Batch 1's logged items (builds 1, 2 and 2b) and the deferred list (a real-history backtest, a "gap persists" path, a percentile readout, Coinbase → Strike collateral, a variable Strike rate, 72-hour resolution, non-cycle modes under the policy, a "doomed next month" check).

---

## 10. Budget, models and concurrency

| Stage | Agents (at most) | Expected spend |
|---|---|---|
| 1 — base gate; the hunt (planner, 5 runners, 5 survivor verifiers); the audit (8 auditors, 6 verifiers, 1 judge); the docs check (14 checkers, 4 verifiers — K5-A) | 45 | $110–150 |
| 2 — gap tests (5 writers, 5 verifiers), G and E, the docs commits (3 writers, 1 verifier), integration, the run's docs | 18 | $40–55 |
| 3 — review, final gate, report | 3 | $10–15 |

- **Models (K6):** the session on Opus 5.5 at `xhigh`; Light builders (G, E, the docs commits) on Sonnet 5.5. Anthropic's list prices per million tokens: Opus 5.5 $4 in / $20 out / $0.20 cached; Sonnet 5.5 $2 / $10 / $0.10; Fable 5.1 $10 / $50 / $0.25.
- **Caps:** 66 agents and 160 mutants for the whole run; at most 4 agents at once and 2 running tests. A stage that would pass its cap stops and reports what's left.
- **The floor:** at $60 of credit left before Stage 2 ends, the owner sends the stop line (§0, 4); Stage 3 always runs, so the branch is reviewed and reported whatever was finished.

## 11. The owner's calls — answered before launch

The recommended answer is the default; a line above the pasted spec ("K2: B") overrides it.

- **K1 — When. A (default):** now, from `c7f709e` (builds 2b–2e committed, pushed and looked at). FIRE build 3's plan prompt can go out in parallel — plan mode is read-only — and this branch merges into `batch-1` before build 3's commit; a commit that lands first is no problem either: new files, three gate lines and docs pointers touch none of the FIRE face's code. **B:** after the FIRE face (builds 3–5) — about two weeks, past the credit's 2026-11-04 expiry: the hunt and the docs check are about old code and old docs, so waiting gains nothing and risks the credit.
- **K2 — The hunt's reach. A (default):** all five targets, in §5.2's order. **B:** H-S and H-E only — about $30 less.
- **K3 — The audit's depth. A (default):** two auditors on A1 and A3. **B:** one per area — about $15 less.
- **K4 — E1's discoveries. A (default):** each lands as a `test.fail()` case named for its finding. **B:** those screens stay out of the smoke.
- **K5 — The docs check. A (default):** the eight docs the builds read most, plus the rules. **B:** all eighteen — about $25 more. **C:** skip it.
- **K6 — The model for judgment. A (default):** Opus 5.5 throughout — more mutants, docs and findings per dollar, and every finding is verified twice anyway. **B:** Fable 5.1 (`fable`) for the eight auditors, the judge and the Stage 3 reviewer — about $40–60 more; take K5-A with it.

## 12. After the run — the owner's part, and the leftover credit

1. Stage 1's printed plan → the reviewer (this project), who checks the GAPs, the FALSE claims and the findings against the code and writes the go message (Appendix A).
2. Stage 3's printed report → the reviewer, who checks the branch's bytes, re-runs the gate and each GAP's mutant once on a mirror (red under it, green without), reads every docs line changed, and clears it — or doesn't.
3. **No preview look:** nothing on a screen changes. E1 runs headless.
4. The merge: the reviewer's git block brings the branch into `batch-1` (disable the ruleset first).
5. The queue: confirmed findings, FALSE claims and SUSPECT mutants join it, each in its lane — the Heavy ones as calls for you, with my measured prototype before any fix.
6. **The credit left** (likely $30–90): ordinary cloud sessions — no ultracode — for Sweep 1's Light families, one family per session in plan mode, each through the usual loop (plan → my review → build → my review → your preview look); a family costs about $10–20. In BL30's lanes: F (the formatters and the CSV) and W (the words) first. Any Claude Code session started as **Cloud** draws on the credit, whatever its model; the credit's only condition is the cloud.

Never in this run: an app-code change, the device gate, a merge, a deploy, BitBooks (paused, BL7).

---

## Appendix A — the go message (the reviewer fills it in)

```
Go: Hardening 1, Stages 2 and 3 — spec Claude outputs/hardening-1/spec.md (v1.2), on your Stage 1 plan (Claude outputs/hardening-1/stage-1-plan.md), base <sha>, with the review's changes:
- <change>
Test these GAPs: <IDs, or "all proposed">. Correct these docs lines: <IDs, or "all STALE">. Drop: <IDs, or none>. Calls: <K-answers if any differ from the defaults>.
If Claude outputs/hardening-1/ is gone (a fresh VM), first re-save the spec and the Stage 1 plan from this conversation, and run npm ci.
Print the Stage 3 report in full, push the session branch, then stop.
```

## Appendix B — the owner's steps, in order

Everything you do, start to finish. Steps 1–5 take about 20 minutes; the rest is waiting and two handoffs.

1. **GitHub ruleset** (§0, 1): `main` and `batch-1` locked against updates, deletions and force pushes. Active.
2. **The cloud environment** `pbloc-hardening` (§0, 2): Custom network with the package-manager list plus the two Playwright hosts; the two timeout variables; the setup script. Save.
3. **Start the session:** Claude desktop → new session → **Cloud** → `silentius-satoshi/Personal-BLOC` → branch `batch-1` → environment `pbloc-hardening` → permission mode **Auto**.
4. **Three messages, one at a time, each answered before the next:** `/model opus` · `/effort xhigh` · `/effort ultracode`. If the third is refused, carry on — step 5 starts the file with `ultracode:`.
5. **Paste this whole file** as one message. Above it, one line with your calls if any differ from the defaults (`K3: B`, say); with `/effort ultracode` refused, make the first line `ultracode:` instead. Send. The session confirms the base (`c7f709e` or later), runs the base gate and starts Stage 1; expect 3–6 hours. You can close the laptop.
6. **Meanwhile:** FIRE build 3's plan prompt may go out on your Mac as usual.
7. **When Stage 1 prints its plan and stops:** paste the printed plan here (this project). I check the GAPs, the FALSE claims and the findings against the code and give you the go message (Appendix A), filled in.
8. **Paste the go message** into the cloud session. Stage 2 and Stage 3 run on their own; expect 2–4 hours. If the usage menu shows under $60 of credit left before Stage 2 ends, send: `Stop Stage 2 after the current commit; go to Stage 3.`
9. **When Stage 3 prints its report and stops:** paste it here. I check the pushed branch's bytes on a mirror, re-run the gate and each GAP's mutant once, read every docs line changed, and clear it — or not.
10. **Merge:** disable the ruleset; run the git block I give you (it brings the session branch into `batch-1`); enable the ruleset again if another cloud run follows. If FIRE build 3 has committed first, the block says so and merges past it.
11. **The queue:** I file the confirmed findings, FALSE claims and SUSPECT mutants, each in its lane; the Heavy ones come to you as calls.
12. **Leftover credit, before 2026-11-04:** ordinary cloud sessions, no ultracode, for Sweep 1's Light families — one family per session, plan mode, the usual loop (§12, 6).

Nothing on a screen changes in this run, so there is no preview look.

Run: cloud session · Opus 5.5 · xhigh · ultracode · Auto mode

*End of spec v1.2.*
