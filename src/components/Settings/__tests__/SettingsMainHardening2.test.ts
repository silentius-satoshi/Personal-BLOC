import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hardening 2 — SettingsMain.tsx's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * Neither list is exported and neither file has a render harness, so both are read in the source.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/** The `[ … ] as const` list that follows `head`, as key → its label field. */
function labels(src: string, head: string, field: string): Record<string, string> {
  const start = src.indexOf(head);
  const block = start === -1 ? '' : src.slice(start, src.indexOf('] as const;', start));
  const re = new RegExp(`\\{ key: '(\\w+)',\\s*${field}: '([^']+)'`, 'g');
  return Object.fromEntries([...block.matchAll(re)].map((m) => [m[1], m[2]]));
}

describe('Hardening 2 — SettingsMain', () => {
  it('HS-43 · ui.md "`SettingsMain` ALL_TABS" (keep in sync with AppShell `ALL_TABS_META`) — every tab Settings lists carries the bar\'s own name', () => {
    const settings = labels(read('src/components/Settings/SettingsMain.tsx'), 'const ALL_TABS = [', 'label');
    const bar = labels(read('src/components/Layout/AppShell.tsx'), 'const ALL_TABS_META = [', 'fullLabel');
    expect(Object.keys(settings).length >= 8 && Object.keys(bar).length >= 8, 'HS-43 premise: both lists are read').toBe(true);
    const off = Object.entries(settings).filter(([k, label]) => bar[k] !== label).map(([k, label]) => `${k}: '${label}' ≠ '${bar[k]}'`);
    expect(off, 'HS-43 one name per tab').toEqual([]);
  });
});
