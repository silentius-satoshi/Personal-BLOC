// NIP-98 owner-request validation — shared by api/strike-balances.js + api/strike-rates.js.
// Replaces the old shared x-app-secret check: the proxy now requires a Nostr-signed kind-27235 request
// (Authorization: Nostr <base64>) verified server-side (kind/ts/url/method + schnorr signature) and matched
// against the owner's hex pubkey. The bundle holds NO secret — access requires the owner's signature.
//
// _-prefixed dir → Vercel does NOT route this as a function; it's bundled into each proxy's import graph.
// Plain ESM .js so it imports cleanly in BOTH the Vercel node runtime and vitest.
//
// validateToken returns Promise<boolean> (and may ALSO throw on a malformed/unparseable token). We handle
// BOTH: the thrown case (catch) AND the false-return case (the explicit `if (!valid)`). A bare try/catch that
// ignored the return value would let an invalid-but-parseable token through. (nostr-tools 2.23.5 happens to
// throw rather than return false, but checking both is version-robust and costs nothing — defense in depth.)
import { validateToken, unpackEventFromToken } from 'nostr-tools/nip98';

// Returns { ok: true } | { status: 401 | 403 }.
export async function validateOwnerRequest(authHeader, url, method, ownerPubkey) {
  if (!ownerPubkey || !authHeader) return { status: 401 };
  try {
    const valid = await validateToken(authHeader, url, method);  // kind/ts/url/method + verifyEvent
    if (!valid) return { status: 401 };                          // false return = invalid
    const event = await unpackEventFromToken(authHeader);
    if (event.pubkey !== ownerPubkey) return { status: 403 };    // valid sig, wrong key
    return { ok: true };
  } catch {
    return { status: 401 };                                      // malformed / unparseable / verifyEvent threw
  }
}
