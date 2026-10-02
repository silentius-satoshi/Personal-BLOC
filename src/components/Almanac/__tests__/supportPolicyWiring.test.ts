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
 *    policy a cure or a clean sale leaves that flag null;
 *  - so do 2b.2's: a stopped month's sentence comes from `stoppedCashFlowNote` (Cycling, Strategy) and Strategy's
 *    no-draw modes read `noDrawCashFlowNote`, so "pays the bills again" and "No draw in this strategy" appear in no
 *    face — inlined, the first was said even when bills went unpaid, and both named $0;
 *  - and 2b.3's: every buy figure a face prints (`fmtUSD(cf.buysUsd)`) has its dust switch (`shownUsd(cf.buysUsd)`),
 *    counted off the source — Ownership's leveraged branch printed a sub-50¢ buy unguarded, as "$0/mo".
 *  - and the crash playbook's (Run 1): each face reads the CB LTV tile's "defended from" through `defendedFromSub`, Cycling
 *    and Ownership render the policy-on note through `playbookNote`, and the old defense note renders only with the
 *    policy OFF — its policy-on wording ("Coinbase defense line: … When the line ran short …") is gone from every face.
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

describe('the 2b.2 cash-flow helpers, pinned at the face', () => {
  it.each(['CyclingFace.tsx', 'UnifiedFace.tsx'] as const)(
    '⭐ %s renders a stopped month through stoppedCashFlowNote(', (face) => {
      expect(readAlmanac(face)).toMatch(/\bstoppedCashFlowNote\(/);
    },
  );

  it('⭐ UnifiedFace.tsx renders a no-draw mode through noDrawCashFlowNote(', () => {
    expect(readAlmanac('UnifiedFace.tsx')).toMatch(/\bnoDrawCashFlowNote\(/);
  });

  it.each(FACES)('⭐ %s never inlines "pays the bills again" — it lives only in stoppedCashFlowNote', (face) => {
    expect(readAlmanac(face)).not.toMatch(/pays\s+the\s+bills\s+again/);
  });

  it.each(FACES)('⭐ %s never inlines "No draw in this strategy" — it lives only in noDrawCashFlowNote', (face) => {
    expect(readAlmanac(face)).not.toMatch(/No\s+draw\s+in\s+this\s+strategy/);
  });
});

describe('the 2b.3 dust guard, pinned at the face', () => {
  it.each(FACES)('⭐ %s switches every printed buy figure on the dust floor (2b.3)', (face) => {
    const src = readAlmanac(face);
    const printed = src.match(/fmtUSD\(\s*cf\.buysUsd\s*\)/g) ?? [];
    const switched = src.match(/shownUsd\(\s*cf\.buysUsd\s*\)/g) ?? [];
    expect(printed.length, `${face}: buy figures printed`).toBeGreaterThan(0);
    expect(switched.length, `${face}: dust switches on the buy figure`).toBeGreaterThanOrEqual(printed.length);
  });
});

describe('the crash playbook in the faces (Run 1), pinned at the face', () => {
  it.each(FACES)('⭐ %s reads the CB LTV tile\'s "defended from" through defendedFromSub(', (face) => {
    expect(readAlmanac(face)).toMatch(/\bdefendedFromSub\(/);
  });

  it.each(['CyclingFace.tsx', 'OwnershipFace.tsx'] as const)('⭐ %s renders the policy-on note through playbookNote(', (face) => {
    expect(readAlmanac(face)).toMatch(/\bplaybookNote\(/);
  });

  it.each(FACES)('⭐ %s carries no policy-on wording of the old defense note', (face) => {
    const src = readAlmanac(face);
    expect(src).not.toMatch(/'Coinbase defense line'\s*:\s*'LTV stop defense'/);
    expect(src).not.toMatch(/applied\s*\?\s*'defense line'\s*:\s*'stop'/);
    expect(src).not.toMatch(/Coinbase defense line:/);
  });

  it.each(['CyclingFace.tsx', 'OwnershipFace.tsx'] as const)('⭐ %s renders the old defense note only with the policy OFF', (face) => {
    const src = readAlmanac(face);
    const gate = src.indexOf('{!applied && defenseActive && (');
    expect(gate, `${face}: the policy-off gate`).toBeGreaterThan(0);
    // The old note's words appear exactly once, inside that gate.
    expect(src.match(/When the line ran short/g)?.length).toBe(1);
    expect(src.indexOf('When the line ran short')).toBeGreaterThan(gate);
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

// ── Policy v2, Run B ─────────────────────────────────────────────────────────────────────────────────────────────

describe('Run B — Coinbase\'s seizure price on the three charts, through ONE formula (B2)', () => {
  const SERIES = [['CyclingFace.tsx', 'cliff'], ['OwnershipFace.tsx', 'liq'], ['UnifiedFace.tsx', 'liq']] as const;

  it.each(SERIES)('⭐ %s draws "Coinbase seizes" in the Decision chart\'s style', (face, key) => {
    const src = readAlmanac(face);
    const at = src.indexOf(`<Line dataKey="${key}"`);
    expect(at, `${face}: <Line dataKey="${key}"`).toBeGreaterThan(0);
    const tag = src.slice(at, src.indexOf('/>', at) + 2);
    for (const attr of [
      'name="Coinbase seizes"', 'stroke="var(--red)"', 'strokeWidth={1.25}', 'strokeDasharray="1 3"', 'dot={false}',
      'isAnimationActive={false}', 'connectNulls={false}',
    ]) expect(tag, `${face}: ${attr}`).toContain(attr);
    expect(tag, `${face}: linear, like the Decision chart`).not.toMatch(/\btype=/);
    if (face === 'CyclingFace.tsx') {
      // R10 — drawn, and named in the Legend, only when a cliff exists; a direct child (`cond && <Line/>`).
      expect(src).toMatch(/const hasCliff = chartRows\.some\(\(r\) => r\.cliff !== null\);/);
      expect(src).toMatch(/\{hasCliff && \(?\s*<Line dataKey="cliff"/);
    }
  });

  it('⭐ one formula — chartOwnershipRows reads chartCliffUsd and names no LLTV; both callers pass (rows, limitStopPct); Cycling\'s rows read chartCliffUsd', () => {
    const view = readAlmanac('ownershipFaceView.ts');
    expect(view).toMatch(/\bliq: chartCliffUsd\(r\),/);
    expect(view).not.toMatch(/\bCB_LLTV\b|\bcbLiqLtv\b/);
    for (const face of ['OwnershipFace.tsx', 'UnifiedFace.tsx']) {
      expect(readAlmanac(face), face).toMatch(/chartOwnershipRows\(rows, limitStopPct\)/);
    }
    expect(readAlmanac('CyclingFace.tsx')).toMatch(/\bcliff: chartCliffUsd\(r\),/);
  });
});

describe('Run B — the policy-off note on the three faces\' verdicts (B5)', () => {
  it.each(FACES)('⭐ %s renders openPastLltvNote(sim) and never inlines its sentence', (face) => {
    const src = readAlmanac(face);
    expect(src).toMatch(/\bopenPastLltvNote\(sim\)/);
    expect(src).not.toMatch(/would seize it on the way down/);
  });
});

describe('Run B — the deficiency prints (B6)', () => {
  it('⭐ every "$X of debt survives" is switched on the dust floor — four prints, none unguarded', () => {
    let prints = 0;
    for (const f of ['CyclingFace.tsx', 'UnifiedFace.tsx', 'ownershipFaceView.ts']) {
      const src = readAlmanac(f);
      prints += (src.match(/of debt survives/g) ?? []).length;
      expect(src.match(/sim\.deficiencyUsd !== null(?! && shownUsd\(sim\.deficiencyUsd\))/g) ?? [], f).toEqual([]);
    }
    expect(prints).toBe(4);
  });
});
