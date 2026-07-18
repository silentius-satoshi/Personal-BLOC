# Chapter 13 — Sync Without a Server

*Part 4: Sovereignty · The Personal ₿LOC Book*

Personal ₿LOC has no backend. There is no database with your balances in it, no API that returns your plan, nothing to subpoena and nothing to breach. What exists instead: your device holds the plan, and a handful of open relays hold encrypted copies that only your key can open. This chapter is the plumbing — how the channels are laid out, what the app counts as a successful sync, and the guard class that keeps a fresh install from ever overwriting your real data.

## Six channels

Everything syncs as replaceable events (kind 30078) on relays you choose, addressed by a `d` tag — one channel per kind of data. Five are encrypted to your own key with NIP-44 before they leave the device: the relay stores ciphertext and learns nothing but the timestamp. The sixth is deliberately plain.

| Channel (`d` tag) | Contents | Semantics |
|---|---|---|
| `personal-bloc:plan-events:v1` | the append-only plan-event log, compacted | union by id, fold to state — order-independent, no watermark |
| `personal-bloc:settings:v1` | the full synced-settings object (~35 fields) | whole-object last-write-wins; post-4c a write-through bridge from the fold |
| `personal-bloc:records:v1` | monthly entries, deletions, the day journal, its tombstones | merge-based receive, tombstones beat older data, 90-day GC |
| `personal-bloc:prefs:v1` | tab order, hidden tabs, simple mode, buying unit | tiny whole-object LWW — a stale clobber is cosmetic |
| `personal-bloc:viewer:v2:<pubkeyHex>` | per-viewer snapshot, encrypted **to that viewer** | one channel per viewer; revocation is a tombstone (chapter 14) |
| kind 10002 (NIP-65) | your relay list | **plaintext** — it must stay readable by other clients |

Default relays are relay.damus.io, relay.primal.net, and nos.lol; the Network page lets you replace them entirely. Each channel's `created_at` is strictly monotonic per d-tag within a session, so two publishes in the same second can never tie and let a relay keep the older payload.

## Local-first: offline is normal

Every write lands on the device immediately — the store persists synchronously, and the app is fully functional with the network off. Sync is background repair, not the write path. Changes mark a dirty flag and go out on a debounce: 400 ms for records (so a flow and its reading, saved back-to-back, coalesce into one publish), 2 seconds for settings, plan events, and prefs. If the app is killed mid-debounce, the dirty flag survives and the next foreground sync publishes it. A pull that finds the relay missing something you have triggers an immediate repair publish; a pull that finds something you're missing merges it in. Both directions, one deterministic merge.

## Publish honesty

A sync indicator that lies is worse than none, so the app is strict about what counts.

An ack must be a real relay OK frame. The underlying library resolves a failed connection with a *string* — `"connection failure: …"` — instead of rejecting, which would let an offline publish count as acknowledged by every relay. The app normalizes those resolutions into rejections before counting anything.

A publish succeeds only on a **quorum of acks: min(2, relays)**. One relay saying yes is not enough when a single dying or lying relay could clear the dirty flags and strand your data. Each attempt records a per-relay report — URL, latency, ack or reject — visible in diagnostics, metadata only, never amounts.

And `syncNow` returns true only when the pull **and** every dirty push succeeded. Anything less sets the reconnect affordance and keeps the dirty flags, so the next foreground sync retries. "Synced" in this app means synced.

## The seed-clobber guard class

The scar this section grew from: settings sync whole-object, last write wins. A fresh install starts from seed defaults. If that fresh install ever published *before* pulling, its untouched defaults — with a fresh timestamp — would overwrite your real plan on every relay. The app defends this at three layers:

1. **Never publish before the first pull.** Settings, plan-events, and prefs publishes are all gated on `initialSettingsPullDone`; nothing whole-object leaves the device until the session has fetched a baseline.
2. **The seed sentinel.** As a backstop, the settings publisher refuses to ship a payload that still looks like the untouched seed (default income, expenses, credit line, no bitcoin held) before that first pull.
3. **The three hydrate guards.** Three fields get special treatment when remote data arrives: `backupVerifiedAt` is a one-way latch (a peer's null can never un-verify a verified device), an empty viewer roster never clobbers a populated one, and a defaults-looking relay list never replaces a customized one.

These guards work, and every one is a test. But they are patches on a structural problem — whole-object LWW cannot tell "I have no opinion about this field" from "I set this field to its default value."

## The fold that retires the guards

The event-sourced plan core (Phase 4) fixes the problem at the data model. Instead of syncing the settings object, each plan-field edit emits an append-only event:

```
{ id, ts, device, kind: 'set', field, value }
```

`kind: 'set'` is the entire taxonomy — there are no deletes. Sync is union-by-id followed by a fold: sort by (ts, id), last event per field wins. The distinction that kills the clobber class outright: a field **absent from the log** means "seed default — no opinion," while a field **set to empty** (a cleared roster, a nulled minimum) is an event like any other. A fresh session has an empty log, publishes nothing about fields it never touched, and therefore *cannot* clobber — not because a guard caught it, but because there is nothing to publish. Order-independence means no watermark either; events merge the same whichever direction they travel.

Migration was one-shot per key: **genesis** synthesizes the log from the existing settings object, strictly after the first pull, only when no plan-events exist anywhere. **Compaction** keeps the latest event per field forever plus 90 days of superseded history — a bounded log with an audit trail. The old settings channel is still written as a bridge (so a rollback or an old bundle stays lossless), but on any device with a non-empty log, plan fields arriving via settings are stripped on read: the fold owns them.

*Phase 4e — stopping the settings bridge entirely — lands after its soak week: the fold must run parity-green continuously, and no device may still be reading the legacy channel as authority. The book documents it when it ships.*

---

## From the code

- **Files:** `src/lib/nostr/publish.ts` (channels, monotonic clock, quorum, connection-failure normalization) · `src/lib/nostr/sync.ts` (the single apply path, dual-read strip) · `src/lib/nostr/syncNow.ts` (the unified sequence, genesis, the gate) · `src/lib/nostr/syncEngine.ts` (debounced publishers, seed sentinel, parity check) · `src/lib/nostr/relays.ts` (defaults, NIP-65) · `src/lib/planEvents/` (`fold.ts`, `genesis.ts`, `compact.ts`, `types.ts`)
- **Numbers:** kind 30078 · quorum min(2, relays) · publish timeout 12 s · debounce 2 s (settings/plan/prefs), 400 ms (records) · ~35 synced settings fields (33 plan + 4 prefs) · compaction: latest-per-field forever + 90 days · defaults damus / primal / nos.lol · 3 hydrate guards
- **Tests:** the fold/union/compaction suites (`fold(compact(e)) ≡ fold(e)`, first-wins union) · the genesis-matrix test on `pickPlanFields` · quorum/ack tests over `awaitAckQuorum` · merge-determinism tests in `mergeRecords`

*Related chapters: 12 (the gate that holds all of this off), 14 (the viewer channel), 15 (the reset that never publishes), 19 (the full channel and event reference).*

<!-- DRAFT v0.1 — Founder review -->
