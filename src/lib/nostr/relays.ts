import { SimplePool } from 'nostr-tools/pool';

/**
 * The single source of truth for the default relay list — consumed by the store's `nostrRelays` default, the
 * Network subpage's "Restore defaults", `publish.ts`'s `FALLBACK_RELAYS`, and NIP-65 discovery bootstrap below.
 * Keep them unified so they can't drift (a dead relay baked into one copy was the prior bug).
 */
export const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://relay.primal.net',
  'wss://nos.lol',
];

const BOOTSTRAP_RELAYS = DEFAULT_RELAYS;

/**
 * Normalize + validate a user-entered relay URL. Returns the canonical `wss://…` string, or null if malformed.
 * - no scheme typed → prepend `wss://` (friendly default; standard relay-input UX)
 * - require `wss:` (or `ws:` ONLY for localhost dev) — reject http/other schemes
 * - lowercase host, strip a trailing slash
 */
export function normalizeRelayUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = trimmed.includes('://') ? trimmed : `wss://${trimmed}`;
  let url: URL;
  try { url = new URL(withScheme); } catch { return null; }
  const isLocalhost = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'wss:' && !(url.protocol === 'ws:' && isLocalhost)) return null;
  url.hostname = url.hostname.toLowerCase();
  return url.toString().replace(/\/$/, '');   // drop the trailing slash URL adds for a root path
}

/**
 * Pure add-relay: normalize → reject invalid → reject duplicate → append. Returns the (possibly unchanged) list and
 * an error message (null on success). Used by the Network subpage so add/dedupe/validate is one unit-testable step.
 */
export function addRelay(list: string[], input: string): { list: string[]; error: string | null } {
  const normalized = normalizeRelayUrl(input);
  if (!normalized) return { list, error: 'Enter a valid wss:// relay URL' };
  if (list.includes(normalized)) return { list, error: 'That relay is already in your list' };
  return { list: [...list, normalized], error: null };
}

/**
 * Read the user's NIP-65 (kind 10002) relay list. Unlike `fetchUserRelays`, this returns a DISCRIMINATED result and
 * does NOT fall back to defaults on no-event/empty/error — the caller (Network "Import from Nostr") must distinguish
 * "found your real list" from "found nothing" so it never silently overwrites a real list with the default 3.
 * Flat list: ALL `r` tags (no write/read marker filter — Personal ₿LOC treats its relay list as one flat connect set).
 * A 10002 with no usable `r` tags → `{ found: true, relays: [] }` (distinct from not-found).
 */
export async function importNip65RelayList(
  pubkey: string,
  bootstrapRelays: string[] = BOOTSTRAP_RELAYS,
): Promise<{ found: true; relays: string[] } | { found: false }> {
  const pool = new SimplePool();
  try {
    const events = await pool.querySync(bootstrapRelays, { kinds: [10002], authors: [pubkey], limit: 1 });
    if (!events.length) return { found: false };   // NO fallback to defaults — caller decides
    const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
    const relays = [...new Set(
      latest.tags
        .filter(([t]) => t === 'r')                                  // ALL r tags — flat (no write/read filter)
        .map(([, url]) => normalizeRelayUrl(url ?? ''))
        .filter((u): u is string => !!u),                            // drop unnormalizable
    )];
    return { found: true, relays };                                 // empty array stays {found:true} — distinct from not-found
  } catch {
    return { found: false };                                        // query error → not-found, NOT defaults
  } finally {
    pool.close(bootstrapRelays);
  }
}

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
