import { describe, it, expect } from 'vitest';
import { isBackupGateSatisfied } from '../backupGate';

// R2a-1 — the backup gate predicate. A key this device GENERATED is the only copy until the user proves
// they saved it; everything else is satisfied by construction.

const T = 1_700_000_000_000;

describe('isBackupGateSatisfied', () => {
  // R2c-4a retired the K2 bridge, so this is PRODUCTION REALITY, not a hypothetical: every freshly generated
  // key sits in this state from the end of onboarding until the R2c-1 ceremony verifies the save.
  it("'generated' + no verification → NOT satisfied (the whole point)", () => {
    expect(isBackupGateSatisfied({ keyProvenance: 'generated', backupVerifiedAt: null })).toBe(false);
  });

  it("'generated' + a verification timestamp → satisfied", () => {
    expect(isBackupGateSatisfied({ keyProvenance: 'generated', backupVerifiedAt: T })).toBe(true);
  });

  it("'imported' → satisfied even with no verification (the user pasted a key they already hold)", () => {
    expect(isBackupGateSatisfied({ keyProvenance: 'imported', backupVerifiedAt: null })).toBe(true);
  });

  it("'external' → satisfied even with no verification (key lives in the extension / remote signer)", () => {
    expect(isBackupGateSatisfied({ keyProvenance: 'external', backupVerifiedAt: null })).toBe(true);
  });

  it('null provenance → satisfied — LEGACY plan, grandfathered STRUCTURALLY (there is deliberately no migration)', () => {
    expect(isBackupGateSatisfied({ keyProvenance: null, backupVerifiedAt: null })).toBe(true);
  });

  it('a verification timestamp of 0 is falsy but NOT null — treated as verified (== null is the check, not truthiness)', () => {
    expect(isBackupGateSatisfied({ keyProvenance: 'generated', backupVerifiedAt: 0 })).toBe(true);
  });
});
