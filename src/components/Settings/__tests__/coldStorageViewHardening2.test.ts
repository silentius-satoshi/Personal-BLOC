import { describe, it, expect, vi, afterEach } from 'vitest';
import { coldAsOfLine } from '../coldStorageView';

/**
 * Hardening 2 — coldStorageView.ts's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * A zone BEHIND UTC, pinned the way powerLawView.test.ts pins one (the forks pool applies it — vite.config.ts).
 */
afterEach(() => { vi.unstubAllEnvs(); });

describe('Hardening 2 — coldStorageView', () => {
  it('HS-27 · ui.md § Date Formatting (local dates from toLocalISO, never toISOString split at the T) — a total entered at 9 pm reads as entered that day, not tomorrow', () => {
    vi.stubEnv('TZ', 'America/New_York');
    const at = new Date(2026, 5, 10, 21, 0).getTime();   // 9 pm on 10 June in New York — 01:00 UTC on the 11th
    expect(new Date(at).toISOString().slice(0, 10), 'HS-27 premise: UTC has turned the day').toBe('2026-06-11');
    expect(coldAsOfLine(at, 0)).toBe('Entered 2026-06-10.');
    expect(coldAsOfLine(at, 2)).toBe('Entered 2026-06-10, plus 2 moves since.');
  });
});
