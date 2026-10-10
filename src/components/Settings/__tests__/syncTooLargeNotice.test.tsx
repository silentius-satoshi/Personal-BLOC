// 5b (spec `pbloc-spec-journal-pages-v1`) — the plain-words warning: present, naming the channel, exactly while the size
// guard holds a refusal; gone when the channel's next payload fits.
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SyncTooLargeNotice } from '../SyncTooLargeNotice';
import { guardPayload, resetSyncGuard } from '../../../lib/nostr/syncGuard';

const refuse = (dTag: string) => { try { guardPayload(dTag, 40_961); } catch { /* refused — that is the point */ } };

describe('5b — Settings › SYNC: too large to sync', () => {
  afterEach(() => resetSyncGuard());

  it('WARN — names the refused channel in plain words; nothing at all while everything fits', () => {
    expect(renderToStaticMarkup(<SyncTooLargeNotice />)).toBe('');
    refuse('personal-bloc:records:v2:2026-03');
    const html = renderToStaticMarkup(<SyncTooLargeNotice />);
    expect(html).toContain('Too large to sync: Journal');
    expect(html).toContain('Everything is saved on this device');
    expect(html).not.toContain('Reconnect');
    refuse('personal-bloc:plan-events:v1');
    expect(renderToStaticMarkup(<SyncTooLargeNotice />)).toContain('Too large to sync: Journal, Plan');
    guardPayload('personal-bloc:records:v2:2026-03', 100);   // the page's next payload fits
    guardPayload('personal-bloc:plan-events:v1', 100);
    expect(renderToStaticMarkup(<SyncTooLargeNotice />), 'CLEARS').toBe('');
  });
});
