import { describe, it, expect } from 'vitest';
import { isOwnerPubkey } from '../ownerGate';

const OWNER = 'a'.repeat(64);   // a hex pubkey
const OTHER = 'b'.repeat(64);

describe('isOwnerPubkey', () => {
  it('matches when the pubkey equals the configured owner', () => {
    expect(isOwnerPubkey(OWNER, OWNER)).toBe(true);
  });

  it('rejects a non-owner key when an owner is configured', () => {
    expect(isOwnerPubkey(OTHER, OWNER)).toBe(false);
  });

  it('rejects a null pubkey when an owner is configured', () => {
    expect(isOwnerPubkey(null, OWNER)).toBe(false);
  });

  it('unset owner env → no lockout (any pubkey is the owner)', () => {
    expect(isOwnerPubkey(OWNER, undefined)).toBe(true);
    expect(isOwnerPubkey(OTHER, undefined)).toBe(true);
    expect(isOwnerPubkey(null, undefined)).toBe(true);
    expect(isOwnerPubkey(OTHER, '')).toBe(true);   // empty string is unset too
  });
});
