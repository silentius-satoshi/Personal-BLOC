// 5b (spec `pbloc-spec-journal-pages-v1`) — the sync channels whose latest payload the size guard refused (syncGuard),
// for the plain-words warning in AppShell and Settings. Module state read through useSyncExternalStore: never
// persisted, gone on a reload, cleared by the channel's next payload that fits.
import { useSyncExternalStore } from 'react';
import { getBlockedChannels, subscribeBlocked, type SyncChannel } from '../lib/nostr/syncGuard';

export function useSyncBlocked(): readonly SyncChannel[] {
  return useSyncExternalStore(subscribeBlocked, getBlockedChannels, getBlockedChannels);
}

export const CHANNEL_LABEL: Record<SyncChannel, string> = {
  journal: 'Journal', plan: 'Plan', prefs: 'Preferences', viewer: 'Viewer snapshot',
};

/** What is too large, and what that means — in the person's words, not the protocol's. */
export const TOO_LARGE_COPY: Record<SyncChannel, string> = {
  journal: 'Part of your journal is too large to send to your relays. Everything is saved on this device; your other devices won’t get that part yet.',
  plan:    'Your plan is too large to send to your relays. It is saved on this device; your other devices won’t get the latest changes yet.',
  prefs:   'Your preferences are too large to send to your relays. They are saved on this device.',
  viewer:  'The snapshot for your viewers is too large to send. They keep seeing the last one that went out.',
};
