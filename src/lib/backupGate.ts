// The backup gate — a pure predicate, zero imports (no cycle). Consulted at exactly the layer
// `isAuthenticated` already is: the existing sync/publish guard sites, never deeper.

export type KeyProvenance = 'generated' | 'imported' | 'external';

/**
 * A key this device GENERATED is the only copy until the user proves they saved it — until then
 * nothing syncs or publishes (relays hold ciphertext; a lost sole key is unrecoverable data).
 * Everything else is satisfied by construction:
 *
 *   'imported' | 'external' — the user already holds the key elsewhere (pasted nsec, NIP-07
 *                             extension, NIP-46 remote signer). Nothing to back up here.
 *   null                    — LEGACY: the plan was established before R2. Grandfathering is
 *                             STRUCTURAL, not a migration: the persist `merge` fills the absent
 *                             field from initial state (null) on every rehydrate, so an existing
 *                             owner is never gated. There is deliberately NO migration.
 *
 * NEVER consulted on viewer paths: viewerSync publishes nothing, and every owner publish path
 * already fails its viewerMode / auth guard before this predicate is reached.
 */
export function isBackupGateSatisfied(s: {
  keyProvenance: KeyProvenance | null;
  backupVerifiedAt: number | null;
}): boolean {
  return s.keyProvenance !== 'generated' || s.backupVerifiedAt != null;
}
