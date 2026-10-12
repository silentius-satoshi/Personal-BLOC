// Foreground-only live relay subscription — module singleton.
// Durable state, ephemeral connections: the sub is disposable (opened on visible, torn down on
// hidden, recreated with a fresh `since` every time). No keepalives, no reconnect state machines.
// It is a TRANSPORT only — a plan or prefs event goes through applyRemoteEvent, same as the batch pull; a journal event
// (5b: the manifest, or a pre-5b app's records:v1) schedules the journal pull, which reads the journal as one unit.

import { SimplePool } from 'nostr-tools/pool';
import { useStore } from '../../store/useStore';
import { applyRemoteEvent, scheduleJournalPull, type RemoteEvent } from './sync';
import { signerOpTimeout } from './timeout';
import { RECORDS_DTAG, PLAN_EVENTS_DTAG, PREFS_DTAG, ownLatestEventId } from './publish';
import { JOURNAL_MANIFEST_DTAG } from './journalPages';
import { nostrLog } from './log';
import { isBackupGateSatisfied } from '../backupGate';

let sub: ReturnType<SimplePool['subscribeMany']> | null = null;
let pool: SimplePool | null = null;
let subRelays: string[] = [];

async function handleLiveEvent(event: RemoteEvent): Promise<void> {
  const s = useStore.getState();
  // Don't ring a dead phone: while the reconnect affordance is up, skip decrypt attempts —
  // the post-re-auth batch sync catches up.
  if (!s.nostrSigner?.nip44 || !s.nostrPubkey || s.nostrReconnectNeeded) return;
  const dTag = event.tags.find(([t]) => t === 'd')?.[1];
  if (dTag === RECORDS_DTAG || dTag === JOURNAL_MANIFEST_DTAG) {
    // 5b — the manifest is published after the pages, so its arrival means the pages are there. This device's own
    // echo (the id it just signed) changes nothing and is skipped — a pull costs a query and a decrypt per page.
    if (!event.id || event.id !== ownLatestEventId(dTag)) scheduleJournalPull();
    return;
  }
  const ok = await applyRemoteEvent(s.nostrSigner, s.nostrPubkey, event, signerOpTimeout(s.nostrSigningMethod));
  if (!ok) useStore.getState().setNostrReconnectNeeded(true);
}

export function openLiveSync(): void {
  if (sub) return;   // singleton, idempotent
  const { nostrPubkey, nostrRelays, keyProvenance, backupVerifiedAt } = useStore.getState();
  // Backup gate: a generated-but-unverified key opens no subscription (the engine is silent end to end).
  if (!nostrPubkey || !nostrRelays.length || !isBackupGateSatisfied({ keyProvenance, backupVerifiedAt })) return;
  pool = new SimplePool();
  subRelays = nostrRelays;
  // since−60s overlap is deliberate: appliers are idempotent — overlap is free, gaps are expensive.
  // Self-echo no-ops naturally (plan-events echo unions to identity; prefs echo fails the watermark) or is skipped by
  // id (5b: the journal's manifest and records:v1).
  // EOSE ignored: the batch path owns history. NOTE: subscribeMany takes a SINGLE filter at 2.23.5. The journal's pages
  // are not subscribed: the manifest lists them, and the pull fetches the ones that changed.
  sub = pool.subscribeMany(
    nostrRelays,
    {
      kinds:   [30078],
      authors: [nostrPubkey],
      '#d':    [RECORDS_DTAG, JOURNAL_MANIFEST_DTAG, PLAN_EVENTS_DTAG, PREFS_DTAG],
      since:   Math.floor(Date.now() / 1000) - 60,
    },
    { onevent: (event) => { void handleLiveEvent(event); } },
  );
  nostrLog('info', `live sub open (${nostrRelays.length} relays)`);
}

export function closeLiveSync(): void {
  if (!sub) {
    pool?.close(subRelays);   // stray pool without a sub — defensive
    pool = null;
    subRelays = [];
    return;
  }
  sub.close();
  pool?.close(subRelays);
  sub = null;
  pool = null;
  subRelays = [];
  nostrLog('info', 'live sub closed');
}
