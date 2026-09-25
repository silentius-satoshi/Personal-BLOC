import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — how the three engine faces wire the support policy (Run 2b). The repo has no render harness,
 * so, like resetMirror.test.ts, these rules are read off the source:
 *
 *  - the four policy objects are MEMOISED on stable identities. Built inline, each render gives them a new identity:
 *    `engineInputs` rebuilds, both engine runs re-run, and the lens-reset effect fires on every render — an engaged
 *    price stress dies at once (the bug class useStressLens exists to prevent);
 *  - `supportPath` comes only from `buildSupportPath(startDate, months)` — the faces' one §2 crossing for the policy —
 *    and is never stressed or phase-shifted: the stress lens moves the price, not the line. The stress run spreads
 *    the SAME `engineInputs`, so it receives the identical policy;
 *  - the support readout at the inspected month reads that same path, never a second `plBandAt('floor', …)`;
 *  - every face renders the one shared card, and the card imports no belief and no store;
 *  - the 2b copy fixes stay in their helpers: a drawing month's sentence comes from `drawingCashFlowNote` (Cycling,
 *    Strategy), so the old inline "the line couldn't reach" appears in no face; and Ownership's verdict enters its
 *    call branch on `strikeCallVerdict(capReading)`, never on `if (sim.strikeMarginMonth !== null)` — under the
 *    policy a cure or a clean sale leaves that flag null.
 *
 * Each check was proven red by a temporary edit to a real face (or the card) before it landed.
 */
const FACES = ['CyclingFace.tsx', 'OwnershipFace.tsx', 'UnifiedFace.tsx'] as const;
const POLICY_MEMOS = ['policyRaw', 'policySettings', 'supportPath', 'supportPolicy'] as const;

function readAlmanac(file: string): string {
  return readFileSync(join(process.cwd(), 'src/components/Almanac', file), 'utf8');
}

describe.each(FACES)('%s — support-policy wiring', (face) => {
  const src = readAlmanac(face);

  it.each(POLICY_MEMOS)('⭐ %s is memoised (a stable identity, or the lens reset fires every render)', (name) => {
    expect(src, `${face}: const ${name} = useMemo(`).toMatch(new RegExp(`\\bconst ${name} = useMemo\\(`));
  });

  it('⭐ supportPath comes only from buildSupportPath(startDate, months)', () => {
    expect(src).toMatch(
      /const supportPath = useMemo\(\(\) => buildSupportPath\(startDate, months\), \[startDate, months\]\);/,
    );
  });

  it('⭐ supportPath reaches the engine as built — never stressed, never phase-shifted', () => {
    expect(src).toMatch(/supportPolicyFor\(policySettings, supportPath, /);
    expect(src).not.toMatch(/\b(?:applyPathStress|plConvergencePath|cycleConvergencePath)\([^)]*\bsupportPath\b/);
  });

  it('⭐ every engine run spreads the same engineInputs (the stress run gets the identical policy)', () => {
    const calls = src.match(/runCyclingSim\(/g) ?? [];
    const spread = src.match(/runCyclingSim\(\{ \.\.\.engineInputs, pricePath(?:: stressPath)? \}\)/g) ?? [];
    expect(calls.length, `${face}: engine calls found`).toBeGreaterThanOrEqual(2);
    expect(spread.length, `${face}: engine calls that override something beyond the price path`).toBe(calls.length);
  });

  it("⭐ the support readout reads the policy's own path — no second plBandAt('floor', …)", () => {
    expect(src).not.toMatch(/plBandAt\(\s*['"]floor['"]/);
    expect(src).toMatch(/const supportAtMonth = supportPath\[monthIdx\];/);
  });

  it('⭐ the shared card is rendered', () => {
    expect(src).toMatch(/<SupportPolicyCard\b/);
  });
});

describe('CyclingFace.tsx — no mode of its own', () => {
  it("⭐ passes the literal 'cycle' to supportPolicyFor", () => {
    expect(readAlmanac('CyclingFace.tsx')).toMatch(
      /supportPolicyFor\(policySettings, supportPath, expenses, s\.strikeLiquidationLtvPct, 'cycle'\)/,
    );
  });
});

describe('the 2b copy fixes, pinned at the face', () => {
  it.each(['CyclingFace.tsx', 'UnifiedFace.tsx'] as const)(
    '⭐ %s renders a drawing month through drawingCashFlowNote(', (face) => {
      expect(readAlmanac(face)).toMatch(/\bdrawingCashFlowNote\(/);
    },
  );

  it.each(FACES)("⭐ %s never inlines \"the line couldn't reach\" — it lives only in the helper", (face) => {
    expect(readAlmanac(face)).not.toMatch(/the\s+line\s+couldn(?:'|\u2019|&apos;|&#39;|&rsquo;)t\s+reach/);
  });

  it('⭐ OwnershipFace.tsx enters its call verdict on the reading, never on strikeMarginMonth alone', () => {
    const src = readAlmanac('OwnershipFace.tsx');
    expect(src).toMatch(/\bstrikeCallVerdict\(capReading\)/);
    expect(src).not.toMatch(/if\s*\(\s*sim\.strikeMarginMonth\s*!==\s*null\s*\)/);
  });
});

describe('SupportPolicyCard.tsx', () => {
  const src = readAlmanac('SupportPolicyCard.tsx');
  const imports = [...src.matchAll(/^import[\s\S]*?from '([^']+)';/gm)].map((m) => m[1]);

  it('⭐ imports no belief and no store — it renders what the face hands it', () => {
    expect(imports.length, 'imports found').toBeGreaterThan(3);
    for (const bad of [/powerLaw/, /cyclePath/, /cycleModel/, /\/store\//]) {
      expect(imports.filter((i) => bad.test(i)), `a ${bad} import`).toEqual([]);
    }
    expect(src).not.toMatch(/\buseStore\b/);
  });

  it('⭐ the Settings disclosure is collapsed by default', () => {
    expect(src).toMatch(/<details\b/);
    expect(src).not.toMatch(/<details\b[^>]*\bopen\b/);
  });
});
