// 5b (spec `pbloc-spec-journal-pages-v1`) — the journal's sync state for this session, and the one lane its pulls and
// publishes run in. What this device knows the relays hold: each page's listing (item count + fingerprint), the
// manifest's fingerprint, the listed pages it could not read, and the records:v1 bridge. A publish writes only what
// differs from it; a pull resets it from what the relays returned. Module state — never persisted or synced: a reload
// (sign-out reloads) starts it empty, and it is keyed by pubkey besides. Store-free, so sync.ts and syncEngine.ts can
// both import it (sync.test mocks syncEngine, not this).
import type { ManifestPage } from './journalPages';

/** The last pull's relay check — what DevPanel's JOURNAL section shows. Page keys are months, never journal content. */
export interface JournalCheck {
  at:       number;                    // Date.now() when the pull finished
  full:     boolean;                   // every listed page was fetched (the session's first pull)
  listed:   number;                    // pages the manifest lists (0 with no manifest)
  fetched:  number;                    // pages fetched
  missing:  string[];                  // listed pages the relays did not return, after one retry
  manifest: boolean;                   // the relays hold a readable manifest
  v1:       'none' | 'full' | 'stub';  // what the relays hold on records:v1
}

export interface JournalKnown {
  pages:         Map<string, ManifestPage>;   // page key → the listing (count + fingerprint) of the copy the relays hold
  manifestH:     string | null;               // the relays' manifest's fingerprint; null when there is none
  unreadable:    Map<string, ManifestPage>;   // listed pages this device could not read — carried in every manifest it publishes
  v1:            string | null;               // the records:v1 bridge on the relays: its content's fingerprint, 'stub', or null (none)
  seenAt:        number;                      // the newest created_at among the journal events seen or published (a floor:
                                              // every journal publish goes out newer — a device whose clock is behind
                                              // still replaces what it read; without it a relay keeps the "newer" copy)
  pulled:        boolean;                     // a pull read the relays' journal this session (every decrypt succeeded)
  fullCheckDone: boolean;                     // the session's full page check ran
  check:         JournalCheck | null;
}

const fresh = (): JournalKnown => ({
  pages: new Map(), manifestH: null, unreadable: new Map(), v1: null, seenAt: 0, pulled: false, fullCheckDone: false, check: null,
});

let owner = '';
let known: JournalKnown = fresh();

/** This session's journal state for the key — another key starts empty. */
export function journalKnown(pubkey: string): JournalKnown {
  if (pubkey !== owner) { owner = pubkey; known = fresh(); }
  return known;
}
/** The current state, for DevPanel (whatever key it belongs to). */
export function peekJournalKnown(): Readonly<JournalKnown> { return known; }

// One lane: a journal pull and a journal publish never interleave — each reads the journal and this state, and writes
// one or the other. A pull that finds the relays behind queues its repair publish behind itself; it never awaits it
// (that would wait on itself).
let lane: Promise<unknown> = Promise.resolve();
export function inJournalLane<T>(fn: () => Promise<T>): Promise<T> {
  const run = lane.then(fn);
  lane = run.catch(() => undefined);
  return run;
}
/** Resolves once every queued journal pull and publish has finished, repairs included — tests. */
export async function journalIdle(): Promise<void> {
  let seen: Promise<unknown>;
  do { seen = lane; await seen; } while (seen !== lane);
}
/** Tests only. */
export function resetJournalState(): void { owner = ''; known = fresh(); }
