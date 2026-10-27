# The three deploys and the landing funnel (C1) — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Commercialization (C1 — landing-first funnel)

**Topology — ONE repo, THREE Vercel projects, split by build-time env flags.** C0 shipped landing + seeded sandbox on
one public deploy where a REAL sign-up was impossible (the demo seed re-writes `personal-bloc-store` on every load) and
sign-ins dead-ended (`VITE_OWNER_PUBKEY` → `PrivateAppNotice`). C1 makes the **public deploy the free real app** with
the landing as its front door, and moves the origin-destructive sandbox to its OWN project.

| Project | Env | Serves |
|---|---|---|
| owner (`personal-bloc`) | `VITE_OWNER_PUBKEY` only | the private app — byte-identical, untouched |
| public (`personal-bloc-public`) | `VITE_LANDING=1`, `VITE_REPO_URL`, `VITE_SANDBOX_URL` — ⚠ **NO** `VITE_DEMO`, **NO** `VITE_OWNER_PUBKEY` | landing at `/` (not-onboarded) · the real free app for everyone |
| sandbox (`personal-bloc-demo`) | `VITE_DEMO=1`, `VITE_OWNER_PUBKEY` (free-riding closure lives HERE now), `VITE_PUBLIC_SITE_URL` | seeded reset-on-reload sandbox |

Unset flags → dead branches, tree-shaken. `vercel.json` rewrites every path to index.html.

**The FIRE face is off the public deploy and the sandbox** (batch 1 build 4b — BL42): its pill shows only where neither
`VITE_LANDING` nor `VITE_DEMO` is '1' — the owner's deploy and dev — until its borrow lane ships, so the public app never
sees a sell-only face (F6). One pure rule, `fireFaceOnDeploy` (`src/lib/fireDeploy.ts`), read once in `AlmanacView.tsx`
(`almanac.md` § FIRE face). Hidden and unreachable there, not tree-shaken: the face's code stays in every bundle.

**Landing gating (`App.tsx`).** `VITE_LANDING === '1' && pathname === '/' && !onboarded` → `LandingPage`, else
`AppShell`. `onboarded` is read DIRECTLY from the standalone GATE key `localStorage['personal-bloc-onboarded'] === '1'`
(synchronous, try/catch; App must not couple to the store — the store's seed-reader IIFE reads the same key). So the
landing shows ONLY to a not-yet-onboarded visitor; a returning owner/viewer (or anyone who finished onboarding) lands
straight in their app at `/`.

**The funnel — no new auth plumbing.** Every landing CTA links `/app` → `AppShell` → `!onboardingComplete` →
`OnboardingModal` opens on the `ChoosePathView` fork (Get started / I have a plan or a key / Connect to a shared plan).
**That fork IS the sign-up/log-in surface** — no params, no deep links. Completing onboarding flips the GATE key to
`'1'` → `/` renders the app (landing skipped). ⚠ The landing's four internal `/app` CTAs use `window.location.replace`
(a shared `goApp` onClick that falls through on modified/middle clicks so new-tab opens still work) — NOT a pushed
anchor nav — so `/` is removed from history; plus a `pageshow(persisted)` belt re-reads the standalone
`personal-bloc-onboarded` GATE key and bounces to `/app` when onboarded. Both close a Safari edge-swipe-back
bfcache backdoor: a bfcache restore doesn't re-run App's onboarded branch, so without these an onboarded/viewer
device could restore the marketing landing over its app.

**Landing UI (C2 v2 — `LandingPage.tsx`/`.module.css`).** Nav bar (brand + "View source" + "Sign up / Log in" →
`/app`). Hero: two-line headline "Borrow against your bitcoin. / Never sell." (2nd line `--btc`) + the verbatim
sovereign-planner subtitle + primary "Get started — it's free" → `/app` + a "Try the sandbox" ghost rendered ONLY when
`VITE_SANDBOX_URL` is set (`SANDBOX_URL = env || null` — no fallback, a dead sandbox link is worse than none) + a
"Free · No email · Your keys stay yours" hint. **Crash-test widget** (`CrashTest`): two EDITABLE store-free fields —
collateral (₿) + borrowed ($), held as raw strings and coerced/clamped only at compute so mid-type clears don't snap —
plus a price slider; drag the price down to watch LTV, a Safe/Watch/Act (or LIQUIDATED) verdict pill, the gauge fill,
and a plain-English story line ("Liquidation at $X — bitcoin would have to fall N%…") all react. ⚠ The band math flows
through the REAL app thresholds (`barLevel`/`CB_WARN_LTV`/`CB_LLTV`/`LEVEL_COLOR` — imports unchanged) so the demo
can't drift from the app. **Below the widget (C3 v3 — sectioned):** eyebrow-labeled sections with vertical rhythm —
**Features** (title "Plan, log, and defend bitcoin-backed loans — private by design." + 3 cards, icons centered:
Safety dashboard · Monthly playbook · Censorship-resistant by design "encrypted sync over Nostr — open relays no
company can shut off"), **How it works** (3 columns w/ hairline dividers + one-line descriptions), **FAQ** (a
native `<details>`/`<summary>` accordion — zero JS, keyboard/a11y-free — 4 items), **Pricing** (`id="pricing"`, TWO
cards: Early access "Free / for now" → Get started; Hosted featured w/ a "COMING SOON" chip, unpriced "Coming soon" +
an INERT `aria-disabled` ghost CTA — **NO self-host card**), and a 3-column **footer** (brand + the
not-financial-advice **disclaimer** under it · Product links · Resources links incl. License → `${REPO_URL}/blob/main/LICENSE`
+ Nostr) with a bottom "© 2026 · Your keys, your plan" bar. The C0 pricing + FAQ sections returned here in v3.

**Sandbox is origin-destructive.** `src/lib/demo/demoSeed.ts` (imported FIRST in main.tsx, before the store's
module-init IIFEs read localStorage) writes a curated showcase plan on EVERY load — the re-write IS the reload-reset —
so it clobbers any real plan sharing the same localStorage. ⚠ **`VITE_DEMO` must NEVER be set on an origin with real
users** (that's the whole reason it gets its own project). The seed sets `onboarded=1` + a plan blob with **NO Nostr
identity**, so AppShell's ladder skips onboarding + the auth gates (`nostrAuthEnabled` derives from pubkey → false) +
the viewer gates → **Branch J renders the hydrated plan**. **Publish is impossible by construction:** every publish
path guards `!isAuthenticated || !nostrSigner || !nostrPubkey`, and no signer can exist without an identity. NO
AppShell gate change (only the one `DemoBanner` line). Showcase = Month 8 of a 12-month strategy, manual price for
determinism (Strike LTV green, CB LTV ~72% watch band), 7 confirmed history months. `DemoBanner`'s "Get the real
thing" links `VITE_PUBLIC_SITE_URL || '/'` (on the sandbox origin, a bare `/` would loop back to the sandbox). C2: the
banner is `position: sticky; top: 0` (**not fixed**) — as the first in-flow child of AppShell's fragment it PUSHES the
app content down (header stays visible) instead of overlaying it, and stays pinned on scroll.

**Free-riding closure — now on the SANDBOX project.** The sandbox deploy sets `VITE_OWNER_PUBKEY` (the owner's hex), so
a visitor who signs in with their own real key on the sandbox domain hits `PrivateAppNotice` (`isAuthenticated &&
!isOwner`) — the sandbox domain cannot be adopted as free hosting. The **public** project must NOT set it (real users
sign in there). Deployment requirement, no code.

**License.** `LICENSE` at root = **FSL-1.1-MIT** (Functional Source License v1.1, MIT future grant; Licensor
`silentius-satoshi`), making the landing's "source-available under FSL-1.1-MIT" claim true. package.json has no
`license` field (unchanged).

Files: `src/App.tsx` (onboarded gate), `src/pages/LandingPage.tsx`/`.module.css`, `src/lib/demo/demoSeed.ts`,
`src/components/Layout/DemoBanner.tsx`/`.module.css`, `src/vite-env.d.ts`, `LICENSE`.

---

