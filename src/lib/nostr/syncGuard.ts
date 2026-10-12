// 5b (spec `pbloc-spec-journal-pages-v1`) — the size guard. publishEncrypted refuses a payload whose plain JSON is past
// NIP-44's 40,960 B padding step BEFORE it encrypts or signs: past the step the event goes out at ~66 KB, over a 64 KiB
// relay limit (strfry's default), and every retry would fail the same way — while the app said "Reconnect", as if the
// signer were the problem. A refused payload is recorded here by its d-tag (cleared by that d-tag's next good publish),
// so the app can say what is too large, in plain words. Module state, not store state: nothing here is persisted or
// synced, and the store's shape doesn't change. Store-free, so publish.ts can import it.
import { PLAIN_STEP_BYTES } from './payloadSize';

export class PayloadTooLargeError extends Error {
  readonly dTag: string;
  readonly plainBytes: number;
  constructor(dTag: string, plainBytes: number) {
    super(`payload too large to sync: ${dTag} is ${plainBytes} B plain (the limit is ${PLAIN_STEP_BYTES} B)`);
    this.name = 'PayloadTooLargeError';
    this.dTag = dTag;
    this.plainBytes = plainBytes;
  }
}

export type SyncChannel = 'journal' | 'plan' | 'prefs' | 'viewer';

/** The channel a d-tag belongs to — for the words the app shows. */
export function channelOf(dTag: string): SyncChannel | null {
  if (dTag.startsWith('personal-bloc:records:')) return 'journal';
  if (dTag === 'personal-bloc:plan-events:v1') return 'plan';
  if (dTag === 'personal-bloc:prefs:v1') return 'prefs';
  if (dTag.startsWith('personal-bloc:viewer:')) return 'viewer';
  return null;
}

const blocked = new Map<string, number>();   // d-tag → plain bytes refused
const listeners = new Set<() => void>();
let snapshot: readonly SyncChannel[] = [];

function refresh(): void {
  const channels = [...new Set([...blocked.keys()].map(channelOf).filter((c): c is SyncChannel => c !== null))].sort();
  if (channels.join() !== snapshot.join()) {
    snapshot = channels;
    for (const l of listeners) l();
  }
}

/** Refuse a payload past the step: record it and throw, before any encrypt or sign. A payload within the step clears
 *  its d-tag's record — the record means "this d-tag's latest attempt was refused for its size". */
export function guardPayload(dTag: string, plainBytes: number): void {
  if (plainBytes > PLAIN_STEP_BYTES) {
    blocked.set(dTag, plainBytes);
    refresh();
    throw new PayloadTooLargeError(dTag, plainBytes);
  }
  if (blocked.delete(dTag)) refresh();
}
/** Drop the records of d-tags `keep` rejects — the journal's publish drops a refused page that no longer exists (its
 *  month emptied), so its warning doesn't outlive it. */
export function pruneBlocked(keep: (dTag: string) => boolean): void {
  let changed = false;
  for (const dTag of [...blocked.keys()]) if (!keep(dTag)) { blocked.delete(dTag); changed = true; }
  if (changed) refresh();
}
/** The refused d-tags and their plain sizes — DevPanel and Copy Diagnostics (d-tags and sizes only). */
export function getBlockedDTags(): ReadonlyMap<string, number> { return blocked; }
/** The channels with a refused payload now — a stable array (same reference until it changes), for useSyncExternalStore. */
export function getBlockedChannels(): readonly SyncChannel[] { return snapshot; }
export function isChannelBlocked(channel: SyncChannel): boolean { return snapshot.includes(channel); }
export function subscribeBlocked(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
/** Tests only. */
export function resetSyncGuard(): void { blocked.clear(); refresh(); }
