import { describe, it, expect, vi } from 'vitest';
import { publishEncrypted, PLAN_EVENTS_DTAG } from '../publish';
import { PayloadTooLargeError } from '../syncGuard';

/**
 * Hardening 2 — publish.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 * A stub signer: nothing is encrypted, signed or sent.
 */
describe('Hardening 2 — publish', () => {
  it('HY-04 · sync.md "nothing is published past NIP-44\'s step" — the guard measures UTF-8 bytes: a multi-byte payload past the step is refused before any encrypt', async () => {
    const encrypt = vi.fn(async () => 'never');
    const signer = { nip44: { encrypt, decrypt: vi.fn() }, getPublicKey: vi.fn(), signEvent: vi.fn() } as never;
    // 'é' × 30,000: 30,002 UTF-16 code units as JSON — under 40,960 — but 60,002 bytes, past it.
    await expect(publishEncrypted(signer, 'pk', PLAN_EVENTS_DTAG, 'é'.repeat(30_000)), 'HY-04 refused as too large')
      .rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(encrypt, 'HY-04 before any encrypt').not.toHaveBeenCalled();
  });
});
