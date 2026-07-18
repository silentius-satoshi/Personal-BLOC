# Chapter 02 — Four Ways to Live on Bitcoin

*Part 1: Plan · The Personal ₿LOC Book*

If you hold bitcoin and have bills, you have four basic options. You can borrow against the bitcoin as hard as the line allows. You can borrow against it with a rule that pulls you back. You can sell some every month. Or you can hold cash and skip bitcoin entirely.

Personal ₿LOC models all four, side by side, from identical inputs. This is the Living on Bitcoin tab, and it is where most people should start — not because it tells you which strategy to pick, but because it shows you what each one actually does, month by month, in numbers you can argue with.

## One set of inputs, four engines

Every strategy runs from the same `LivingInputs`: your bitcoin holdings, a starting price, monthly income, monthly expenses, an assumed annual bitcoin growth rate, a loan APR, an inflation rate, a time horizon in months, and a capital-gains tax rate. Change one input and all four strategies recompute together. There is no way to feed one strategy a friendlier price path than another — the comparison is honest by construction.

Each engine is a pure function in `src/simulation/`: no UI, no store, no clock. Give it inputs, it gives back a month-by-month table. The four engines are `runMaxLeverage`, `runSmartBLOC_Living`, `runSellToLive`, and `runNoBitcoin`.

## What each one does every month

**Max Leverage** — labeled *Dangerous* in the app, on purpose. Every month it draws the full expense amount onto the line of credit. Interest is calculated on that post-draw balance and paid from income, so the debt grows by exactly your expenses, forever. It never pays anything down. Whatever income is left after the interest payment buys bitcoin. The stack grows fastest here, and so does the loan. Nothing in this engine ever asks whether the loan is getting dangerous — that is the point of modeling it.

**Smart BLOC** — labeled *Crash-Safe*. Same draw for expenses, but interest capitalizes onto the balance first, and then comes the rule: if the loan balance exceeds a set fraction of the collateral's value — the LTV ceiling — income pays the loan down before it buys anything. The paydown is `min(income, balance − collateralValue × ceiling)`: up to your entire month's income goes to defense if the ceiling is breached. Only what remains buys bitcoin. Chapter 03 is about this method in full; here it is one contestant among four.

**Sell to Live** — no loan at all. All income buys bitcoin; expenses are covered by selling bitcoin at that month's price. The engine tracks cumulative sales against the starting-price basis and applies your capital-gains rate to the gains. At the end of the horizon it sells enough additional bitcoin to settle the tax bill. No interest, no LTV, no liquidation risk — the costs here are the tax and the stack that walks out the door every month.

**No Bitcoin** — the baseline. Your holdings convert to cash at the starting price on day one. Every month, the surplus of income over expenses is added to the cash pile. The nominal balance never falls. It also never grows past what you save.

## Real versus nominal

Every engine reports two net-worth lines: nominal, and real. Real net worth is the nominal figure divided by cumulative inflation, compounded monthly from the rate you entered. The distinction matters most for the baseline: a cash pile that looks flat in nominal terms is quietly shrinking in real terms, at whatever inflation rate you believe in. The chart shows both so you can see the gap open.

## The yardstick: realReturn

Each of the three bitcoin strategies reports a `realReturn`, and it is computed against one fixed yardstick — the No Bitcoin baseline's final nominal balance:

```
realReturn = (finalNetWorthReal − noBtcFinalNominal) / noBtcFinalNominal
```

Read it as: after inflation, how did this strategy do against just holding the cash? A realReturn of 0.8 means you ended 80% ahead of the cash path in real terms. A negative number means the cash path won. The baseline exists to be beaten — or not. Under a bear-market input, "not" is a result the app will show you without flinching.

## The 80% crash stress test

Every leveraged strategy also reports a `crashLtv`: the final LTV divided by 0.20 — that is, the LTV you would have if the price fell 80% at the finish line. This is the same crash lens used everywhere in the app: multiply the price by 0.2 and re-ask every risk question.

This single number is usually where the argument between Max Leverage and Smart BLOC ends. A strategy that finishes at 14% LTV crash-tests to 70% — bruised, at Strike's margin-call line, but alive. A strategy that finishes at 35% crash-tests to 175% — the position was gone long before the bottom. Max Leverage frequently posts the best realReturn and a crashLtv that means the realReturn was never really yours. Sell to Live and No Bitcoin crash-test at zero, because you cannot be liquidated on a loan you do not have.

## The optional bear market

The growth-rate input assumes a smooth path, and smooth paths are how leverage models lie. So there is a bear-market toggle: enable it and the projection runs a declining phase — a period of months at an annual decline you set (the defaults model two years at −50% a year) — before growth resumes. All four engines share the same price path through the same `getBtcPrice` helper, so the bear hits everyone equally.

This is where the strategies separate for real. The baseline does not notice. Sell to Live sells more coins per month at worse prices. Max Leverage watches its LTV climb with no mechanism to answer. Smart BLOC's ceiling rule starts diverting income from buying to paying down — which is exactly the behavior the rest of this book operationalizes.

## What this chapter is not

The comparison tab is a model, not a recommendation. It runs the numbers you give it, under assumptions you chose, and reports what falls out. It does not know your risk tolerance, your job security, or your jurisdiction's tax law. Two people can look at the same four lines and rationally pick different ones — including the gray one.

*Planning software, not financial advice. Bitcoin-collateralized borrowing carries liquidation risk — model it before you live it.*

---

## From the code

- **Files:** `src/simulation/runMaxLeverage.ts`, `src/simulation/runSmartBLOC_Living.ts`, `src/simulation/runSellToLive.ts`, `src/simulation/runNoBitcoin.ts`, `src/simulation/livingUtils.ts` (`getBtcPrice`, bear-market aware), `src/simulation/types.ts` (`LivingInputs`, `StrategyResult`)
- **Numbers:** crash lens = price × 0.2 (`crashLtv = finalLtv / 0.20`) · `realReturn = (finalNetWorthReal − noBtcFinalNominal) / noBtcFinalNominal` · bear defaults: 2-year period, −50% annual decline · real net worth = nominal ÷ cumulative monthly-compounded inflation
- **Tests:** `living.test.ts`

*Related chapters: ch03 (the Smart BLOC method in full), ch09 (the crash lens live on the dashboard), ch11 (Scenario Diff & the crash test).*

<!-- DRAFT v0.1 — Founder review -->
