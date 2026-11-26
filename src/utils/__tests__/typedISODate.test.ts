import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { typedISODate } from '../format';

/**
 * Sweep 3 (3.2) — the three start-date fields (Settings, the sidebar, onboarding) wrote a cleared field's '' as the
 * plan's start date, and every month then read NaN. A cleared field writes nothing: each site writes only what
 * `typedISODate` returns. Mutation: any site back to `setAdvisorStartDate(e.target.value)` (or the draft's raw value) → red.
 */
const read = (p: string): string => readFileSync(join(process.cwd(), 'src/components', p), 'utf8');

describe('⭐ START DATE — a cleared field writes nothing', () => {
  it('⭐ START DATE — a picker\'s yyyy-mm-dd passes; a cleared field, or anything else, is no date to write', () => {
    expect([typedISODate('2026-06-01'), typedISODate('2027-12-31')]).toEqual(['2026-06-01', '2027-12-31']);
    expect([typedISODate(''), typedISODate(' '), typedISODate('2026-6-1'), typedISODate('June 1'), typedISODate('NaN')])
      .toEqual([null, null, null, null, null]);
  });

  it('⭐ START DATE WIRED — Settings, the sidebar and onboarding write only a typed date', () => {
    for (const p of ['Settings/SettingsMain.tsx', 'Advisor/AdvisorSidebar.tsx']) {
      const src = read(p);
      expect(src, `WIRED ${p}`).toContain('const start = typedISODate(e.target.value);');
      expect(src, `WIRED ${p}`).toContain('if (start !== null) setAdvisorStartDate(start);');
      expect(src, `WIRED ${p}: no raw write`).not.toContain('setAdvisorStartDate(e.target.value)');
    }
    const onboarding = read('Onboarding/OnboardingModal.tsx');
    expect(onboarding, 'WIRED onboarding: the draft takes only a typed date').toContain('const start = typedISODate(e.target.value);');
    expect(onboarding).toContain('if (start !== null) setDraft((d) => ({ ...d, startDate: start }));');
    expect(onboarding, 'WIRED onboarding: no raw draft write').not.toContain('startDate: e.target.value');
  });
});
