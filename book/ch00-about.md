# Chapter 00 — About Personal ₿LOC

*Introduction · The Personal ₿LOC Book*

## Borrow against your bitcoin. Never sell.

That sentence is the headline on the landing page, and it is the whole premise. A bitcoiner with a stack and a monthly cost of living has two ways to pay for groceries: sell sats, or borrow dollars against them. Selling ends the position and triggers the tax. Borrowing keeps the stack intact — and puts a new number in your life: LTV, the ratio of what you owe to what your collateral is worth.

That number is a live wire. Coinbase's Morpho-backed loan liquidates instantly at 86% LTV — no margin call, no grace period, a penalty of roughly 4.4%. Strike's BLOC warns at 65%, margin-calls at 70%, and partially liquidates at 85% on a 72-hour window. The lender's dashboard will show you today's LTV. It will not plan your defense, rehearse the crash, or tell you in March that your December looks like a liquidation.

Personal ₿LOC exists to make that defense ordinary. It is planning and operating software for living on bitcoin-backed credit: it models the loans real bitcoiners actually carry — Strike's BLOC and Coinbase's Morpho loan, with manual entry for anything else — and it never touches your funds. It is planning software, not financial advice. The decisions, and the loans, are yours.

## What the app is

Personal ₿LOC is a shipped, running product — not a roadmap. It is a TypeScript and React progressive web app, a static bundle you install from the browser and run on your phone or desktop. There is no backend. There is no account, no email, no server database to breach. A key generated on your device is your identity, and the 12-word Recovery Key restores your plan anywhere.

If you turn on sync, your plan is encrypted to your key before it leaves your device and stored as ciphertext on relays you choose — open infrastructure no company can shut off. The relays never see a balance, an income figure, or a name. Sync is background repair, not a dependency: every change lands on your device first, and the app is fully functional offline.

The state of the code as this book is drafted: store version 21, more than 850 automated tests, an event-sourced plan core shipped through Phase 4d (the 4e bridge-stop awaits its soak), and three live deployments — the owner's instance, the public app behind its landing page, and a sandbox on its own origin. The source is available under FSL-1.1-MIT. The app is free: no email, no account, and your keys stay yours. The only paid rung on the pricing page is a Hosted tier — a managed personal instance, prepaid over Lightning — and it is marked COMING SOON because it has not shipped.

One more thing the app is: honest, structurally. A month logged without a balance reading is marked *provisional*, loudly. A freshly generated key syncs nothing — not even a pull — until you have proven you backed it up. A sync that fails says so instead of pretending. These refusals are code paths, not copy, and this book writes about them proudly.

## The three pillars

Everything in the product serves one loop — plan, log, defend — and each verb is a pillar.

**Plan.** Set your numbers — collateral, credit line, income, expenses — and the engine plans the year. Five strategy engines let you compare ways to live on bitcoin with identical inputs. An advisor turns the plan into priority tiers and a paydown band. The output is a twelve-month playbook of draws, buys, and paydowns: not advice, a model of the numbers you gave it against thresholds you set.

**Log.** The journal is where the plan meets what actually happened. Flows — draws, buys, paydowns, deposits — are events. Balances are readings you take off your lender's screen, journaled with a date, and they are the ground truth; flows are what happened between them. A month is not done until you sign it off, and the sign-off is what anchors the next month's projection.

**Defend.** The safety machinery: a dashboard with three dimensions — credit used, Strike LTV, Coinbase LTV — classified Safe, Watch, or Act by one classifier. Liquidation distance in dollars. A crash lens that re-renders every LTV at an 80% drawdown. And when the price falls, an emergency console whose doctrine is written into the math: grow the collateral first, pay down as the fallback, and know your walls before you need them. The app's bands fire before the lender's do. Defend your LTV before your lender does.

Every number on screen flows through one engine — the same shared functions feed the dashboard, the playbook, the ledger, and the emergency console — so they can never disagree. Numbers that disagree are treated as bugs, not display choices.

## The suite: one Recovery Key, two ledgers

Personal ₿LOC is one half of a pair. Beside it sits **BitBooks**, a records ledger for bitcoiners built on the same foundations: the same local-first design, the same encrypted sync over relays, the same house voice — and, critically, the same Recovery Key. One 12-word phrase, one identity, two ledgers: BitBloc for the borrowing, BitBooks for the records.

BitBooks is in build and pre-launch. The bridge between the two — where Personal ₿LOC's year lands in BitBooks as draft entries and readings become reconcile hints — is future work, gated on BitBooks' own milestones. This book marks future things as future: Chapter 16 is reserved for that bridge and stays visibly empty until the code runs, because the book only documents running code.

## Who made it, and why

Personal ₿LOC was built by a pseudonymous founder who lives on bitcoin-backed credit and wanted the software that did not exist: not a portfolio tracker, not a lender, not an advice engine — an operating desk for the position. The app is dogfooded daily. The owner's deployment runs the founder's real loans: real collateral, real draws, real monthly sign-offs, real LTV bars that go amber when the price drops. Every feature in this book was used in anger before it was written about.

That is also why the book exists. Personal ₿LOC is built in public, and this book is the deep half of that: a chapter-by-chapter account of what the app does and why, sourced from the repository's own law — its specs, its constants, its 850-plus tests. Nothing is claimed here that a test or a screen can't back.

The recurring verbs are plan, log, and defend. The recurring promise is: your keys, your plan.

*Planning software, not financial advice. Bitcoin-collateralized borrowing carries liquidation risk — model it before you live it.*

---

## From the code

- **Files:** `src/pages/LandingPage.tsx` (the public pitch, the crash-test widget), `src/components/Layout/AppShell.tsx` (the app shell and gate ladder), `src/simulation/` (the pure core the pillars run on: `cbMetrics`, `strikeCredit`, `safetyView`).
- **Numbers:** Strike bands 65% warn / 70% margin call / 85% partial liquidation (72h window); Coinbase (Morpho) LLTV 86%, instant, no grace, LIF ≈ 1.04384 (~4.4% penalty); store v21; 850+ tests; event-sourcing shipped through Phase 4d (4e pending soak); license FSL-1.1-MIT; Hosted tier COMING SOON, prepaid over Lightning.
- **Tests:** the 850+ vitest suite pins the shared-helper invariants ("one definition per number"); the landing widget imports the app's real band constants so its thresholds cannot drift.

*Related chapters: 01 (the core loop in detail), 09 (the dashboard everything feeds), 16 (the BitBooks bridge, future), 17 (free, source-available, hosted someday).*

<!-- DRAFT v0.1 — Founder review -->
