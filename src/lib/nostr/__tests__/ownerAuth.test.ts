import { describe, it, expect } from 'vitest';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { getToken } from 'nostr-tools/nip98';
import { base64 } from '@scure/base';
import { validateOwnerRequest } from '../../../../api/_lib/ownerAuth.js';

const enc = new TextEncoder();
const URL = 'https://personal-bloc.vercel.app/api/strike-balances';

// A signed NIP-98 token via the library (uses the current timestamp).
function ownerToken(sk: Uint8Array, url = URL, method = 'GET') {
  return getToken(url, method, (e) => finalizeEvent(e as any, sk) as any, true);
}

// A manually-built token so we can control created_at (the lib's getToken always stamps "now").
function tokenWithCreatedAt(sk: Uint8Array, createdAt: number, url = URL, method = 'GET') {
  const tmpl = { kind: 27235, tags: [['u', url], ['method', method]], created_at: createdAt, content: '' };
  const signed = finalizeEvent(tmpl as any, sk);
  return 'Nostr ' + base64.encode(enc.encode(JSON.stringify(signed)));
}

describe('validateOwnerRequest', () => {
  const sk = generateSecretKey();
  const owner = getPublicKey(sk);
  const otherSk = generateSecretKey();
  const other = getPublicKey(otherSk);

  it('accepts a valid owner-signed token', async () => {
    const token = await ownerToken(sk);
    expect(await validateOwnerRequest(token, URL, 'GET', owner)).toEqual({ ok: true });
  });

  it('rejects a valid token signed by a different key (403)', async () => {
    const token = await ownerToken(sk);                 // signed by `sk` (owner)
    expect(await validateOwnerRequest(token, URL, 'GET', other)).toEqual({ status: 403 });
  });

  it('rejects a token signed by a non-owner when checked against the owner (403)', async () => {
    const token = await ownerToken(otherSk);            // valid sig, wrong key
    expect(await validateOwnerRequest(token, URL, 'GET', owner)).toEqual({ status: 403 });
  });

  it('rejects an expired token (>60s old) (401)', async () => {
    const past = Math.round(Date.now() / 1000) - 120;
    const token = tokenWithCreatedAt(sk, past);
    expect(await validateOwnerRequest(token, URL, 'GET', owner)).toEqual({ status: 401 });
  });

  it('rejects a url mismatch (401)', async () => {
    const token = await ownerToken(sk);
    const res = await validateOwnerRequest(token, 'https://evil.example/api/strike-balances', 'GET', owner);
    expect(res).toEqual({ status: 401 });
  });

  it('rejects a method mismatch (401)', async () => {
    const token = await ownerToken(sk);
    expect(await validateOwnerRequest(token, URL, 'POST', owner)).toEqual({ status: 401 });
  });

  it('rejects a malformed / unparseable token (catch path → 401)', async () => {
    expect(await validateOwnerRequest('Nostr garbage', URL, 'GET', owner)).toEqual({ status: 401 });
  });

  it('rejects a missing Authorization header (401)', async () => {
    expect(await validateOwnerRequest(undefined as any, URL, 'GET', owner)).toEqual({ status: 401 });
    expect(await validateOwnerRequest('', URL, 'GET', owner)).toEqual({ status: 401 });
  });

  it('rejects when no owner is configured (401)', async () => {
    const token = await ownerToken(sk);
    expect(await validateOwnerRequest(token, URL, 'GET', undefined)).toEqual({ status: 401 });
  });
});
