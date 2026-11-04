# Chapter 19 — Appendix: Data & Events

*Part 6: Conclusion & Reference · The Personal ₿LOC Book*

This appendix is the reference the rest of the book leans on: the event shapes, the sync channels, the store partition, and the constants tables, gathered in one place. It reorganizes the architecture document for lookup rather than argument. One caveat before any table: **volatile facts drift.** The store version, test count, and field counts below are true as of store v21; the shapes and doctrines are the stable part, and the repo (`CLAUDE.md` and the reference docs in `docs/claude/`) is always the source of truth.

## The DayEvent union

Every entry in the day journal is one event: an `id`, an ISO `date` (yyyy-mm-dd), a millisecond `ts`, and a `kind` that determines the rest of the shape. Eight kinds:

```ts
type DayEvent =
  | { kind: 'draw' | 'paydown';  amount: number;               // USD
      target?: 'strike' | 'cb';  fee?: number }                // no target = Strike; fee: a Coinbase draw's
  | { kind: 'minPayment';        amount: number }              // USD — Strike monthly minimum
                                                               // paid from income; balance-neutral
                                                               // (rolls up to strikeMinPaid, NOT paydown)
  | { kind: 'buy';               amount: number; usd?: number }// BTC acquired, optional cost
  | { kind: 'deposit' | 'withdraw';
      amount: number; target: 'strike' | 'cb' | 'cold' }       // BTC collateral and cold moves
  | { kind: 'cbCollateralReading'; cbCollateral: number }      // BTC — CB-only clock
  | { kind: 'balanceReading'; reading: {
      strikeBal: number; strikeLtv: number;   // always required (read off Strike's screen)
      strikeCollateral?: number;              // reading-anchored Strike collateral ₿
      cbBal?: number; cbLtv?: number;         // required at runtime iff hasCbLoan
      cbCollateral?: number;                  //   " — feeds the derived cbCollateralBtc clock
      cbLiqPrice?: number;                    // anchor input only; never a monthly stock
      price?: number;                         // optional spot at reading time
    } };
// every variant also carries { id: string; date: string; ts: number; at?: number }
```

Notes the shapes encode:

- **Readings are ground truth.** `balanceReading` fields are typed as *what you read off the lender's screen*, never computed. `strikeBal` and `strikeLtv` are always required; the CB fields become required when a CB loan exists.
- **Collateral is reading-anchored.** Strike collateral is *derived*: the latest `strikeCollateral`-bearing reading (by date, then ts) plus `target:'strike'` deposits/withdrawals strictly after it. Buys never count toward Strike collateral — pledging is explicit. `cbCollateralBtc` is likewise derived from the latest collateral-bearing event. Neither is synced as a setting; both converge across devices via the day log on the records channel.
- **The atomic write.** In Daily Mode, a flow and its "current balances" reading share one `ts` and land together. Exceptions: a Coinbase borrow or paydown, a cold move and a minimum payment take no reading, and on a past date any flow's reading is optional (a Set balance is the reading itself). A month with a Strike draw, paydown or collateral move, a buy or a minimum payment but no reading takes the prior month's closing reading, if it has one, marked `provisional` until a reading is logged; Coinbase and cold moves alone never do.
- **Edits must bump `ts`** — merge resolves day events by id, higher `ts` wins.

## The MonthlyLogEntry rollup

Day events roll up into monthly entries, months 1–12 relative to `advisorStartDate`, bucketed on a calendar-anniversary clock:

| Field | Type | Meaning |
|---|---|---|
| `month` / `date` | number / ISO string | 1–12 from `advisorStartDate`; first day of the month |
| `btcBought`, `income`, `paydown`, `expensesActual` | number | **flows** — summed from events |
| `strikeBal`, `strikeLtv`, `btcHeld` | number | **stocks** — from the *latest* balanceReading (LTV stored as a decimal, e.g. `0.1483`) |
| `cbBal?`, `cbLtv?` | number | omitted when no CB loan |
| `ndpPaid?`, `strikeMinPaid?`, `strikeMinSource?` | number / `'income'\|'roll'` | optional payment detail |
| `collateralAdjustment?` | number | net ₿ deposited(+)/withdrawn(−); store-owned, written only by graduation |
| `miningSats?` | number | optional; display-only |
| `loggedAt`, `updatedAt?` | ms | merge uses `updatedAt`, falling back to `loggedAt` on legacy entries |
| `source?` | `'manual' \| 'daily'` | undefined = legacy manual; `'daily'` = rolled from the day log |
| `confirmed?` | boolean | undefined = legacy true; false = awaiting the sign-off |
| `provisional?` | boolean | flows present but no reading — stocks were borrowed forward, loudly marked |

The doctrinal invariants: stocks come from readings, never from summing flows; and a flow-only month is `provisional`, visibly.

## The sync channel map

All encrypted channels are kind-30078 replaceable events, NIP-44 self-encrypted to the user's key, with per-d-tag monotonic `created_at`. Relays hold ciphertext only.

| d-tag | Contents | Semantics |
|---|---|---|
| `personal-bloc:plan-events:v1` | `{ events: PlanEvent[] }`, compacted | append-only · union-by-id (first-wins) · fold-to-state · no watermark (order-independent) |
| `personal-bloc:settings:v1` | (was: the synced-settings object) | retired at 4e — nothing publishes or reads it; old copies on relays are inert |
| `personal-bloc:records:v2:<YYYY-MM\|undated>[.N]` | a journal page, `{ v: 2, key, entries, dayLog }` — one calendar month's items, ≤ 32,768 B (a fuller month goes on to `.2`) | the journal since 5b · merge-based receive · tombstones beat older data · 90-day GC · held until the device has the plan (5c) |
| `personal-bloc:records:v2:manifest` | `{ v: 2, pages, deletions, dayLogDeletions }` — every page with its item count and fingerprint, plus the tombstones | published after its pages: the commit marker and the completeness check; the journal is pulled as one unit |
| `personal-bloc:records:v1` | `{ entries, deletions, dayLog, dayLogDeletions }` while the journal's JSON is at most 40,960 B; past that, a stub pointing to the v2 manifest | the bridge for apps from before 5b; every pull still reads it |
| `personal-bloc:prefs:v1` | `{ tabOrder, hiddenTabs, simpleMode, btcBuyingUnit }` + `venueColors` once a device chooses colours | tiny whole-object LWW — device taste; a stale clobber is cosmetic |
| `personal-bloc:viewer:v2:<pubkeyHex>` | per-viewer snapshot, encrypted **to that viewer** | safe (ratios only) or trusted (figures); revocation = tombstone on the same d-tag |
| kind 10002 (NIP-65) | relay list, **plaintext** | user-chosen; defaults relay.damus.io · relay.primal.net · nos.lol |

Transport doctrine, in brief: publishes are debounced (records 400 ms; plan, prefs 2 s) and count as delivered only on a quorum ack of `min(2, relays)`, with connection failures normalized to rejections — an ack means a real relay said OK. Pull takes latest-by-`created_at` per d-tag: plan-events (union + fold) and prefs, then the journal as one unit — `records:v1`, the v2 manifest and the pages it lists, merged. No first publish before the initial pull completes. Tombstone and compaction TTL is 90 days.

## PlanEvent: the shape and the rules

```ts
interface PlanEvent {
  id:     string;   // `${field}-${ts}-${rand4}`; genesis: `genesis-${field}-${ts}`
  ts:     number;   // ms · per-device monotonic: ts = max(Date.now(), lastTs + 1)
  device: string;   // diagnostics only — NEVER a merge input
  kind:   'set';    // the v1 taxonomy is 'set' only — no deletes
  field:  PlanField;
  value:  unknown;  // JSON value, including arrays
}
```

- **Fold:** replay events in `ts` order; latest set per field wins; a field absent from the log means the seed default; setting a field to empty is itself an event (absent ≠ empty).
- **Union:** merge by id, first-wins — events are never edited, so identical ids are identical events.
- **Compact:** keep the latest event per field forever, plus up to 90 days of history — a burst of edits to one field keeps only its last event, and the history is trimmed oldest first to a 32 KiB budget (5a); the law is `fold(compact(e)) ≡ fold(e)`.
- **Genesis** — synthesizing a log from `settings:v1` on a device with settings but no log — was retired at 4e, with the channel it read.
- **Atomicity:** one setter emits one event batch with a shared `ts`, so paired fields never tear.

## The store partition

The local store (`personal-bloc-store`, **v21**, zustand persist, optionally encrypted at rest) partitions its fields by exactly one question: *what happens if this is wrong on another device?*

| Partition | Contents | Why it lives there |
|---|---|---|
| **Synced plan** (42 fields; with the 5 prefs, `SETTINGS_FIELDS`' 47) | income, expenses, `blocApr`, `creditLine`, the advisor anchors and `asOf` stamps, the CB loan fields and band settings (`cbLtvTriggerPct`/`cbLtvTargetPct`/`cbRotateBackPct`/`cbEmergencyCeilingPct`), min-payment config, skip flags, `nostrRelays`, `backupVerifiedAt`, the viewer roster | the plan itself — every field rides the plan-events log (`settings:v1` retired at 4e); `SETTINGS_FIELDS` in `src/store/settingsFields.ts` is the single source of truth for the list |
| **Synced prefs** (5 fields) | `tabOrder`, `hiddenTabs`, `simpleMode`, `btcBuyingUnit`, `venueColors` | device taste — a stale clobber is harmless and self-corrects, so they stay whole-object LWW on `prefs:v1` instead of joining the event log |
| **Device-local** (never synced) | `writerKeyWrapped`/`writerKeyWrapMeta`, `viewerKeyWrapped`/`viewerKeyWrapMeta` (encrypted key material), `keyProvenance`, the derived collateral caches (`strikeCollateralBtc`, `cbCollateralBtc`) | key material must never leave the device; derived caches converge via the day log instead of being synced as facts |
| **Transient** (in-memory only) | unwrapped keys (zeroed after use), `viewerUnlocked`, live sync/dirty machinery | exists only while the app runs; nothing to persist |

**The standalone gate keys.** A small set of facts is persisted *outside* the blob, in plain standalone localStorage: the four gate-condition fields (`personal-bloc-onboarded`, `-nostr-auth`, `-nostr-method`, `-nostr-pubkey`), the wrapped writer key (`personal-bloc-writer-key-wrapped`/`-meta`), and key provenance (`personal-bloc-provenance`). Two reasons. First, the encrypted-cold-start deadlock: when the blob is encrypted at rest, the unlock gate needs those fields to decide *whether to show itself* — but they would be locked inside the very box the gate opens. They live outside so the gate can read them before any unlock. Second, survival: the escape hatch (`resetAndResync`) nukes the blob but deliberately keeps the gate keys, so a reset device still knows who it is and what its key's custody state is. The one deliberate asymmetry: `backupVerifiedAt` needs *no* standalone key, because it is a synced plan field — a verified key re-hydrates it from the relay on the post-reset pull, and an unverified key's empty relay correctly yields null.

## The constants tables

The numbers the doctrine hangs on. LTVs are stored as decimals and converted only at the display edge.

**Strike (BLOC):**

| Constant | Value | Meaning |
|---|---|---|
| `STRIKE_MAX_DRAW_LTV` | 0.50 | drawable to 50% LTV — available = min(line, collateral·price·0.50) − drawn |
| `BLOC_OPERATING_CEILING` | 0.15 | the Smart BLOC method's steady-state Strike ceiling, defended with up to 100% of income |
| Warning / margin call / partial liquidation | 0.65 / 0.70 / 0.85 | the 0.85 partial liquidation runs on a 72-hour window |
| Collateral tiers | min 15% / rec 5% / ideal 2% | year-one collateral sizing tiers |

**Coinbase (Morpho):**

| Constant | Value | Meaning |
|---|---|---|
| `CB_LLTV` | 0.86 | instant liquidation at 86% — no margin call, no grace |
| `CB_LIF` | ≈ 1.04384 | liquidation incentive factor — ~4.4% penalty |
| Warn band | 0.65 | `CB_WARN_LTV` |

**The Coinbase trigger and target:**

| Setting | Default | Meaning |
|---|---|---|
| Trigger / target | 75 / 65 | at the trigger it is a crash day and the Emergency Console's playbook acts, bringing Coinbase back to the target; between the two the plan waits |

**The emergency ladder and last resorts:**

| Stage | LTV | Doctrine |
|---|---|---|
| Watch | 0.69 | at the default target and trigger (65 / 75) the playbook waits here ("No action") |
| Prepare | 0.72 | the same wait — Simulate shows the steps a lower price would bring |
| Execute | 0.75 | the default trigger: the crash playbook acts — top up first between the liquidation depth and support, shift debt first elsewhere or when the coins it can move couldn't clear 86% |
| Last resort | 0.81 | the final rung; when the playbook can't clear 86%, the last resorts remain — sell to pay down, outside cash |

**Safety bands (one classifier, three dimensions):**

| Dimension | Warn | Act |
|---|---|---|
| Credit used | 0.75 | 0.90 |
| Strike LTV | liq × 0.76 | liq × 0.82 |
| Coinbase LTV | trigger | red at liq × 0.93 |

Crash lens: the safety view also computes Strike's LTV at price × 0.2 — an 80% drawdown — which the Scenario face compares before and after.

**The Almanac's models** (no risk module imports them; the power-law floor reaches the plan's run and the crash playbook only as a support price handed in — the Safety Dashboard and the Emergency Console read it and hand their models the number):

| Constant | Value |
|---|---|
| Power law | `A · days^5.82`, days from genesis 2009-01-03 |
| Fair / floor / ceiling A | 1.16e-17 / 0.42e-17 / 2.4e-17 |
| Halving interval | 210,000 blocks |
| Next halving | block 1,050,000 (~Apr 2028) |

## State of the app, one line

Store **v21** · 47 synced settings fields (42 plan + 5 prefs) · 850+ tests plus a Playwright gesture harness · event-sourcing shipped through Phase 4e (the settings bridge retired). These are the facts that drift; when this page and the repo disagree, the repo wins.

---

## From the code

- **Files:** `src/simulation/types.ts` (DayEvent, MonthlyLogEntry) · `src/lib/planEvents/types.ts` (PlanEvent) · `src/store/settingsFields.ts` (SETTINGS_FIELDS / PREFS_FIELDS / PLAN_EVENT_FIELDS) · `src/simulation/strikeCredit.ts`, `runCoinbaseLoan.ts`, `cbMetrics.ts`, `safetyView.ts`, `powerLaw.ts` (the constants) · the SyncEngine and `mergeRecords`/`foldPlanEvents` (channel semantics)
- **Numbers:** Strike 0.50 / 0.15 / 0.65 / 0.70 (a 72h cure) / 0.85 (sold at once) · CB 0.86 / ≈1.04384 / warn 0.65 · trigger / target 75 / 65 · ladder 69/72/75/81 · safety 0.75/0.90, liq×0.76/0.82, liq×0.93, crash ×0.2 · power law 5.82, A fair 1.16e-17 / floor 0.42e-17 / ceiling 2.4e-17 · halving 210,000, next 1,050,000 · debounce 400ms/2s · quorum min(2, relays) · TTL 90 days · store v21
- **Tests:** the 850+ suite pins every invariant cited here; the merge, fold, and gate predicates (`mergeRecords`, `foldPlanEvents`, `isBackupGateSatisfied`) are pure and node-tested

*Related chapters: ch06–ch07 (readings, flows, the sign-off), ch09–ch10 (the bands in use), ch13 (the channels in motion), ch12 and ch15 (the gate keys and the escape hatch).*

<!-- DRAFT v0.1 — Founder review -->
