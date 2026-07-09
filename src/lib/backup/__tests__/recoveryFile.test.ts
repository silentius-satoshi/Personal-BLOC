import { describe, it, expect } from 'vitest';
import { buildRecoveryFileText, recoveryFileName } from '../recoveryFile';

// R2c-7b — the pure file-content builder behind the ceremony's Download aid. Node, no DOM, no crypto.

const WORDS = 'leader monkey parrot ring guide accident before fence cannon height naive bean';
const NSEC = 'nsec10allq0gjx7fddtzef0ax00mdps9t2kmtrldkyjfs8l5xruwvh2dq0lhhkp';
const NCRYPTSEC = 'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p';

describe('buildRecoveryFileText', () => {
  it('a plaintext WORDS file carries the artifact under the do-not-share header', () => {
    const text = buildRecoveryFileText('words', WORDS);
    expect(text).toBe(
      'PERSONAL BLOC RECOVERY KEY — anyone with this file can open your plan. Store it offline, never share it.\n\n' +
        `${WORDS}\n`,
    );
  });

  it('a plaintext NSEC file uses the same header, with the nsec as the body', () => {
    const text = buildRecoveryFileText('nsec', NSEC);
    expect(text).toContain('Store it offline, never share it.');
    expect(text.trimEnd().endsWith(NSEC)).toBe(true);
  });

  it('an ENCRYPTED file names the passphrase as the only way back in', () => {
    const text = buildRecoveryFileText('ncryptsec', NCRYPTSEC);
    expect(text).toContain('(ENCRYPTED)');
    expect(text).toContain('you need your passphrase to restore this');
    expect(text).not.toContain('never share it');   // a different mitigation → a different warning
    expect(text.trimEnd().endsWith(NCRYPTSEC)).toBe(true);
  });

  // The header is the honest mitigation for a plaintext artifact — it must never be droppable by kind.
  it.each([
    ['words', WORDS],
    ['nsec', NSEC],
    ['ncryptsec', NCRYPTSEC],
  ] as const)('%s: a PERSONAL BLOC warning header precedes a blank line and the artifact', (kind, artifact) => {
    const [header, blank, body] = buildRecoveryFileText(kind, artifact).split('\n');
    expect(header).toContain('PERSONAL BLOC RECOVERY KEY');
    expect(blank).toBe('');
    expect(body).toBe(artifact);
  });

  it('ends with exactly one trailing newline', () => {
    expect(buildRecoveryFileText('words', WORDS).endsWith(`${WORDS}\n`)).toBe(true);
  });
});

describe('recoveryFileName', () => {
  const DAY = '2026-07-09';

  it('plaintext files are marked DO-NOT-SHARE', () => {
    expect(recoveryFileName('words', DAY)).toBe(`personal-bloc-recovery-key-DO-NOT-SHARE-${DAY}.txt`);
    expect(recoveryFileName('nsec', DAY)).toBe(`personal-bloc-recovery-key-DO-NOT-SHARE-${DAY}.txt`);
  });

  // The encrypted file's mitigation is the passphrase, not secrecy of the file — so it carries -encrypted instead.
  it('an encrypted file is marked -encrypted, not DO-NOT-SHARE', () => {
    const name = recoveryFileName('ncryptsec', DAY);
    expect(name).toBe(`personal-bloc-recovery-key-encrypted-${DAY}.txt`);
    expect(name).not.toContain('DO-NOT-SHARE');
  });

  it('the QR variant swaps the scope and the extension, keeping the marker', () => {
    expect(recoveryFileName('words', DAY, true)).toBe(`personal-bloc-recovery-key-qr-DO-NOT-SHARE-${DAY}.png`);
    expect(recoveryFileName('ncryptsec', DAY, true)).toBe(`personal-bloc-recovery-key-qr-encrypted-${DAY}.png`);
  });
});
