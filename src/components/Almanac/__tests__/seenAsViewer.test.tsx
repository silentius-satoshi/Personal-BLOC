import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreviewAsViewer, useSeenAsViewer } from '../seenAsViewer';

/**
 * ⚠ BL50 — "Preview as viewer" draws the viewer's bar, and its Almanac works as he sees it (spec `pbloc-spec-preview-bar-v1`).
 * The lens the hub's gates read: a viewer's device, or the owner's trusted preview — never the owner's own Almanac. Rendered
 * to static markup over a mocked store, as viewerWhatIf.test.tsx renders the lock (the repo has no DOM harness);
 * viewerAccess.test.ts reads where AppShell provides it, viewerAlmanacWiring.test.ts that every gate reads it, and
 * e2e/viewerAlmanac.spec.ts pins the preview's hub against a real trusted viewer's. Each assertion carries its tag.
 */
const mock = vi.hoisted(() => ({ state: { viewerMode: false } }));
vi.mock('../../../store/useStore', () => ({ useStore: (sel: (s: typeof mock.state) => unknown) => sel(mock.state) }));

function Probe() {
  return <i>{String(useSeenAsViewer())}</i>;
}
const seen = (viewerMode: boolean, provide?: boolean): boolean => {
  mock.state.viewerMode = viewerMode;
  const node = provide === undefined ? <Probe /> : <PreviewAsViewer.Provider value={provide}><Probe /></PreviewAsViewer.Provider>;
  return renderToStaticMarkup(node) === '<i>true</i>';
};

describe('⭐ the lens', () => {
  it('⭐ LENS — the Almanac as a viewer sees it: a viewer\'s device, or the owner\'s trusted preview; never the owner\'s own', () => {
    expect(seen(false), 'LENS the owner\'s Almanac').toBe(false);
    expect(seen(false, false), 'LENS the owner\'s Almanac, the lens off').toBe(false);
    expect(seen(false, true), 'LENS the owner\'s trusted preview').toBe(true);
    expect(seen(true), 'LENS a viewer\'s device').toBe(true);
    expect(seen(true, false), 'LENS a viewer\'s device, whatever the context').toBe(true);
  });
});
