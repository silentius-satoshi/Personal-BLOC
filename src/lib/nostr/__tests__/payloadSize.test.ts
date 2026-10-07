import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';

// 5a — a relay payload judged by its PLAIN size, where NIP-44's padding steps sit (spec `pbloc-spec-plan-log-size-v1`).
// Every ⭐ is proven red by a named mutation (the spec's Appendix P).
import { payloadSizeLevel, PLAIN_STEP_BYTES, WIRE_WARN_BYTES } from '../payloadSize';
import { PLAN_LOG_BUDGET_BYTES } from '../../planEvents/compact';

describe('5a — the payload size budget', () => {
  it('⭐ PADDING — the step is real: 40,960 B of plain JSON encrypts under 64 KiB, one byte more over it', () => {
    const key = nip44.getConversationKey(generateSecretKey(), getPublicKey(generateSecretKey()));
    const at = nip44.encrypt('x'.repeat(PLAIN_STEP_BYTES), key);
    const past = nip44.encrypt('x'.repeat(PLAIN_STEP_BYTES + 1), key);
    // base64 of version + nonce + (2-byte length + padded plaintext) + mac: 40,960 pads to 40,960, 40,961 to 49,152
    expect(at.length, 'PADDING at the step').toBe(4 * Math.ceil((1 + 32 + 2 + 40_960 + 32) / 3));
    expect(past.length, 'PADDING past the step').toBe(4 * Math.ceil((1 + 32 + 2 + 49_152 + 32) / 3));
    expect(at.length + 1_000, 'PADDING at: room for the event around it').toBeLessThan(65_536);
    expect(past.length, 'PADDING past: over 64 KiB before the event around it').toBeGreaterThan(65_536);
    // and the budget is a full padding step below
    const budget = nip44.encrypt('x'.repeat(PLAN_LOG_BUDGET_BYTES), key);
    expect(budget.length, 'PADDING budget').toBe(4 * Math.ceil((1 + 32 + 2 + 32_768 + 32) / 3));
  });

  it('⭐ TINT — ok up to the budget, near past it, over past 40,960 B plain; with no plain size, the wire budget', () => {
    expect(payloadSizeLevel({ plainBytes: 6_011, eventBytes: 8_666 }), 'TINT a small log').toBe('ok');
    expect(payloadSizeLevel({ plainBytes: PLAN_LOG_BUDGET_BYTES }), 'TINT at the budget').toBe('ok');
    expect(payloadSizeLevel({ plainBytes: PLAN_LOG_BUDGET_BYTES + 1 }), 'TINT near').toBe('near');
    expect(payloadSizeLevel({ plainBytes: PLAIN_STEP_BYTES, eventBytes: 55_086 }), 'TINT at the step').toBe('near');
    expect(payloadSizeLevel({ plainBytes: PLAIN_STEP_BYTES + 1, eventBytes: 66_010 }), 'TINT over').toBe('over');
    expect(payloadSizeLevel({ eventBytes: WIRE_WARN_BYTES }), 'TINT wire').toBe('ok');
    expect(payloadSizeLevel({ eventBytes: WIRE_WARN_BYTES + 1 }), 'TINT wire near').toBe('near');
  });

  it('⭐ DEVPANEL — the size rows read the plain size, and PLAN EVENTS shows the live log size', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/Settings/DevPanel.tsx'), 'utf8');
    expect(src, 'DEVPANEL tint').toMatch(/SIZE_COLOR\[payloadSizeLevel\(size\)\]/);
    expect(src.match(/sizeStyle\(r\)/g)?.length, 'DEVPANEL both report rows').toBe(2);
    expect(src, 'DEVPANEL no wire-only budget').not.toMatch(/WARN_EVENT_BYTES/);
    expect(src, 'DEVPANEL log size').toMatch(/JSON\.stringify\(\{ events: compactedPlan \}\)/);
    expect(src, 'DEVPANEL log size row').toMatch(/>log size</);
    expect(src, 'DEVPANEL log size tint').toMatch(/sizeStyle\(\{ plainBytes: planLogPlainBytes \}\)/);
  });
});
