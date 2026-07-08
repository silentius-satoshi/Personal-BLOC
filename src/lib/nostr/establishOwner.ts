import { getPublicKey } from 'nostr-tools';
import { NSecSigner } from '@nostrify/nostrify';
import { wrapSecretKey, type WrapMethod, type PayloadKind } from './keyVault';
import { deriveSkFromEntropy } from './nip06Key';
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
 * R2b-1: `payload` may be a raw secret key ('sk', the default) OR the 16 bytes of NIP-06 entropy behind the
 * recovery words ('nip06-entropy'). ⚠ The signing key is DERIVED from the payload we just wrapped — never taken
 * from the caller — so the identity we authenticate as is provably the one unwrapSecretKey will later produce
 * from this exact ciphertext (it runs the same deriveSkFromEntropy). A caller-supplied sk could silently
 * disagree and the wrapped key would never unlock the identity.
 *
 * ⚠ NEVER log key material (no nostrLog). This zeros BOTH the caller's payload buffer AND the derived sk on the
 * happy path (best-effort — NSecSigner holds its own copy), but callers should keep their own error-path
 * fill(0) since a throw here (e.g. Face ID cancelled) skips the final zero.
 */
export async function establishLocalOwner(
  payload: Uint8Array,
  method: WrapMethod,
  nostr: NostrParam,
  opts?: { pin?: string; keyLabel?: string; payloadKind?: PayloadKind },
): Promise<void> {
  const payloadKind = opts?.payloadKind ?? 'sk';   // absent ⇒ 'sk' — the R2a-2 compatibility default
  const { ciphertext, meta } = await wrapSecretKey(
    payload, method,
    method === 'pin' ? opts?.pin : undefined,
    method !== 'pin' ? opts?.keyLabel : undefined,
    payloadKind,
  );
  const s = useStore.getState();
  s.setWriterKeyWrapped(ciphertext);
  s.setWriterKeyWrapMeta(meta);

  // Derive the signing key from the payload we JUST WRAPPED (see the ⚠ in the doc) — for 'sk' the payload IS
  // the key; for 'nip06-entropy' derive it. Never accept an sk from the caller alongside an entropy payload.
  const sk = payloadKind === 'nip06-entropy' ? deriveSkFromEntropy(payload) : payload;

  const signer = new NSecSigner(sk.slice()) as unknown as NostrSigner;
  s.setNostrSigner(signer);
  markSignerFresh();
  s.setNostrPubkey(getPublicKey(sk));
  s.setNostrSigningMethod('local');
  syncNow(nostr);              // fire-and-forget, exactly as the import path
  s.setIsAuthenticated(true);
  payload.fill(0);             // best-effort zero of the caller's buffer; NSecSigner holds its own copy
  if (sk !== payload) sk.fill(0);   // the derived sk is ours to zero ('sk' path: sk === payload, already zeroed)
}
