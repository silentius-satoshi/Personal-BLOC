# Chapter 07 — The Monthly Sign-off

*Part 2: Log (the journal) · The Personal ₿LOC Book*

Day events are the raw material. The month is the unit of account. Once a month, Personal ₿LOC asks you to stop, look at what the journal rolled up, and put your name on it. This chapter is about that ritual — how days become a month, what happens when the month is incomplete, and why the projection refuses to move forward until you have signed.

## A month is an anniversary, not 30.44 days

Before the rollup can run, the app has to answer a deceptively hard question: which month does July 1st belong to?

A strategy year starts on your `advisorStartDate` — whatever day you began, not necessarily the 1st. Month N spans from the (N−1)th anniversary of that date to the Nth. Start on June 1st and Month 1 is June 1 through June 30; July 1 opens Month 2. Start on January 31st and the February anniversary clamps to the 28th (or 29th), because February has no 31st. That is calendar arithmetic, the way a lender's statement cycle works.

The app did not always do it that way. An earlier implementation bucketed by day arithmetic — elapsed days divided by 30.4375, the average month length — and average months have a sharp edge: boundary days fall on the wrong side. With a June 1st start, July 1 is 30 elapsed days, and 30 ÷ 30.4375 floors to zero — so July 1st was bucketed into *Month 1*. The first day of your new month, filed under the old one. The bug surfaced in the owner's own ledger, in both the calendar grid and the sign-off, which is the kind of thing dogfooding is for.

The fix replaced the arithmetic with one calendar-anniversary function that every consumer now imports — the event bucketer, the calendar grid, the review sheet, and the "what month is it now" clock all share a single implementation, so they cannot disagree again. Entries already rolled under the old buckets are repaired by a one-shot reconcile that re-rolls only the months whose figures actually changed — including a subtle case where a boundary collateral move changed no visible field and had to be caught by comparing the collateral sum under the old and new clocks. And the reconcile honors a principle now stated once in repo law and inherited by every future fix: *a sign-off attests specific figures; any operation that changes a confirmed month's rolled figures reopens it.* If the repair moved your numbers, your signature comes off, and the month asks to be reviewed again.

## The rollup

Within a month, the rollup is deliberately boring. Flows sum: draws accumulate into actual expenses, buys into bitcoin bought (and their dollars into income deployed), paydowns into paydown, minimum payments into their own balance-neutral column. Strike-targeted deposits and withdrawals net into a collateral delta, reported beside the entry rather than inside it. Coinbase-targeted moves and Coinbase collateral readings are journal-only — they never touch the monthly entry, because Coinbase collateral is a reading, not a chain.

Stocks do not sum. The month's ending Strike balance, Strike LTV, and Coinbase figures come from the **latest balance reading in the month** — one snapshot of what the lenders' screens said, chosen by timestamp. Chapter 06's doctrine, applied at month scale: twelve flows and one photograph, and the photograph wins.

The rollup is a pure function. Give it the same journal and it returns the same month, every time, on every device — which is what lets two phones merge their journals and re-derive identical entries.

## Provisional months, loudly

What if a month has flows but no reading? You logged three draws and a buy, and never once typed what the screen said.

The rollup refuses to invent an answer. It borrows the *prior* month's last-read stocks as a placeholder and stamps the entry `provisional: true` — and the app says so everywhere the month appears. The reconcile banner changes copy: not "confirm your log" but "Month N needs a balance reading." The honest fix is thirty seconds: open the sheet, take a reading, and the provisional flag clears itself on the re-roll.

But sometimes the honest fix is impossible — you are backfilling last quarter and the historical screen is gone. So the review sheet offers **Confirm as provisional**: sign the month knowing its stocks are borrowed, with subtext that says exactly that. Confirmed and provisional are orthogonal flags — confirming does not clear provisional; only a real reading does. A month can be honestly signed and honestly estimated at the same time, and if the reading turns up later, adding it upgrades the month without ceremony. Loud honesty is the thesis: the app would rather show you a labeled estimate than a confident fabrication.

## Reconcile → review → confirm

The ritual itself takes a minute. When the current month's entry is unconfirmed, an amber banner appears above the ledger. **Review** opens the sheet: the rolled totals — drawn, bought, paid down, net, "from N day entries" — plus a short note on why reviewing matters. Sign-off details ride along in the same write: expenses actually paid, the Strike minimum paid in income mode, the non-draw payment in roll mode. Then one of three exits: **Confirm** for a clean month, **Add balance reading** for a provisional one, or **Confirm as provisional** when the reading is beyond reach.

Confirm is one atomic write — the details land together with `confirmed: true`, nothing half-applied. And it is reversible in the honest direction: editing a confirmed month's events flips it back to unconfirmed and the banner returns, because the figures you attested are no longer the figures on file. Past months stay reachable through the ledger's month navigation, so a month you missed cannot hide from its own review.

One more thing the sign-off does, quietly: the signed month's ending Strike balance is carried forward as the next month's projection base. Chapter 08 picks that thread up.

## Only a signed month anchors the projection

The current month is a living thing. Its rollup re-derives on every event you log; its entry sits in the log with `confirmed: false`, changing shape daily. If the twelve-month projection anchored on it, the projection would wobble with every draw — and worse, it would treat a half-lived month as a finished one.

So the projection's start is computed from **confirmed entries only**. The advisor walks the log, keeps every signed-off month, ignores the living unconfirmed rollup, and starts projecting from the month after the last signature. No signatures yet? It starts from your configured baseline. The rule in the code is one comparison — `confirmed !== false` — and it is pinned by tests, because it carries the whole meaning of the ritual: *a month advances your plan when you say it happened, not when the calendar says it ended.*

That is what the sign-off buys you. Not bureaucracy — an anchor. Every projection in Chapter 08 stands on months you personally attested, read off the lender's own screen.

Personal ₿LOC is planning software, not financial advice; the months it rolls up are records of your decisions, not recommendations.

---

## From the code

- **Files:** `src/simulation/logUtils.ts` (`strategyMonthIndex`, `bucketEventToMonth`, `rollupMonth`, `priorStocksForMonth`, `sameRollupFields`, `strikeCollateralDelta`, `legacyBucketEventToMonth` — reconcile comparison only, `deriveAdvisorStart`), `src/simulation/runAdvisor.ts` (`getCurrentStrategyMonth`, `isStrategyComplete` — both delegate to the calendar clock), `src/components/Daily/ReviewSheet.tsx`, `src/components/Daily/DailyModeView.tsx` (banner, confirm handler)
- **Numbers:** months 1–12 from `advisorStartDate`, calendar-anniversary spans with short-month clamping · the retired legacy bucket divisor 30.4375 days · stocks from the latest `balanceReading` by `ts` · projection anchor = entries where `confirmed !== false`
- **Tests:** `dailyMode.test.ts` (Jun-1 start: Jun 30 = M1, Jul 1 = M2; Jan-31 start clamps Feb 28; rollup flows/stocks/provisional carry-forward), `dailyModeStore.test.ts` (boundary reconcile, idempotent second run, confirm + reopen-on-edit), `collateral.test.ts` (fixtures re-expressed in calendar terms)

*Related chapters: 06 (the events this rolls up), 08 (the projection the sign-off anchors), 13 (how the journal syncs).*

<!-- DRAFT v0.1 — Founder review -->
