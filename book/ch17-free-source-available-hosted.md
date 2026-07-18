# Chapter 17 — Free, Source-Available, Hosted Someday

*Part 5: Suite & Sustainability · The Personal ₿LOC Book*

A privacy app has to answer one question before any other: how does this stay alive without becoming the thing it warned you about? Personal ₿LOC's answer is a business posture as deliberate as its architecture, and this chapter documents it as shipped — one repo, three deploys, one honest pricing page with a single paid rung that does not exist yet and says so.

## One repo, three deploys

The app builds from a single codebase into three separate Vercel projects, split by build-time environment flags. Flags that are unset become dead branches and are tree-shaken out of the bundle — each deploy carries only the code its role needs.

**The owner deploy** is the private app: the Founder's own instance, running the real position the app models. It sets an owner pubkey, so signing in with any other key hits a private-app notice. It carries the owner-only Strike proxies, and it is byte-identical to the code everyone else can read.

**The public deploy** is the free real app, with the landing page as its front door. A visitor who has never onboarded sees the marketing landing at `/`; anyone who has finished onboarding — owner of their own plan, or a viewer — lands straight in the app at the same URL. The check is a single standalone localStorage key, read before the store even loads. Behind the landing there is no demo, no crippled tier, no owner lock: the full app, for everyone.

**The sandbox** lives on its own domain, and it is destructive by design. On every page load, a seed module rewrites the browser's local storage with a curated showcase plan — Month 8 of a twelve-month strategy, seven confirmed history months, a Coinbase LTV sitting deliberately in the watch band. The rewrite *is* the reset: reload and the showcase is back, untouched. That same rewrite would clobber any real plan sharing the origin, which is exactly why the sandbox gets its own domain and why the demo flag must never be set anywhere real users exist. Sign-up on the sandbox is impossible by construction: the seed plants no identity, no signer can exist without one, and every publish path checks for a signer. A visitor who tries to sign in with their own key hits the private-app notice instead — the sandbox domain cannot be quietly adopted as free hosting.

## The funnel, without auth plumbing

The landing's job is one honest gesture: the crash-test widget lets a stranger set up their own loan and drag the price down until liquidation, using the app's real thresholds — the widget imports the same band constants the safety dashboard does, so the demo literally cannot drift from the product. Every call to action then points at `/app`, where the ordinary onboarding fork — get started, restore a key, connect to a shared plan — *is* the sign-up and log-in surface. No parameters, no deep links, no new account machinery. There are no accounts.

## Why free is credible

The hero hint reads **"Free · No email · Your keys stay yours,"** and the pricing card says "Free, for now — use the full app while we build. Your plan is yours — export or leave anytime." Free claims usually hide a cost being recovered somewhere. Here the arithmetic is visible: the app is a static bundle with no backend. There is no server database, no per-user compute, no data warehouse to fund. Sync rides open relays; the three serverless functions are stateless proxies for public market data and the owner's own lender account, never a store. The marginal cost of one more user rounds to zero, so nothing about the free tier requires harvesting the user to pay for it. Free is not a promotional price; it is what the architecture costs.

## Source-available: FSL-1.1-MIT

The license at the repo root is FSL-1.1-MIT — the Functional Source License, version 1.1, with an MIT future grant. In plain terms, for a user: you can read every line of the app you are trusting with your plan; you can build and run it yourself; and each release converts to plain MIT after its term, so the code's future does not depend on the company's. What the license restricts is competing use — standing up the same product as a rival service — which is the trade that lets the source stay open while the project stays fundable. The claim that matters for this book is the user-facing one: nothing in Personal ₿LOC is a black box, and nothing about leaving is hard. Export the plan file, or restore from the 12 words on any build of the source — the data never belonged to the deploy.

Notice what the pricing page does *not* have: a self-host card. That is deliberate. Self-hosting is not a product tier here because sovereignty is the default — the source is there, the app is a static bundle, and hosting it yourself is a build command, not a subscription. What is sold is convenience.

## The one paid rung: Hosted

The pricing page shows exactly two cards. The first is the free app. The second is **Hosted**, and it is labeled COMING SOON in three places — a chip, the price line, and a deliberately inert button that does nothing when pressed. It is unpriced. It does not exist yet, and the page refuses to pretend otherwise.

What the card describes is a managed personal instance: auto-updates, a managed relay with backups, priority support — prepaid over Lightning, so even paying doesn't create an account, an email, or a billing identity. It is the manual-transmission user's valet: same car, someone else parks it.

The design constraint on Hosted is the same one that governs everything else in this book: **convenience, never dependence.** The app must keep working fully without it. A Hosted subscriber who stops paying keeps their key, their plan, their relays, and every feature — what lapses is the managed relay and the concierge, not the product. If a future version of Hosted ever made the free app worse, or made leaving harder, it would be a thesis violation, not a pricing decision. Until it ships, the honest description of Personal ₿LOC's business model is: the app is free, the source is readable, and one convenience is planned.

That is the whole posture. No ads, no telemetry to monetize, no data to sell — because there is no data held to sell. The funnel is a landing page that tells the truth, a sandbox that destroys itself, and an app that costs what it costs to serve a static file.

---

## From the code

- **Files:** `src/pages/LandingPage.tsx` / `.module.css` (landing, crash-test widget, pricing, footer) · `src/App.tsx` (the standalone onboarded-gate read) · `src/lib/demo/demoSeed.ts` (the origin-destructive sandbox seed) · `src/components/Layout/DemoBanner.tsx` · `LICENSE` (FSL-1.1-MIT)
- **Numbers:** three Vercel projects (owner · public+landing · sandbox) · widget bands green <65% / amber 65–75% / red ≥75%, liquidation at CB_LLTV 0.86 · gate key `personal-bloc-onboarded` · sandbox showcase: Month 8, 7 confirmed months, fixed price $115,000, CB LTV ≈ 71.7% (watch)
- **Tests:** the demo-seed unit test (buildDemoSeedState is pure and exported for it); publish-guard behavior pinned by the sync suite's signer checks

*Related chapters: ch11 (the crash-test widget's thresholds), ch12 (why there are no accounts), ch13 (relays and the no-backend claim), ch15 (export and leaving), ch18 (the refusals).*

<!-- DRAFT v0.1 — Founder review -->
