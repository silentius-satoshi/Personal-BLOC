import { describe, it, expect, beforeEach } from 'vitest';

// node env has no localStorage — minimal in-memory shim (defined before importing the store so its setters
// write through to it). The module-init seed/back-fill ran at import against no localStorage (→ null seeds),
// which is fine; this suite exercises the SETTER write-through path.
const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => { mem.set(k, String(v)); },
  removeItem: (k: string) => { mem.delete(k); },
  clear: () => { mem.clear(); },
};

import { useStore } from '../useStore';

const WK_WRAPPED_KEY = 'personal-bloc-writer-key-wrapped';
const WK_META_KEY    = 'personal-bloc-writer-key-meta';
const META = { iv: 'aXY=', scheme: 'pin' as const, salt: 'c2FsdA==' };

describe('writer wrap credential — standalone localStorage backing', () => {
  beforeEach(() => { mem.clear(); });

  it('setWriterKeyWrapped writes through to the standalone key (NOT the persist blob)', () => {
    useStore.getState().setWriterKeyWrapped('CIPHERTEXT');
    expect(localStorage.getItem(WK_WRAPPED_KEY)).toBe('CIPHERTEXT');
    expect(useStore.getState().writerKeyWrapped).toBe('CIPHERTEXT');
    // it is NOT the encrypted persist blob key
    expect(localStorage.getItem('personal-bloc-store')).toBeNull();
  });

  it('setWriterKeyWrapMeta writes JSON through to the standalone key', () => {
    useStore.getState().setWriterKeyWrapMeta(META);
    expect(JSON.parse(localStorage.getItem(WK_META_KEY)!)).toEqual(META);
    expect(useStore.getState().writerKeyWrapMeta).toEqual(META);
  });

  it('setting null clears the standalone keys (Remove local key)', () => {
    useStore.getState().setWriterKeyWrapped('X');
    useStore.getState().setWriterKeyWrapMeta(META);
    useStore.getState().setWriterKeyWrapped(null);
    useStore.getState().setWriterKeyWrapMeta(null);
    expect(localStorage.getItem(WK_WRAPPED_KEY)).toBeNull();
    expect(localStorage.getItem(WK_META_KEY)).toBeNull();
    expect(useStore.getState().writerKeyWrapped).toBeNull();
    expect(useStore.getState().writerKeyWrapMeta).toBeNull();
  });
});
