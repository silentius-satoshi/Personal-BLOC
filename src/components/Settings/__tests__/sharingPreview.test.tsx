import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * BL51 (BL50 spec §10, its own call) — Settings → Sharing's "Preview as viewer" in full mode. The preview is drawn in
 * Monthly Mode alone (AppShell's Branch J; BL50's C9), so in full mode the button set the flag and showed nothing. Now
 * full mode gets a line in the button's place, saying where the preview opens; Monthly Mode keeps the button. Rendered
 * to static markup over a mocked store (the repo has no DOM harness); a non-local signer, so no roster renders. Each
 * assertion carries its tag.
 */
const mock = vi.hoisted(() => ({
  state: {
    nostrPubkey: '7e'.repeat(32), nostrSigningMethod: 'nip07', simpleMode: true, previousTab: 'living',
    setViewerPreview: () => {}, setActiveTab: () => {},
  } as Record<string, unknown>,
}));
vi.mock('../../../store/useStore', () => ({ useStore: (sel: (s: Record<string, unknown>) => unknown) => sel(mock.state) }));
const { SharingPage, PREVIEW_IN_MONTHLY_MODE } = await import('../SharingPage');

describe('⭐ Sharing\'s preview', () => {
  it('⭐ PREVIEW BUTTON — in Monthly Mode the button; in full mode, where no preview draws, a line saying where it opens', () => {
    mock.state.simpleMode = true;
    const simple = renderToStaticMarkup(<SharingPage />);
    expect(simple, 'PREVIEW BUTTON premise: the page').toContain('YOUR SHARE CODE');
    expect(simple, 'PREVIEW BUTTON Monthly Mode: the button').toMatch(/<button[^>]*>👁 Preview as viewer<\/button>/);
    expect(simple, 'PREVIEW BUTTON Monthly Mode: no line').not.toContain(PREVIEW_IN_MONTHLY_MODE);
    mock.state.simpleMode = false;
    const full = renderToStaticMarkup(<SharingPage />);
    expect(full, 'PREVIEW BUTTON full mode: no button').not.toContain('👁 Preview as viewer</button>');
    expect(full, 'PREVIEW BUTTON full mode: the line').toContain(`>${PREVIEW_IN_MONTHLY_MODE}<`);
    expect(PREVIEW_IN_MONTHLY_MODE, 'PREVIEW BUTTON the words').toBe('Preview as viewer opens in Monthly Mode — turn it on in Settings → Customization.');
  });
});
