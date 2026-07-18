# Chapter 14 — Sharing Without Surrender

*Part 4: Sovereignty · The Personal ₿LOC Book*

A spouse who wants to know the position is safe. A friend who checks the gauges when you travel. Someone you trust watching the LTV bars during a drawdown, without holding your keys and without seeing a single dollar figure unless you decide they should. That is the viewer: read-only by construction, private by arithmetic, revocable from your side. This chapter is how the roster works — who mints the keys, what each tier can see, and what a viewer can never see at all.

## The owner mints every key

There is no "viewer signs up" flow. The owner is the sole minter: every viewer key is **derived deterministically from the owner's own key** (HKDF, labeled `personal-bloc/viewer-key/v{keyVersion}/i{index}` — one distinct key per roster slot, per key version). Determinism is the backup story: the owner can regenerate any viewer's exact key at any time from their own Recovery Key, so a viewer key needs no backup of its own and no viewer key ever becomes something the owner can't reproduce.

Viewer-supplied keys are rejected as a category. An earlier design let the viewer generate a key and send the owner their npub; it was retired outright — there is no field left in the app that could accept one. The current handoff is a single token the owner produces:

```
<keyPart>:<ownerNpub>
```

The key part is the viewer's key, either bare (for an in-person handoff) or **passphrase-encrypted** (NIP-49 — safe to send over any channel, since the passphrase travels separately). The owner's npub rides along so the viewer needs nothing from a second channel. The viewer pastes the token, types the passphrase if there is one, and is connected. One string, one paste, done.

The direction of trust never inverts: the app even refuses to *import* a handoff token as an owner key — a token's key is a viewer key, and a colon in the paste is rejected rather than repaired, so an owner can't accidentally sign in as their own viewer.

## Two tiers: Safe and Trusted

Each roster slot carries a tier, and the default is the private one.

**Safe** ships health, not money: LTV ratios, Safe/Watch/Act levels, the configured thresholds, and the public bitcoin price at snapshot time. The viewer's app scales the gauges to the live price locally — between owner publishes only price moves, and LTV moves inversely with it, so the gauges stay current without another byte from the owner. What Safe can never leak is any absolute: no balance, no collateral amount, no liquidation price in dollars. That is not a filter applied to sensitive data — the payload is *built* without it, and the privacy audit is simply the list of keys in the payload. And the arithmetic is on the viewer's side of the wall: from a ratio alone, balance and collateral are **two unknowns in one equation** — no dollar figure is recoverable by construction. A household member sees "the position is safe, here's the distance to the bands" and nothing else.

**Trusted** is the deliberate opt-in for someone who should see real figures: settings, balances, the rolled-up monthly entries, live Strike figures. Even Trusted never ships the raw day journal — the viewer gets the months and the derived collateral scalars, not the keystroke-level record of every draw and reading. And a short list is stripped from Trusted unconditionally: the viewer roster, the owner's relay list, and the owner's backup attestation. A test pins the exact key set of the Trusted payload — brittle by design, so a newly synced field can never leak to viewers without someone consciously deciding it should.

Flipping a slot's tier republishes at once; the viewer's app switches mode on the next event.

## One channel per viewer

Each viewer gets their own encrypted channel: the owner publishes a snapshot to `personal-bloc:viewer:v2:<that viewer's pubkey>`, NIP-44-encrypted so only that viewer can open it. Snapshots fan out fire-and-forget after every real publish of records or settings — one payload built per distinct tier, encrypted once per viewer, each slot's failure isolated so one dead viewer channel never blocks the rest. The fan-out never touches the owner's own sync state: a viewer problem is never reported as your sync problem.

**Rotation** bumps that slot's key version, derives a fresh key, and hands off a new token — the old key simply stops being the one snapshots are encrypted to. **Revocation** is stronger and immediate: the owner publishes a tombstone (`revoked: true`) *on the viewer's own channel*. The viewer's app checks that flag before anything else, wipes every piece of hydrated data, and drops to a waiting screen. The same wipe fires whenever decryption fails — a key that can't open the current snapshot never keeps showing the previous one. Decrypted data does not outlive its authorization; that rule has its own test.

## What a viewer never sees, and never sends

The boundaries, stated flat:

- **A viewer never sees the roster.** Each viewer knows only their own channel; who else the owner shares with, and at what tier, is invisible.
- **A viewer never sees the owner's relay list or key-custody state.** The relay list and the backup attestation are stripped from every snapshot tier.
- **A viewer never sees the raw day journal.** Rolled-up months at most, on Trusted only.
- **A viewer never publishes.** The viewer module only reads and decrypts; it contains no publish call and sets no dirty flags, and every owner-side publish path independently refuses to run in viewer mode. Read-only is structural, not policy — there is no code path by which a viewer's device could write anything to any relay about your plan.

Sharing here means exactly what it says: they can watch. You still hold the keys, the plan, and the door.

---

## From the code

- **Files:** `src/lib/nostr/viewerKey.ts` (deterministic HKDF derivation) · `src/lib/nostr/handoffToken.ts` (the combined token) · `src/lib/nostr/publish.ts` (`viewerDTag`, `ViewerSnapshot`, per-viewer publish) · `src/lib/nostr/syncEngine.ts` (`publishViewerSnapshotNow` fan-out, `publishViewerRevocationNow`) · `src/lib/nostr/viewerSync.ts` (read-only hydrate, revocation and decrypt-failure wipes) · `src/store/payloads.ts` (`buildViewerSnapshotPayload`, the tier branch)
- **Numbers:** derivation label `personal-bloc/viewer-key/v{keyVersion}/i{index}` · channel `personal-bloc:viewer:v2:<pubkeyHex>` · tiers `safe` (default) / `trusted` · slot indices monotonic, never reused · key version per-slot, bumped on rotation · payload built once per distinct tier, encrypted once per viewer
- **Tests:** `viewerSnapshot.test.ts` (the exhaustive Trusted key-set pin; Safe payload excludes every absolute) · `handoffToken.test.ts` (build/parse round-trip, two-part requirement) · `ncryptsec.test.ts` (malformed-vs-wrong-passphrase discrimination) · `clearViewerData.test.ts` (the data-remanence wipe) · the viewerKey derivation regression pin

*Related chapters: 12 (the owner key everything derives from), 13 (the channel map this extends), 09 (the safety view the Safe tier ships).*

<!-- DRAFT v0.1 — Founder review -->
