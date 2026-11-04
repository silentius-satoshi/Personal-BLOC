import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { toPageTop } from '../pageTop';

/**
 * BL51 — the preview opens at its top, and his Dashboard after it (the owner's report after BL50's live look: "Preview
 * as viewer" opened part-way down the preview's home). The app scrolls <body>, and a page change keeps the offset the
 * last page left; Sharing's button and the preview's "✕ Exit preview" each put the page at its top first. The helper on
 * a stand-in document; the two buttons read off the source. e2e/viewerAlmanac.spec.ts's PREVIEW AT TOP taps both in a
 * browser. Each assertion carries its tag.
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

describe('⭐ the preview at its top', () => {
  it('⭐ PREVIEW AT TOP — both buttons put the page at its top first: the preview opens at its top, and his Dashboard after it', () => {
    const doc = { body: { scrollTop: 442 }, documentElement: { scrollTop: 17 } };
    toPageTop(doc as unknown as Document);
    expect([doc.body.scrollTop, doc.documentElement.scrollTop], 'PREVIEW AT TOP both scrollers at the top').toEqual([0, 0]);
    expect(read('src/components/Settings/SharingPage.tsx'), 'PREVIEW AT TOP the way in: the top first, then the preview')
      .toContain('onClick={() => { toPageTop(); setViewerPreview(true); setActiveTab(previousTab); }}');
    expect(read('src/components/Viewer/ViewerPreview.tsx'), 'PREVIEW AT TOP the way out: the top first, then his Dashboard')
      .toContain('onClick={() => { toPageTop(); setViewerPreview(false); }}');
    const calls = files(join(ROOT, 'src'))
      .flatMap((f) => (readFileSync(f, 'utf8').match(/toPageTop\(\)/g) ?? []).map(() => f.slice(ROOT.length + 1)));
    expect(calls.sort(), 'PREVIEW AT TOP the two buttons alone call it')
      .toEqual(['src/components/Settings/SharingPage.tsx', 'src/components/Viewer/ViewerPreview.tsx']);
  });
});
