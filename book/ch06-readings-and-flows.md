# Chapter 06 — Readings and Flows

*Part 2: Log (the journal) · The Personal ₿LOC Book*

The Plan chapters described engines: pure functions that turn assumptions into a twelve-month projection. This part is about the other half of the loop — what actually happened. The journal is where Personal ₿LOC records reality, and it is built on one distinction that everything else in the Log pillar hangs on: **flows** are things you did, and **readings** are things you saw. The app never confuses the two, and it never lets one impersonate the other.

## Eight kinds of day event

The unit of the journal is the `DayEvent` — one dated, timestamped record of one thing. There are exactly eight kinds, and they split cleanly along the flow/reading line:

| Kind | What it records | Unit |
|---|---|---|
| `draw` | Dollars drawn from the Strike credit line for expenses | USD |
| `paydown` | Dollars paid against the Strike balance (reduces principal) | USD |
| `minPayment` | The Strike monthly minimum paid from income — balance-neutral | USD |
| `buy` | Bitcoin acquired (optionally with the dollars spent) | BTC (+ USD) |
| `deposit` | Bitcoin moved into collateral, targeted `strike` or `cb` | BTC |
| `withdraw` | Bitcoin moved out of collateral, targeted `strike` or `cb` | BTC |
| `balanceReading` | Balances and LTVs read off the lender's screen | mixed |
| `cbCollateralReading` | Coinbase collateral alone, read off the screen | BTC |

The first six are flows. The last two are readings. Every event carries an `id`, an ISO date, and a millisecond timestamp — the timestamp doubles as the merge version clock when the journal syncs between devices (union by id, higher `ts` wins, deletions are tombstones that expire after 90 days).

The `balanceReading` is the load-bearing one. It nests a snapshot: Strike balance and Strike LTV are always required — you read them off Strike; Coinbase balance, LTV, and collateral join when a Coinbase loan exists; Strike collateral, the Coinbase liquidation price, and the spot price at reading time are optional passengers.

## Balances are read, never computed

Here is the doctrine, stated once and enforced everywhere: **the app never computes your balance by summing your flows.** Your Strike balance is whatever Strike's screen said when you last looked, journaled with the date you looked. Same for LTV, same for the Coinbase side.

This sounds like a limitation. It is the opposite. A summed balance is a model of your account; a read balance *is* your account. Interest accrues on the lender's schedule, not the app's. Fees land, rates change mid-month, a payment posts a day late. Any app that chains flows into a running balance will drift from the lender's number, and an app whose whole job is defending an LTV cannot afford to drift. So Personal ₿LOC refuses to chain. Stocks come from readings; flows come from you; and the monthly rollup keeps them in separate columns.

The practical consequence is a habit: you open Strike, you open Coinbase, you type what they say. The app calls this "taking a reading," and it treats each one as an anchor — a dated fact the projection and the Safety Dashboard can stand on. Between two anchors, the flows tell the story of *how* the balance got from one to the other. Readings are the ground truth; flows are what happened between them.

Readings do more than feed the monthly log. The date-latest surviving reading also writes the live safety anchors — the Strike balance, Coinbase balance, and Coinbase liquidation price the Safety Dashboard reads — each stamped as-of its reading date, with a guard so a stale backfilled reading can never clobber a fresher anchor. Log a real balance from your couch and the gauges move in realtime. That seam is Chapter 09's subject; here it is enough to know a reading is never just a diary entry.

## Reading-anchored collateral

Collateral gets the same treatment, with one refinement. The current Strike collateral — the number the advisor seeds from and the dashboard divides by — is **reading-anchored**:

```
current Strike collateral =
  the latest strikeCollateral-bearing balanceReading (by date, then timestamp)
  + every deposit/withdraw targeted 'strike' strictly AFTER that anchor
```

The anchor is what Strike said you had pledged; the tail is what you have verifiably moved since. Two details in that definition are deliberate.

First, "strictly after" is by date first, timestamp second — and the timestamp comparison is strict. A backfilled deposit dated *before* the anchor is already inside the anchor's stated total, so it must not be re-summed. And an event sharing the anchor's exact timestamp is not counted either, because of the atomic write described below: the reading already states the post-move total.

Second — and this is the rule worth memorizing — **buys never pledge implicitly.** Buying bitcoin adds to your stack; it does not add to your collateral, because Personal ₿LOC has no idea where those sats landed. Cold storage, an exchange account, and a collateral vault are different places with different consequences. If a buy went straight into Strike's collateral, you say so with an explicit `deposit` — the event sheet offers a pledge toggle that emits the buy and the deposit together. No toggle, no pledge. Collateral changes are always explicit acts, never side effects.

## The atomic write

The event sheet — the bottom-sheet the orange + button opens — enforces the habit structurally. Logging a draw, a buy, a paydown, or a collateral move requires the "current balances" reading in the same sheet: type the flow, type what the lender's screen says now, save once. The sheet emits both events with distinct ids but a **shared date and timestamp**.

That shared timestamp is not cosmetic. It means the pair cannot tear: no merge, no sort, and no sync race can slip another event between a flow and its reading, and the collateral derivation's strict-timestamp rule reads the pair correctly — the reading states the world *after* the flow, so the flow is not double-counted on top of it. One save, one instant, one consistent truth.

The only reading-free flow is the minimum payment, and only because there is nothing to read: paying billed interest changes no balance. Everything else pays the toll. It costs perhaps twenty extra seconds per event, and it is the reason the journal's stocks column is never a guess.

## The minimum payment is balance-neutral

The `minPayment` kind exists to record a specific, easily-confused fact: paying the Strike monthly minimum from income. It is a real cash outflow — dollars left your pocket — but it pays billed interest, not principal, so it is **balance-neutral**: it rolls up into its own column (`strikeMinPaid`), never into `paydown`, and it never touches a balance. Stocks still come from readings. If minimums roll instead — capitalizing onto the balance — there is no event to log at all; the reading simply comes back a little higher. The event only exists in income mode, and its presence is itself the record of the source.

That precision matters downstream. The Playbook's status chips (PAID / DUE / MISSED / ROLLS), the sign-off's minimum-paid line, and the projection's income budget all key off this event without ever mistaking an interest payment for a principal reduction — a mistake that would flatter your LTV in exactly the month you least want flattery.

---

## From the code

- **Files:** `src/simulation/types.ts` (the `DayEvent` union, `DayEventKind`), `src/simulation/logUtils.ts` (`deriveStrikeCollateral`, `deriveCbCollateral`, `deriveReadingAnchors`, `strikeCollateralDelta`), `src/simulation/mergeRecords.ts` (journal merge: union by id, higher `ts` wins, tombstones), `src/components/Daily/eventSheetModel.ts` (`buildEventsFromSheet` — the atomic flow+reading pair)
- **Numbers:** 8 `DayEvent` kinds · LTVs stored as decimals (0.1483 = 14.83%), converted at the display edge · tombstone TTL 90 days · records channel debounce 400 ms
- **Tests:** `src/simulation/__tests__/strikeCollateral.test.ts` (anchor by date/ts, atomic same-ts pair not double-counted, backfill excluded, buys ignored), `dailyMode.test.ts` (rollup per kind, `minPayment` → `strikeMinPaid` only), `src/store/__tests__/collateral.test.ts` (reading-anchored `getCurrentBtcHeld` on the real store), `src/components/Daily/__tests__/eventSheet.test.ts` (shared ts, distinct ids, pledge ON/OFF), `readingAnchors.test.ts` (stale-reading guard)

*Related chapters: 07 (the rollup these events feed), 08 (the playbook that consumes the actuals), 09 (the anchors the dashboard reads), 19 (the full event and channel reference).*

<!-- DRAFT v0.1 — Founder review -->
