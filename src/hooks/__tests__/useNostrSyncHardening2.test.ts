import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hardening 2 — useNostrSync.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HY.json).
 * A hook with no render harness: the retry effect's dependency array is read off the source (all of it — bridgeRetired's
 * RETRY reads only its first four entries).
 */
const SRC = readFileSync(join(process.cwd(), 'src/hooks/useNostrSync.ts'), 'utf8');

describe('Hardening 2 — useNostrSync', () => {
  it('HY-13 · sync.md "The dirty-gated retry never starts an unlock" — isAuthenticated is in the retry effect\'s deps, so an unlock while dirty arms the retry', () => {
    const call = SRC.indexOf('\n      scheduleDirtyRetry(');   // the effect's call (the definition is `export function …`)
    const open = SRC.indexOf('\n    [', call);
    const deps = SRC.slice(open + '\n    ['.length, SRC.indexOf(']', open)).split(',').map((d) => d.trim());
    expect(call > 0 && open > call, 'HY-13 premise: the retry effect is read').toBe(true);
    expect(deps.includes('recordsDirty') && deps.includes('triggerSync'), 'HY-13 premise: its deps array').toBe(true);
    expect(deps.includes('isAuthenticated'), 'HY-13 the unlock re-runs the retry effect').toBe(true);
  });
});
