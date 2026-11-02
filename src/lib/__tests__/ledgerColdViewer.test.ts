import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { coldMovedByMonth, coldMovedOf, coldMovesFromSnapshot } from '../ledgerCsv';
import type { DayEvent } from '../../simulation/types';

/**
 * ⚠ BL48 (V2 A) — the Ledger's "→ Cold" on a trusted viewer's device: the owner's month-by-month cold moves, worked out
 * on his device and sent in the trusted snapshot (payloads.ts), read through ONE rule (`coldMovedOf`) as the owner's
 * journal is on his. ⚠ SYNTHETIC round figures (public repo). Each assertion carries the tag its planted bug turns red.
 */
const START = '2026-10-01';
const JOURNAL: DayEvent[] = [
  { id: 'c1', date: '2026-10-08', ts: 1, kind: 'deposit', amount: 0.1, target: 'cold' },
  { id: 'c2', date: '2026-11-03', ts: 2, kind: 'withdraw', amount: 0.04, target: 'cold' },
  { id: 'c3', date: '2026-11-20', ts: 3, kind: 'deposit', amount: 0.25, target: 'cold' },
  { id: 's1', date: '2026-10-09', ts: 4, kind: 'deposit', amount: 0.2, target: 'strike' },
] as DayEvent[];

describe('⭐ the Ledger\'s cold moves on a viewer\'s device', () => {
  it('⭐ ONE RULE — the owner reads his journal; a viewer the owner\'s copy, never his own (empty) journal', () => {
    const owner = coldMovedOf({ viewerMode: false, viewerColdMovedByMonth: null, dayLog: JOURNAL, advisorStartDate: START });
    expect(owner, 'ONE RULE the owner: the journal').toEqual(coldMovedByMonth(JOURNAL, START));
    const copy = { 1: 0.1, 2: 0.21 };
    expect(coldMovedOf({ viewerMode: true, viewerColdMovedByMonth: copy, dayLog: JOURNAL, advisorStartDate: START }),
      'ONE RULE a viewer: the copy, whatever his journal holds').toEqual(copy);
    expect(coldMovedOf({ viewerMode: true, viewerColdMovedByMonth: null, dayLog: JOURNAL, advisorStartDate: START }),
      'ONE RULE a viewer without a copy: none — no column').toEqual({});
  });

  it('⭐ ROUND TRIP — the owner\'s months, through the snapshot\'s JSON and the viewer\'s check, read the same on both devices', () => {
    const sent = JSON.parse(JSON.stringify({ coldMovedByMonth: coldMovedByMonth(JOURNAL, START) })).coldMovedByMonth;
    expect(Object.keys(sent), 'ROUND TRIP premise: JSON\'s string keys').toEqual(['1', '2']);
    const viewer = coldMovedOf({ viewerMode: true, viewerColdMovedByMonth: coldMovesFromSnapshot(sent), dayLog: [], advisorStartDate: START });
    expect(viewer, 'ROUND TRIP the same months').toEqual(
      coldMovedOf({ viewerMode: false, viewerColdMovedByMonth: null, dayLog: JOURNAL, advisorStartDate: START }));
  });

  it('⭐ CHECKED — a whole month ≥ 1 and a finite number, or dropped; nothing valid, or no field, is null', () => {
    expect(coldMovesFromSnapshot({ 1: 0.1, 12: -0.5, '3': 2 }), 'CHECKED good months').toEqual({ 1: 0.1, 12: -0.5, 3: 2 });
    expect(coldMovesFromSnapshot({ 0: 1, '-1': 1, 1.5: 1, x: 1, 2: 'a', 3: null, 4: Infinity, 5: NaN, 6: 0.3 }),
      'CHECKED junk dropped').toEqual({ 6: 0.3 });
    for (const v of [undefined, null, 1, 'x', [], [0.1], {}, { x: 1 }]) {
      expect(coldMovesFromSnapshot(v), `CHECKED ${JSON.stringify(v)} → null`).toBeNull();
    }
  });

  it('⭐ FACE — the Ledger reads the rule, never the journal directly; a viewer gets no Copy or Download (V5 A)', () => {
    const face = readFileSync(join(process.cwd(), 'src/components/Almanac/LedgerFace.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    expect(face, 'FACE the rule').toContain('() => coldMovedOf({ viewerMode, viewerColdMovedByMonth, dayLog, advisorStartDate }),');
    expect(face, 'FACE not the journal').not.toMatch(/coldMovedByMonth\(dayLog/);
    expect(face, 'FACE no copies for a viewer').toMatch(
      /\{!viewerMode && \(\s*<div className=\{styles\.actions\}>\s*<button type="button" className=\{styles\.actionBtn\} onClick=\{copyCsv\}>/);
  });
});
