# Chapter 12 — Your Key Is the Account

*Part 4: Sovereignty · The Personal ₿LOC Book*

Personal ₿LOC has no accounts. There is no email field, no password reset, no server that knows you exist. Your identity is a key generated on your device, and the 12-word Recovery Key that encodes it is the whole account: whoever holds those words holds the plan. This chapter explains how the key is made, how it is protected on the device, and why the app refuses to sync anything until you prove you have saved it.

## Twelve words, one derivation

When you create a plan, the app draws 128 bits of entropy from the browser's cryptographic random source and encodes it as a 12-word phrase (the standard BIP-39 English wordlist). The phrase derives a signing key along one fixed path — in protocol terms, NIP-06 with derivation path `m/44'/1237'/0'/0/0`, account 0, no passphrase. That key is your identity everywhere: it encrypts your plan before it leaves the device, signs every sync event, and restores the plan on any new device.

The derivation path is not a configuration option. It is pinned by a test against published NIP-06 vectors, and the repo treats a failure of that test as **data loss, not a stale fixture** — because if the path ever changed, the same 12 words would silently derive a different key, and every Recovery Key written on paper would stop opening the plan it was saved for. The words are the recovery contract, so everything about them is part of that contract: the wordlist is English-only in v1 (you re-type what you wrote down), and pasted phrases are normalized — trimmed, lowercased, inner whitespace collapsed — so a phrase copied off paper works even with a doubled space.

The words themselves are treated as a transient secret. They are never logged, never persisted, never put in an error message. What the device stores is the 16 bytes of entropy behind them, and only in encrypted form.

## Face ID or PIN: the wrap at rest

The key never sits in plain text on the device. It is wrapped — encrypted at rest — behind one of two unlocks:

- **A platform passkey (Face ID, Touch ID, Windows Hello)** using WebAuthn's PRF extension: the authenticator produces key material only when you pass the biometric check.
- **A PIN**, stretched through PBKDF2 at 600,000 iterations.

Either way the result feeds HKDF and then AES-GCM: one unlock gesture, one authenticated ciphertext. The unwrapped key exists in memory only, and the buffer is zeroed after the signer takes its own copy. Unlocking is what "signing in" means on this app — there is no session cookie anywhere, just a decrypt that either succeeds or doesn't.

A detail worth naming plainly: the wrap protects the **key**. Plan data itself is stored locally in the clear today (at-rest data encryption exists behind a flag and matures in a later phase), which is why the app's copy never claims otherwise.

## The backup ceremony, and the gate behind it

Here is the honest problem with a freshly generated key: until you save it somewhere, this device holds the **only copy in the world**. The relays hold ciphertext that only this key can open. If the phone dies before you back up, the plan is gone — not "contact support" gone, gone.

So the app does something unusual: it refuses to sync. A freshly generated key syncs **nothing** — not a publish, and not even a pull, because a pull would set the flags that re-arm publishing. The predicate is one line:

```
isBackupGateSatisfied = keyProvenance !== 'generated' || backupVerifiedAt != null
```

It is consulted at eleven guard sites across the sync engine — every publish path and the sync entry itself. Keys you **imported** (pasted a Recovery Key) or hold **externally** (a NIP-07 browser extension, a NIP-46 remote signer) pass by construction: the paste proves possession, and an external signer means the key already lives elsewhere. Plans created before the gate existed are grandfathered structurally — no migration, no nag; the store treats an absent provenance as satisfied on every load.

Opening the gate takes a ceremony, not a checkbox:

1. **Reveal** — the 12 words appear on a blurred grid; tap to show.
2. **Save** — download the recovery file, save it to a password manager, or scan the QR. Continue requires at least one save.
3. **Word quiz** — the app asks for two of the twelve, chosen at random and re-randomized on every miss. An earlier design accepted an "I backed it up" checkbox and was retired for a stated reason: *an ack is a promise; a verification is proof.*
4. **Stamp** — passing the quiz writes `backupVerifiedAt`, the gate opens, and the first real sync runs.

If you choose "I'll do this later," nothing breaks — the plan works fully offline — but sync stays off, and the app starts climbing an escalation ladder: first an amber **badge** on the Settings gear, then a **nag card** on the dashboard and journal ("Your plan's key isn't backed up yet"), dismissible per session but back at next launch, and finally a **hard gate** — the Sharing and Network pages are replaced outright with "Save your Recovery Key first," because both pages create relay copies only your key can open. The ladder is deliberately loud. A silent app that quietly isn't syncing would be the dishonest version.

## Sign out is not forget

Settings offers two exits, and they are different on purpose.

**Sign out** keeps everything: the plan, the wrapped key, the verified-backup stamp. You return to the unlock screen; Face ID or the PIN brings the same plan back. A verified key stays verified across sign-out — signing out never restarts the backup nag.

**Remove local key** is identity destruction. It clears the identity, the provenance, the attestation, and — critically — wipes the plan data itself from the device. The rule in the repo is blunt: *clearing identity fields is not forgetting an identity.* If only the login state were cleared, the plan blob would still sit in local storage, readable by whoever opens the tab next.

The two buttons carry different visual weight — sign-out is neutral, "Remove local key" is red — and a test pins the difference, because a user who mistakes the destructive one for sign-out loses the only on-device key. The confirmation copy is honest to the same edge case: for a key that has never synced, it warns of **permanent deletion** and never claims your plan "stays on the relay," because a never-synced key has no relay copy to stay on.

Your keys, your plan — including the part where the app refuses to pretend a backup happened that didn't.

---

## From the code

- **Files:** `src/lib/nostr/nip06Key.ts` (derivation, normalization, transient-secret rules) · `src/lib/nostr/keyVault.ts` (PRF/PIN wrap, HKDF → AES-GCM, memory-only unwrap) · `src/lib/backupGate.ts` (the pure predicate) · `src/lib/nostr/session.ts` (single-flight, PIN-aware unlock/restore) · `src/components/Onboarding/OwnerKeySetup.tsx` and `WordGrid.tsx` (the ceremony) · `src/lib/nostr/disconnect.ts` (the three teardowns)
- **Numbers:** 128-bit entropy → 12 words · NIP-06 path `m/44'/1237'/0'/0/0`, account 0, no passphrase · PBKDF2 600,000 iterations · AES-GCM-256 via HKDF · gate consulted at 11 sites · word quiz: 2 random words, re-randomized per attempt
- **Tests:** the published-vector NIP-06 derivation test (failure = data loss by policy) · `src/lib/__tests__/backupGate.test.ts` (all provenance cases, `backupVerifiedAt: 0` counts) · `src/lib/nostr/__tests__/disconnect.test.ts` (sign-out retains, forget wipes — the contrast set) · keyVault PIN-path unit tests

*Related chapters: 13 (what the opened gate syncs), 14 (viewer keys minted from this one), 15 (backups, restore, and the escape hatch).*

<!-- DRAFT v0.1 — Founder review -->
