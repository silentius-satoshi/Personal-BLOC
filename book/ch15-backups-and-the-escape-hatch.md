# Chapter 15 — Backups & the Escape Hatch

*Part 4: Sovereignty · The Personal ₿LOC Book*

Sovereignty cuts both ways. No company holds your data, so no company can lose it — and no company can save you either. The app's answer is a set of exits and recovery paths that are all engineered around one discipline: a recovery operation must never be able to make things worse. This chapter covers the plan backup and its validated restore, the recovery-key file beside it, the migration rule that never deletes before verifying, the reset that cannot publish, and the honesty policy behind all of it.

## Two artifacts, two jobs

There are two backups, and they protect against different failures.

The **Recovery Key file** is the key — the 12 words (or, for a passphrase-protected copy, an encrypted form of them), saved during the chapter-12 ceremony. It protects against losing the device: with the words and any relay copy, the plan restores anywhere. Its filename says what it is: a plaintext save is named `DO-NOT-SHARE`; an encrypted save is named `-encrypted`, because its mitigation is the passphrase rather than the warning.

The **plan backup** is the data — a JSON file holding every synced setting plus the full records set: monthly entries, deletions, the raw day journal, and its tombstones. It exists because of a real incident: a fresh-install clobber once made the relay the *only* copy of a plan, with no way to get the data out. Settings → Backup → "Export plan" produces a local, in-hand copy that is independent of keys, relays, and sync entirely.

Deliberately absent from the plan backup: the viewer roster, and your relay list. Transport and sharing configuration is re-establishable and relationship-specific — a plan restored onto a new situation should not silently resurrect old grants.

## Restore: validated, atomic, and never a custody claim

Import runs pick → validate → summary → destructive confirm → one atomic replace. Validation is complete before the store is touched: format string, schema and store version (a mismatched version is rejected honestly rather than half-imported), shape checks on every record collection, and a count cap as an out-of-memory guard.

The interesting check is the **tamper tripwire**: every settings key in the file must belong to the exact whitelist of restorable fields. An unknown key — or a transport key like the roster or relay list that a hand-edited file tries to smuggle back in — rejects the whole file as tampered or foreign. The validator doesn't repair suspicious files; it refuses them.

One field is validated but never applied: `backupVerifiedAt`, the backup-ceremony stamp. Every export carries it (so carrying it must not reject), but **restore never writes it** — the stamp attests *key custody*, not plan data. A backup restores a plan onto whatever key the device holds; if that key is freshly generated and unverified, importing someone's plan file must not swing open the eleven sync gates for an un-backed-up key. A gated key can import fine — the data lands locally, the engine stays gated — and the gate opens only through the real ceremony. Tests pin exactly this.

Restore is merge-forward, not time travel, and the confirm copy says so: restored settings republish and win, but records merge by union — day events created *after* the backup come back from the relay on the next pull. True point-in-time rollback waits for event replay in a later phase.

## Verify before delete

When at-rest store encryption migrates a plaintext plan into an encrypted envelope, the order of operations is law: encrypt, then **decrypt the ciphertext back and compare byte-for-byte with the original — and only then delete the plaintext**. A verification failure returns false and leaves the plaintext untouched; the app keeps reading it as before. The failure path is the safe path. The test suite forces a verify mismatch and asserts the plaintext survives — the single most important test in that migration.

The principle generalizes across the app: no recovery or migration step destroys a source until its replacement has been proven readable.

## The escape hatch that cannot publish

Things go wrong locally: a wedged migration, an unlock that won't, a state you don't trust. For that there is **Reset & re-sync** — wipe the local plan state, keep the identity, reload, and let the normal boot sync pull the plan back from the relays into a clean slate.

Its safety property is structural, not procedural: the escape-hatch module **references no publish symbol at all**, and a test reads the source to prove it. Reset-and-resync pulls; it cannot push. Whatever corrupted state you are escaping from is physically incapable of propagating to the relays on the way out — and the boot sync afterward is dirty-gated, so the freshly pulled clean state doesn't turn around and publish over anything either. A bad day stays on one device.

## Forgetting means wiping

Chapter 12 drew the line between sign-out and "Remove local key." The storage side of that line: **identity-forget wipes the plan blob**. Clearing identity fields is not forgetting an identity — if the persisted plan survived, the app's gate ladder would fall through and render the full plan to whoever opens the tab next. So the destructive exits call the wipe as their last act before reload, clearing the plan store and the onboarding flag against a classified inventory of every storage key — an inventory that is itself an executable test, so a future feature can't add a key that forgetting misses. Sign-out and reset-and-resync deliberately do *not* wipe: the same user is coming back to the same plan.

## Recovery honesty as support policy

The last backstop is copy. Every destructive confirmation in the app branches on what is actually true for *this* key — and the branch that matters most is the never-synced one. A generated key that never passed the backup ceremony has never synced, which means there is no relay copy, which means the confirm dialog for deleting it warns of **permanent deletion** and never says "your plan stays on the relay." A test asserts that string cannot appear on that branch.

That is the support policy in one sentence: the app never promises a recovery the architecture can't deliver. If a relay copy exists, it says so; if this device holds the only copy in the world, it says that instead — before you press the red button, not after.

---

## From the code

- **Files:** `src/lib/backup/exportPlan.ts` (the backup shape and export) · `src/lib/backup/validatePlanBackup.ts` (the pure validator and tripwire) · `src/lib/backup/recoveryFile.ts` and `downloadFile.ts` (the recovery-key artifact) · `src/store/settingsFields.ts` (whitelist and apply-fields split) · `src/lib/store/storeMigration.ts` (verify-before-delete) · `src/lib/store/escapeHatch.ts` (the no-publish reset) · `src/lib/nostr/disconnect.ts` + `wipeLocalPlanData` (identity-forget)
- **Numbers:** backup format `personal-bloc-plan-backup`, schema 1, store version pinned to the app's own (mismatch = lean reject) · restore counts capped at 100k per collection · file cap 10 MB · `backupVerifiedAt` validated, never applied · escape-hatch publish symbols referenced: zero
- **Tests:** `validatePlanBackup.test.ts` (round-trip, every rejection, the whitelist drift-guard) · `applyPlanBackup.test.ts` (gated key stays gated; transport untouched) · `storeMigration.test.ts` (forced verify mismatch → plaintext survives) · `escapeHatch.test.ts` (the structural no-publish assertion) · `disconnect.test.ts` + `wipeLocalPlanData.test.ts` (wipe vs retain; the never-synced confirm copy)

*Related chapters: 12 (the ceremony and the gate), 13 (the sync these recoveries lean on), 14 (why sharing config never rides a backup).*

<!-- DRAFT v0.1 — Founder review -->
