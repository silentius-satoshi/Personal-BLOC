import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toPageTop } from '../pageTop';

/**
 * BL51 — the preview opens at its top, and his Dashboard after it (the owner's report after BL50's live look: "Preview
 * as viewer" opened part-way down the preview's home). The app scrolls <body>, and a page change keeps the offset the
 * last page left. Sweep 3 (3.4) widened it: EVERY page opens at its top — full mode's "Switch to simple view" opened the
 * Dashboard at the last page's offset — so AppShell resets once, in a layout effect keyed on the page drawn, in place of
 * Sharing's and the preview's own calls. The helper on a stand-in document; the wiring read off the source.
 * e2e/pageTop.spec.ts reads the offset in a browser (390 and 1280 px, the edge swipe included); e2e/viewerAlmanac.spec.ts's
 * PREVIEW AT TOP still taps both buttons. Each assertion carries its tag.
 */
const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe('⭐ a page opens at its top', () => {
  it('⭐ PAGE TOP — ONE reset, in AppShell, keyed on the page drawn: every page change, the preview\'s way in and out included', () => {
    const doc = { body: { scrollTop: 442 }, documentElement: { scrollTop: 17 } };
    toPageTop(doc as unknown as Document);
    expect([doc.body.scrollTop, doc.documentElement.scrollTop], 'PAGE TOP both scrollers at the top').toEqual([0, 0]);
    const shell = read('src/components/Layout/AppShell.tsx');
    expect(shell, 'PAGE TOP the page drawn: the mode, the tab, the journal\'s view, the preview')
      .toContain("const pageDrawn = `${simpleMode || viewerMode ? 'simple' : 'full'}|${activeTab}|${simpleView}|${viewerPreview}`;");
    expect(shell, 'PAGE TOP before paint, on every change of it').toContain('useLayoutEffect(() => { toPageTop(); }, [pageDrawn]);');
    // The preview's buttons change the page; the reset follows — no call of their own (PREVIEW AT TOP, BL51, still holds).
    expect(read('src/components/Settings/SharingPage.tsx'), 'PAGE TOP the way in')
      .toContain('onClick={() => { setViewerPreview(true); setActiveTab(previousTab); }}');
    expect(read('src/components/Viewer/ViewerPreview.tsx'), 'PAGE TOP the way out')
      .toContain('onClick={() => setViewerPreview(false)}');
    const calls = files(join(ROOT, 'src'))
      .flatMap((f) => (readFileSync(f, 'utf8').match(/toPageTop\(\)/g) ?? []).map(() => f.slice(ROOT.length + 1)));
    expect(calls, 'PAGE TOP AppShell alone calls it, once').toEqual(['src/components/Layout/AppShell.tsx']);
  });
});
