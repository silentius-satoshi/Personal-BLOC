import { describe, it, expect } from 'vitest';
import { guardPayload, PayloadTooLargeError } from '../syncGuard';
import { PLAIN_STEP_BYTES } from '../payloadSize';
import { PLAN_EVENTS_DTAG } from '../publish';

/**
 * Hardening 2 — syncGuard.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 */
describe('Hardening 2 — syncGuard', () => {
  it('HY-06 · sync.md "nothing is published past NIP-44\'s step" (refuses PAST 40,960 B) — exactly the step goes out; one byte past it is refused', () => {
    expect(PLAIN_STEP_BYTES, 'HY-06 premise: the step').toBe(40_960);
    expect(() => guardPayload(PLAN_EVENTS_DTAG, PLAIN_STEP_BYTES), 'HY-06 exactly the step is publishable').not.toThrow();
    expect(() => guardPayload(PLAN_EVENTS_DTAG, PLAIN_STEP_BYTES + 1), 'HY-06 one byte past is refused').toThrow(PayloadTooLargeError);
  });
});
