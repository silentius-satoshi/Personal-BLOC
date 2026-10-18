# Plan export and import — reference

<!-- Moved word for word from CLAUDE.md (BL21). This is the only copy: edit it here. -->

## Plan Export / Backup Tool (EXPORT phase only; store unchanged)

A local, in-hand copy of the owner's plan independent of the relay/sync path — motivated by the
fresh-install settings-clobber incident (the relay was the *only* copy, with no way to get data out).
**Read-only / export-only this phase** — no import/restore (a separate, later, more careful build that
writes to the store + interacts with sync). The nsec key-backup ("save your recovery key") is a
different artifact (Phase 1.5) — not this tool.

- **`src/lib/backup/exportPlan.ts`** (+ `__tests__/exportPlan.test.ts`) — `buildPlanBackup(s:
  StoreState): PlanBackup`, a pure function reusing `buildSettingsPayload` (so future-added settings
  fields flow into the backup automatically) and stripping ONLY the sharing/transport config
  (`viewerNpub`/`viewerPubkey`/`viewerLabel`/`nostrRelays` — re-establishable, relationship-specific,
  not irreplaceable). Bundles the FULL records set (`monthlyLog`, `deletedMonths`, `dayLog`,
  `deletedDayEvents` — the RAW dayLog journal, not just rolled-up months; `cbCollateralBtc` needs no
  special handling since it's a derived cache reconstructable from the exported `dayLog`). Wrapper:
  `{ format: 'personal-bloc-plan-backup', schemaVersion: 1, storeVersion: 19, exportedAt (UTC ISO —
  correct here, a machine timestamp not a user-facing "today"), plan: { settings, records } }`.
  `downloadPlanBackup(s)` serializes + calls the SHARED `downloadBlob` (below), filename
  `personal-bloc-backup-{todayLocalISO()}.json` (the LOCAL date, per the date-fix convention).
- **`src/lib/backup/downloadFile.ts`** (R2c-7b) — `downloadBlob(blob, filename)`, the browser-standard
  anchor/`download`/click/`revokeObjectURL` save, EXTRACTED VERBATIM from `downloadPlanBackup` (the
  iOS-verified original). Two callers: the plan backup + the Recovery Key ceremony's save aids — one
  implementation, so they can't drift. iOS caveat (unchanged): a standalone PWA may OPEN the file rather
  than save it, which is why every download surface also offers a copy/share alternative.
- **`src/lib/backup/recoveryFile.ts`** (R2c-7b, PURE; + `__tests__/recoveryFile.test.ts`) — the ceremony's
  downloadable-backup content. `RecoveryArtifactKind = 'words' | 'nsec' | 'ncryptsec'` — a THREE-KIND union
  (not `(kind, encrypted)`) so the impossible `('ncryptsec', false)` combination is unrepresentable.
  `buildRecoveryFileText(kind, artifact)` = a warning header + blank line + artifact + trailing newline
  (plaintext → "anyone with this file can open your plan…"; encrypted → "(ENCRYPTED) — you need your
  passphrase to restore this…"). `recoveryFileName(kind, today, qr?)` → `personal-bloc-recovery-key[-qr]-
  {DO-NOT-SHARE|encrypted}-{today}.{txt|png}`. ⚠ `DO-NOT-SHARE` is the mitigation for a PLAINTEXT file; an
  encrypted file's mitigation is the passphrase, so its name carries `-encrypted` instead. ⚠ These functions
  HANDLE the secret but never own its lifecycle — never log/persist `artifact` here.
- **`SettingsMain.tsx` — "Backup" subpage** — `'backup'` added to `SettingsPage`/`SUBPAGE_TITLES`; a
  menu row (💾, `!viewerMode`-gated) placed right after "Identity & Security" (recovery-adjacent); the
  subpage is one paragraph + an "Export plan" button (`styles.syncButton`, calls
  `downloadPlanBackup(useStore.getState())`). No confirm (read-only, harmless). Owner-only.
- **Device-local/session fields are naturally absent** (not in `buildSettingsPayload`/the records
  set) — `devMode`, `viewerMode`, `planDirty`, `initialSettingsPullDone`, nostr identity fields
  never need explicit stripping.
- **Import/restore SHIPPED** — see the next section (was deferred here).

---

## Plan Import / Restore (the restore counterpart; store unchanged, NO bump)

Loads a `PlanBackup` file back in: **pick → validate fully → summary → destructive confirm → ATOMIC
replace → normal sync resumes.** Owner-only (mounted inside SettingsMain's `!viewerMode` tree).

**Semantic — MERGE-FORWARD, not time-travel** (stated verbatim in the confirm copy): the imported plan
fields are appended as plan events with a fresh ts, so they win the fold (the prefs republish whole-object); records are
union+tombstones (`mergeRecords`), so the next relay pull unions back any day/month events created
*after* the backup. True point-in-time rollback is Phase 4f event-replay.

- **`src/lib/storeVersion.ts` (NEW, zero-import):** `CURRENT_STORE_VERSION` — the SINGLE store-version
  constant, consumed by the persist `version`, `exportPlan`, `demoSeed` (`DEMO_SEED_STORE_VERSION`), and
  the validator's gate. `e2e/helpers.ts` keeps its own pinned literal (Playwright can't import `src/`).
- **`src/store/settingsFields.ts` (NEW, zero-import):** `SETTINGS_FIELDS` lifted out of
  `hydrateSettings`' closure (single source; 4e retired `hydrateSettings` — its two successors whitelist subsets:
  `hydratePrefs` PREFS_FIELDS, `applyViewerSettings` `VIEWER_SETTINGS_FIELDS`). Two derived subsets:
  **`VALIDATE_WHITELIST`** = `SETTINGS_FIELDS − {viewers, nextViewerIndex, nostrRelays}` (a file key
  outside it → reject as tampered/foreign — the transport fields must never be restored), and
  **`APPLY_FIELDS`** = that `− backupVerifiedAt`.
  **Phase 4b partition** (for the event-sourced plan core): **`PREFS_FIELDS`** = `[tabOrder, hiddenTabs,
  simpleMode, btcBuyingUnit]` (device-taste, stays whole-object LWW on `prefs:v1` — a stale clobber is
  cosmetic + self-corrects) and **`PLAN_EVENT_FIELDS`** = the other **33** (event-sourced). `33 plan + 4
  prefs = 37 SETTINGS_FIELDS`. ⚠ AMENDMENT to the 4a design lock's §3: `backupVerifiedAt` (R2a-1, joined
  the synced set after the lock was written) is a PLAN field. `PlanField = Exclude<SettingsField,
  PrefsField>` and `PLAN_EVENT_FIELDS` uses a **type-guard filter predicate** (`(f): f is PlanField`) so
  the array narrows to `readonly PlanField[]` — a naive `.filter()` widens the element type and would make
  `PlanField` the wrong (too-wide) union.
- **⚠ THE CRITICAL VALIDATE↔APPLY SPLIT.** `backupVerifiedAt` **is** in the validate whitelist (every
  export carries it — must not reject) but is **NOT** in `APPLY_FIELDS` — `applyPlanBackup` **never
  writes it** (and `keyProvenance` is never in the payload). *The stamp attests KEY custody, not plan
  data — a backup restores a plan onto whatever key the device holds.* Without this, importing any
  export onto a generated-unverified key would open R2a-1's eleven gate sites for an un-backed-up key.
  A gated key imports fine (data lands local-only, engine gated) and **stays gated** — the gate opens
  only via the real ceremony. Pinned by tests.
- **`src/lib/backup/validatePlanBackup.ts` (NEW, PURE/node-tested):** `validatePlanBackup(raw) → {ok,
  backup, summary} | {ok:false, reason}`. Imports only `CURRENT_STORE_VERSION`, `VALIDATE_WHITELIST`,
  and TYPE-only `PlanBackup` (so it never pulls useStore). Checks (all before any store touch): format
  string · `schemaVersion===1 && storeVersion===CURRENT_STORE_VERSION` (**lean-reject** mismatch,
  version-honest message) · every settings key ∈ `VALIDATE_WHITELIST` (unknown/transport → reject) ·
  four record collections present + per-event/entry shape-checks · **tombstone maps accepted as
  `Record<string,number>`** (JSON stringifies `deletedMonths`' numeric keys — do NOT reject on key
  typeof) · counts capped ≤100k (OOM guard) · `ImportSummary` (exportedAt + counts + income/expenses/
  balances preview).
- **`applyPlanBackup(backup)` store action (`useStore.ts`) — ONE atomic `set()`:** (a) settings
  partition filtered to `APPLY_FIELDS`; (b) records wholesale (`monthlyLog`/`deletedMonths`/`dayLog`/
  `deletedDayEvents` — the PlanBackup record names match the store field names 1:1; per-entry `btcHeld`
  restored verbatim as historical ledger); (c) `cbCollateralBtc`/`strikeCollateralBtc` folded from the
  imported `dayLog` in the SAME commit (the `setDayLog` discipline; the §5b `deriveReadingAnchors` seam
  is NOT run — imported settings already carry the anchor scalars+asOf); (d) `planDirty`/
  `recordsDirty` (+ `prefsDirty` when a pref was restored) + **`initialSettingsPullDone:true`** (lets the publishes
  proceed at once; until 4e it also blocked `sync.ts`'s first-pull exception — Fix B, retired with `settings:v1` —
  from hydrating remote OVER the import). Since 4c (a) appends the plan fields as plan events (one ts) in the same
  commit. Then kicks `publishPlanEventsNow()` + the records publish (both gate/auth/viewer-guarded → no-op for a
  gated/unauth/viewer key); restored prefs ride the next sync.
- **`RestoreBackupFlow.tsx` (+ `.module.css`, NEW):** ceremony-style overlay (`{onClose}`, own
  `.overlay`/`.modal` z-index 99999, no portal — the `RecoveryKeyCeremony` pattern; owns the screen so
  no back-chain/edge-swipe escapes mid-restore). Steps `pick → validating → summary → applying → done
  → error`; `<input type="file" accept="application/json">` + `FileReader.readAsText`, 10 MB cap before
  parse (net-new — no prior file-input in the repo). Mounted from the SettingsMain **Backup** subpage
  via a `restoreOpen` boolean beside "Export plan" (mirrors `ceremonyOpen`); owner-only by construction.
- **Tests:** `validatePlanBackup.test.ts` (round-trip of a real `buildPlanBackup`, all rejections,
  string-keyed `deletedMonths` accepted, the gate test, + a drift-guard pinning `VALIDATE_WHITELIST`/
  `APPLY_FIELDS` against `buildSettingsPayload` keys) + `applyPlanBackup.test.ts` (gated key stays gated,
  transport untouched, `initialSettingsPullDone` set, caches match the imported dayLog). No store bump.

---

