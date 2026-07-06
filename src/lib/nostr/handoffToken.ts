// Viewer handoff token — a single string the owner hands to a viewer: `<keyPart>:<ownerNpub>`.
//   keyPart = a bech32 `nsec1…` (in-person, plaintext) OR a passphrase-encrypted `ncryptsec1…` (NIP-49,
//             safe for remote transport).
//   ownerNpub = the owner's npub, so the viewer pastes ONE string and doesn't need it via a second channel.
// bech32's charset excludes ':' → the join/split is unambiguous.
//
// PURE — no crypto here. nip19 is bech32 (de)coding, used only to VALIDATE the npub half; encrypt/decrypt of the
// key part happens in the caller (nip49). Tokens are strictly `<keyPart>:<ownerNpub>` (both halves required).

import { nip19 } from 'nostr-tools';

export type HandoffKind = 'nsec' | 'ncryptsec';
export interface ParsedHandoff {
  kind: HandoffKind;
  keyPart: string;
  ownerNpub: string;   // always present — tokens are 2-part
}

/** Join a key part + the owner's npub into a handoff token. */
export function buildHandoffToken(keyPart: string, ownerNpub: string): string {
  return `${keyPart}:${ownerNpub}`;
}

/**
 * Parse a handoff token. Returns null on anything malformed. Requires EXACTLY 2 parts (`<keyPart>:<ownerNpub>`) —
 * a bare key with no ':' is rejected (bare-nsec back-compat retired). Classifies the key part by PREFIX only
 * (`nsec1…`/`ncryptsec1…`) — full key/passphrase validity is the caller's crypto step. Validates the npub half
 * decodes as an npub.
 */
export function parseHandoffToken(raw: string): ParsedHandoff | null {
  const t = (raw ?? '').trim();
  if (!t) return null;
  const parts = t.split(':');
  if (parts.length !== 2) return null;   // exactly one ':' expected — token-only, no bare key

  const keyPart = parts[0].trim();
  let kind: HandoffKind;
  if (keyPart.startsWith('nsec1')) kind = 'nsec';
  else if (keyPart.startsWith('ncryptsec1')) kind = 'ncryptsec';
  else return null;

  const ownerNpub = parts[1].trim();
  if (!ownerNpub) return null;   // empty npub half → malformed
  try {
    const d = nip19.decode(ownerNpub);
    if (d.type !== 'npub') return null;
  } catch { return null; }

  return { kind, keyPart, ownerNpub };
}
