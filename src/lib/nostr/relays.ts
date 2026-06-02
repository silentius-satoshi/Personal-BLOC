import { SimplePool } from 'nostr-tools/pool';

const BOOTSTRAP_RELAYS = [
  'wss://relay.primal.net',
  'wss://relay.damus.io',
  'wss://nos.lol',
];

export async function fetchUserRelays(
  pubkey: string,
  bootstrapRelays: string[] = BOOTSTRAP_RELAYS,
): Promise<string[]> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(bootstrapRelays, {
      kinds:   [10002],
      authors: [pubkey],
      limit:   1,
    });

    if (!events.length) return BOOTSTRAP_RELAYS;

    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];

    const writeRelays = latest.tags
      .filter(([t, , marker]) => t === 'r' && (!marker || marker === 'write'))
      .map(([, url]) => url)
      .filter(Boolean);

    return writeRelays.length > 0 ? writeRelays : BOOTSTRAP_RELAYS;
  } catch {
    return BOOTSTRAP_RELAYS;
  } finally {
    pool.close(bootstrapRelays);
  }
}
