import { getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import { wrapSecretKey, type WrapMethod } from './keyVault';
import { syncNow, markSignerFresh } from './syncNow';
import type { NostrParam } from './session';
import type { NostrSigner } from './signers';
import { useStore } from '../../store/useStore';

/**
 * Phase 1.5 — the SINGLE local-owner identity-establish path. Extracted VERBATIM from NostrAuthGate's
 * import-nsec body so the import path AND the owner key-gen flow (OwnerKeySetup K3) can't drift: wrap the
 * key at rest → persist the wrapped credential → build the in-memory signer → mark the identity → sync →
 * authenticate. Fire-and-forget syncNow, exactly as the import path.
 *
 * ⚠ NEVER log the nsec (no nostrLog of key material). Caller owns the nsec buffer; this zeros it on the
 * happy path (best-effort — NSecSigner holds its own copy), but callers should keep their own
 * error-path sk.fill(0) since a throw here (e.g. Face ID cancelled) skips the final zero.
 */
export async function establishLocalOwner(
  sk: Uint8Array,
  method: WrapMethod,
  nostr: NostrParam,
  opts?: { pin?: string; keyLabel?: string },
): Promise<void> {
  const { ciphertext, meta } = await wrapSecretKey(
    sk, method,
    method === 'pin' ? opts?.pin : undefined,
    method !== 'pin' ? opts?.keyLabel : undefined,
  );
  const s = useStore.getState();
  s.setWriterKeyWrapped(ciphertext);
  s.setWriterKeyWrapMeta(meta);

  const signer = new NSecSigner(sk.slice()) as unknown as NostrSigner;
  s.setNostrSigner(signer);
  markSignerFresh();
  s.setNostrPubkey(getPublicKey(sk));
  s.setNostrSigningMethod('local');
  syncNow(nostr);              // fire-and-forget, exactly as the import path
  s.setIsAuthenticated(true);
  sk.fill(0);                  // best-effort zero; NSecSigner holds its own copy for the session
}
