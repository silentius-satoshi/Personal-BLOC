import { getToken } from 'nostr-tools/nip98';
import type { NostrSigner } from '@nostrify/nostrify';

// NIP-98 client token cache for the Strike proxies. getToken's `sign` callback is a REMOTE round-trip on
// NIP-46, and useStrikeData polls every 60s — signing per-poll would prompt-spam / round-trip the remote
// signer every minute. NIP-98 events are valid ±60s, so we cache a signed token for ~50s and re-sign on
// demand (margin for clock skew + network). Local/NIP-07 sign instantly (cache is a minor optimization);
// NIP-46 is what the cache is for — ~1 remote sign per ~50s per URL, not per fetch.
//
// Cache is per (url, method) and in-memory only (module-level; cleared on reload).
let cached: { url: string; method: string; token: string; signedAt: number } | null = null;

/** Returns an `Authorization` header value (`"Nostr <base64>"`), cached until near NIP-98 expiry. */
export async function getProxyAuthHeader(
  url: string,
  method: string,
  signer: NostrSigner,
): Promise<string> {
  const now = Date.now();
  if (cached && cached.url === url && cached.method === method && now - cached.signedAt < 50_000) {
    return cached.token;
  }
  // getToken's sign param is nostr-tools-typed; signer.signEvent is @nostrify-typed (same event shape) → cast.
  const token = await getToken(url, method, (e) => signer.signEvent(e as never) as never, true);
  cached = { url, method, token, signedAt: now };
  return token;
}

/** Test-only — clears the module cache so cases start fresh. */
export function resetProxyAuthCache(): void {
  cached = null;
}
