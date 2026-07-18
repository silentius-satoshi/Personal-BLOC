# Chapter 08 — The Playbook

*Part 2: Log (the journal) · The Personal ₿LOC Book*

The Playbook is where the two halves of the app meet on one screen. Part 1's engines produce a twelve-month projection; Part 2's journal produces the record of what actually happened. The Playbook shows both — and the design problem it solves is keeping them honest about which is which. A projection wearing reality's clothes is how people get surprised in December.

## Twelve rows, one engine

Underneath the Playbook is the advisor engine: given your income, expenses, credit line, APR, thresholds, and the anchored starting position from Chapter 07, it emits one row per strategy month — the draw, the buy, the paydown, the Coinbase payment, the minimum payment, and the projected end-of-month LTVs on both loans.

A thin pure layer turns a row into a month plan the card can render. The arithmetic is deliberately closed: paydown is whatever income remains after the Coinbase payment, the bitcoin buy, and the Strike minimum, so a projected month always allocates income fully — every dollar has a job, and the card can show the split without a remainder line. The month summary is composed from the same numbers in plain English: "Draw $3,750 from your credit line for expenses. Buy $1,200 of Bitcoin. Pay the $310 Strike minimum from income."

A scrubber runs across the top — months one through twelve. Where you park it determines which of three voices the card speaks.

## Three voices: projected, operating, logged

**Every month that is not the current month projects cleanly.** Park the scrubber on Month 9 and you see the engine's unmodified forecast: full allocation, plan voice, imperative mood. Nothing you did in Month 3 edits Month 9's row directly; what happened only reaches the future through the anchor — the confirmed record moves the starting position, and the engine re-projects forward from there.

**The current month operates.** It is the only month where the controls are live — the operate-or-preview switch is a one-line predicate: is the selected month the current one? Here the Playbook shows the plan headline *and* the month-to-date reality beside it, read straight from the Ledger: "Draw: $3,750 ($1,200 left)" — the plan's figure with the journal's countdown in parentheses, plus a strip of what the Ledger holds so far ("$2,550 drawn · ₿0.011 bought · $500 paid"). When the month's entry is unconfirmed, a pointer says so — "Month N awaits sign-off in the Ledger" — and deep-links you there.

An honesty note about how the app got here, because the book documents the journey too. An earlier design computed a parallel "skip-adjusted reality" inside the Playbook itself — pay/skip pills, custom overrides, its own confirm sheet that wrote the month's entry. That made the Playbook a second writer of actuals, and two writers produced the inevitable bug report: *the amounts don't match.* The Logging Consolidation retired the whole apparatus. Today the Ledger is the sole writer of actuals and the sign-off is the sole confirmation; the Playbook renders and narrates, and its current-month reality is a read-only window onto the journal. One writer, one truth.

**Logged months are actuals.** Scrub back to a signed-off month and the voice flips to past tense: "You drew $3,800 for expenses. Bought $1,150 of Bitcoin." The figures are the journal's, not the engine's — what the projection *said* about that month no longer matters, because the month happened. The card does not average the two or annotate the variance into the row; the record simply replaces the forecast.

## Edits beat the projection — not the assumptions

The rule that keeps this coherent: **an entry's figures are authoritative over the projection, and neither touches the Settings assumptions.**

There are three layers of number in the app, and they never write each other. At the bottom, the Settings assumptions — the income and expense figures the engine projects from. In the middle, the projection — the engine's output, recomputed from assumptions and anchor on every render, never stored. On top, per-entry actuals — what the Ledger and the sign-off recorded for months that happened.

When you sign off a month, the sign-off details land on that month's entry: the expenses you actually paid, the minimum actually paid, the non-draw payment. Those figures override the projection everywhere that month appears — but they are *effective for that entry only*. Logging $4,100 of expenses in a $3,750-assumption month corrects the record; it does not silently rewrite the assumption and reshape your entire remaining year. The plan you agreed to stays the plan until you change it yourself, in Settings, on purpose.

The app will, however, tell you when reality and assumption have drifted apart. A pure helper watches the trailing three logged months of actual expenses against the static assumption; past five percent of drift it surfaces a nudge — *your last three months averaged $4,050; your plan assumes $3,750* — and once dismissed, it stays quiet until the average moves materially again. The choice to re-anchor remains yours. The projection is a model of your stated intentions; the record is a log of your acts; and only you promote one into the other.

## The carry

The bridge between record and projection is one number: the start balance. When you sign off the month that just ended, its ending Strike balance — a figure that traces back to a reading off Strike's own screen — is stamped as the next month's projection base. Month N+1's row now stands on Month N's attested reality, and every row after it re-projects from there.

The stamp is deliberately narrow. It fires only when the month being signed is the one immediately before the current month — signing off some older month you back-filled through the ledger's navigation must not clobber the live base. And it declines to write at all when a provisional month has no balance to give: a carry-forward month whose stocks were borrowed leaves the base untouched rather than planting an estimate under twelve months of projection. If a signed month later reopens because its figures changed, re-signing it carries the corrected balance. The projection base is either a number you attested or a number you typed — never a guess the app promoted on its own.

## Two playbooks, one engine

You will meet the Playbook twice in the app — as Simple Mode's "Monthly Playbook" card and as the Smart BLOC playbook inside the full advisor view — and they read as siblings because they are: the same engine rows, the same derivation, the same composed sentences, rendered at two zoom levels. Simple Mode gives you the scrubber, the two LTV bars, and the allocation dots; Smart BLOC surrounds the same months with the tier ladder, the rotation band, and the year-view tables from Chapter 04. Neither computes anything the other cannot see. That is the one-engine principle from Chapter 01 doing its quiet work: if the two playbooks ever disagreed on a number, that would be a bug, not a perspective.

What the Playbook adds up to is a discipline the lender's dashboard does not offer: the future stays clearly labeled as a projection, the past stays clearly labeled as a record, and the only door between them is a month you signed. Planning software, not financial advice — the playbook models the year you described; living it is up to you.

---

## From the code

- **Files:** `src/simulation/simpleModePlan.ts` (`deriveForMonth`, `isOperatingMonth`, `composeMonthSummary`, `minPaymentStatus`), `src/simulation/runAdvisor.ts` (`AdvisorMonthRow`, `getCurrentStrategyMonth`), `src/simulation/logUtils.ts` (`deriveAdvisorStart`, `computeExpenseReanchor`), `src/components/SimpleModeView.tsx` (the Playbook card, MTD strip, sign-off pointer), `src/components/Daily/DailyModeView.tsx` (the start-balance carry in the confirm handler)
- **Numbers:** projected months allocate income fully (paydown = income − CB payment − buy − minimum; fully-allocated tolerance < $1) · expense re-anchor nudge at > 5% drift over the trailing 3 logged months · min-payment status PAID/DUE/MISSED/ROLLS, due day 1–28 (default 15) · start-balance carry gated to signing month = current month − 1
- **Tests:** `simpleModePlan` coverage in the simulation suite (`deriveForMonth` full allocation, `composeMonthSummary` voices, `minPaymentStatus` matrix), `dailyModeStore.test.ts` (confirm + reopen-on-edit), `dailyMode.test.ts` (calendar clock the current-month predicate stands on)

*Related chapters: 04 (the advisor engine these rows come from), 06 (the Ledger that owns the actuals), 07 (the sign-off that anchors the carry).*

<!-- DRAFT v0.1 — Founder review -->
