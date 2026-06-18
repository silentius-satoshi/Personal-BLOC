import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProxyAuthHeader, resetProxyAuthCache } from '../proxyAuth';

// Mock signer — counts signEvent calls; returns a fixed signed event (no real crypto needed; the cache
// behavior is what we test, not the token contents).
function makeSigner() {
  return {
    signEvent: vi.fn(async (e: any) => ({ ...e, id: 'id', pubkey: 'pk', sig: 'sig' })),
  } as any;
}

const URL_A = 'https://example.com/api/strike-balances';
const URL_B = 'https://example.com/api/strike-rates';

describe('getProxyAuthHeader token cache', () => {
  let nowValue = 1_000_000;

  beforeEach(() => {
    resetProxyAuthCache();
    nowValue = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => nowValue);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a cached token within the ~50s window (signs once)', async () => {
    const signer = makeSigner();
    const t1 = await getProxyAuthHeader(URL_A, 'GET', signer);
    nowValue += 40_000;                      // still inside 50s
    const t2 = await getProxyAuthHeader(URL_A, 'GET', signer);
    expect(t1).toBe(t2);
    expect(signer.signEvent).toHaveBeenCalledTimes(1);
  });

  it('re-signs after the cache window expires', async () => {
    const signer = makeSigner();
    await getProxyAuthHeader(URL_A, 'GET', signer);
    nowValue += 60_000;                      // past 50s
    await getProxyAuthHeader(URL_A, 'GET', signer);
    expect(signer.signEvent).toHaveBeenCalledTimes(2);
  });

  it('re-signs when the url changes (cache is per-url)', async () => {
    const signer = makeSigner();
    await getProxyAuthHeader(URL_A, 'GET', signer);
    await getProxyAuthHeader(URL_B, 'GET', signer);   // different url, same instant
    expect(signer.signEvent).toHaveBeenCalledTimes(2);
  });

  it('re-signs when the method changes (cache is per-method)', async () => {
    const signer = makeSigner();
    await getProxyAuthHeader(URL_A, 'GET', signer);
    await getProxyAuthHeader(URL_A, 'POST', signer);  // different method, same instant
    expect(signer.signEvent).toHaveBeenCalledTimes(2);
  });

  it('returns the "Nostr " scheme-prefixed token', async () => {
    const signer = makeSigner();
    const token = await getProxyAuthHeader(URL_A, 'GET', signer);
    expect(token.startsWith('Nostr ')).toBe(true);
  });
});
