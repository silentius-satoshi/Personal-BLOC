// R2c-7b — PURE builders for the Recovery Key ceremony's downloadable backup. No React, no DOM, no crypto.
//
// ⚠ These functions HANDLE THE SECRET but never own its lifecycle: `artifact` is the caller's transient string
// (12 words, an nsec, or an ncryptsec). Never log it, never persist it here. See nip06Key.ts's header.

/**
 * What the file actually holds. A THREE-KIND union rather than `(kind, encrypted)` — it makes the impossible
 * `('ncryptsec', encrypted: false)` combination unrepresentable.
 *
 *  'words'     — the 12-word BIP-39 phrase (a 'nip06-entropy' key), plaintext
 *  'nsec'      — a bech32 secret key (a legacy 'sk' key), plaintext
 *  'ncryptsec' — either of the above, NIP-49 encrypted under the user's passphrase
 */
export type RecoveryArtifactKind = 'words' | 'nsec' | 'ncryptsec';

const PLAINTEXT_HEADER =
  'PERSONAL BLOC RECOVERY KEY — anyone with this file can open your plan. Store it offline, never share it.';

const ENCRYPTED_HEADER =
  'PERSONAL BLOC RECOVERY KEY (ENCRYPTED) — you need your passphrase to restore this. ' +
  'Without it, no one — including us — can recover your plan.';

/**
 * The file body: a warning header, a blank line, the artifact, a trailing newline.
 *
 * The plaintext file is plaintext BY DESIGN — a mnemonic backup is meant to be read off paper (the paper-wallet
 * model), and encrypting it by default would trade a recoverable phrase for one more forgettable passphrase. The
 * filename and this header are the honest mitigation.
 */
export function buildRecoveryFileText(kind: RecoveryArtifactKind, artifact: string): string {
  const header = kind === 'ncryptsec' ? ENCRYPTED_HEADER : PLAINTEXT_HEADER;
  return `${header}\n\n${artifact}\n`;
}

/**
 * `today` is a `yyyy-mm-dd` LOCAL calendar day — pass `todayLocalISO()`, never `toISOString()` (see the date
 * convention in CLAUDE.md).
 *
 * `DO-NOT-SHARE` is the mitigation for a PLAINTEXT file. An encrypted file's mitigation is the passphrase, so its
 * name carries the marker the user actually needs to see: `-encrypted`.
 */
export function recoveryFileName(kind: RecoveryArtifactKind, today: string, qr = false): string {
  const scope = qr ? 'personal-bloc-recovery-key-qr' : 'personal-bloc-recovery-key';
  const marker = kind === 'ncryptsec' ? 'encrypted' : 'DO-NOT-SHARE';
  return `${scope}-${marker}-${today}.${qr ? 'png' : 'txt'}`;
}
