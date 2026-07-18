# Chapter 01 — Introduction

*Introduction · The Personal ₿LOC Book*

## The core loop

```
Plan → Log → Defend
```

Every screen in Personal ₿LOC serves this loop, and the fastest way to understand the app is to walk one borrower through one month of it.

**Plan.** At the start of the month, the borrower's numbers are already set: collateral pledged, credit line, income, monthly expenses, the lender's APR. The engine has turned those into a twelve-month playbook — this month's planned draw, planned buy, planned paydown, and the projected LTV each move leaves behind. The current month operates; every other month projects. Nothing here is a promise. It is a model of the inputs, run against thresholds the borrower chose, and the playbook says what the plan expects — not what the borrower must do.

**Log.** Life happens, and the borrower journals it as it does. On the 3rd, a $2,400 draw from the Strike BLOC to cover expenses — one tap, one event. On the 12th, a buy: income converted to sats, logged in bitcoin with its dollar cost. On the 20th, price dips and the borrower makes a small paydown. Each time a flow is logged, the entry sheet also asks for the thing the app treats as ground truth: a **balance reading** — the loan balance and LTV read directly off the lender's screen, journaled with a date. The app never pretends to know the lender's ledger; flows are what happened between readings, and readings anchor everything. The moment a reading lands, the safety gauges move — not from arithmetic, from evidence.

Then the monthly ritual. On the month's anniversary the journal rolls the days up into a monthly entry and a banner asks the borrower to reconcile. Rolled totals on one side, the lender's screen on the other. If there is a fresh reading, the month confirms cleanly. If there are flows but no reading, the app will confirm the month only as *provisional* — and it says so, loudly, until a reading arrives. The sign-off freezes the month into the record, and the confirmed ending balance becomes the base the next month's projection stands on. The projection only ever anchors on a signed-off month.

**Defend.** All month, in the background, the readings have been driving the Safety Dashboard: three dimensions — credit used, Strike LTV, Coinbase LTV — each classified Safe, Watch, or Act by one shared classifier, alongside the liquidation price, the distance to it, and a crash lens showing every number at an 80% drawdown. Suppose the price falls hard on the 25th. The borrower's Coinbase LTV crosses the advisor's 75% trigger — well below Morpho's 86% liquidation line — and the app's bands fire before the lender's ever could. The emergency console opens with its doctrine already in the math: add collateral first, because growing the denominator pushes the liquidation price *down*; pay down as the fallback; and past those, the walls are named in advance — sale, then external cash. The console says by exactly how much. The borrower acts, logs the top-up with a fresh reading, and the gauges settle back toward green.

Then the month closes, the sign-off anchors the next projection, and the loop begins again. Plan, log, defend. Everything else in the product is in service of those three verbs.

## One voice, plain words

This book is written the way the app speaks: plain words, short sentences, numbers where numbers belong.

The app says **Recovery Key** and **12 words**. It does not say nsec, npub, or NIP-anything on a primary screen, and neither will this book outside its technical asides and the appendix. This is deliberate. Under the hood, your identity is a Nostr keypair and your sync rides encrypted events over Nostr relays — and the sovereignty chapters will explain exactly how, because how is the honest part. But a borrower checking liquidation distance at a gas pump should never need protocol vocabulary to understand their own safety screen. "Relays" appears in Settings, where you choose them; everything else stays in plain words. The protocol is plumbing. The pitch is the outcome: encrypted sync over open relays no company can shut off.

The same voice governs money talk. The app models; it does not advise. You will not find "you should" attached to a financial decision anywhere in the product or in this book. The app states what the numbers you entered do against the thresholds you set. What you do about them is yours.

## Who this book is for

**The Founder's own position, first.** The app is dogfooded daily against real loans, and every chapter here documents machinery the founder depends on. That is the credibility test each page has to pass.

**Strike BLOC and Coinbase/Morpho borrowers.** These are the two lenders the app models natively — Strike's 65/70/85 bands and 72-hour window, Morpho's instant 86% line — with manual entry covering any other bitcoin-backed loan. If you carry one of these loans, the playbook, the journal, and the dashboard were shaped around your exact numbers.

**Households, through viewer mode.** A partner or family member can watch the safety gauges without holding your keys and without the ability to change anything. The Safe tier goes further: it ships ratios and levels only — no dollar figure is even recoverable from what a Safe viewer receives, by construction. Someone you trust can see that the position is green without seeing what it is worth.

**Self-custodians who expect their records to work the same way.** If you hold your own keys, you already have the reflexes this app is built for: no accounts, no custodian, data encrypted before it leaves the device, an exit that is always open. Personal ₿LOC extends that stance from your coins to your plan — and, as BitBooks comes online beside it under the same Recovery Key, to your records.

## How to read this book

The book is organized by pillar — Part 1: Plan, Part 2: Log, Part 3: Defend — followed by Part 4 on sovereignty (keys, sync, sharing, backups) and Part 5 on the suite and how the project sustains itself. Each chapter ends with a "From the code" block naming the real source files, the exact constants, and the tests that pin the behavior — the book's claims are checkable, and that is the point.

If you are new, do not read front to back. Take the TOC's reading order: **Chapter 00** for what this is, **this chapter** for the loop, then jump to **Chapter 09** — the Safety Dashboard, the screen everything else feeds — then **Chapter 11**, where the crash test lets you feel liquidation approach with the app's real thresholds. Then come back to Part 1 and read the engines in order. Plan makes more sense once you know what Defend is protecting.

*Planning software, not financial advice. Bitcoin-collateralized borrowing carries liquidation risk — model it before you live it.*

---

## From the code

- **Files:** `src/simulation/` (the pure core: `runBLOC`, `runAdvisor`, `runCoinbaseLoan`, `safetyView`, `cbMetrics`, `strikeCredit`, `logUtils`), `src/store/` (the journal and rollup), `src/components/Layout/AppShell.tsx` (the gate ladder and viewer home), `src/pages/LandingPage.tsx` (the crash-test widget).
- **Numbers:** Strike 65% warn / 70% margin call / 85% partial liquidation (72h); Coinbase (Morpho) 86% LLTV, instant, ~4.4% penalty; advisor trigger/target/rotate-back defaults 75/65/55; emergency ladder 69/72/75/81; credit-used bands warn 75% / act 90%; crash lens = price × 0.2.
- **Tests:** the 850+ vitest suite — rollup and provisional-month invariants, the single-classifier safety view, and the confirm-anchored projection are each pinned by tests.

*Related chapters: 00 (what the app is), 07 (the monthly sign-off), 09 (the Safety Dashboard), 11 (Scenario Diff & the Crash Test), 12–14 (keys, sync, and viewer sharing).*

<!-- DRAFT v0.1 — Founder review -->
