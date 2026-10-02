import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — how the Decision face (Run B) is wired. The repo has no render harness, so, like resetMirror /
 * supportPolicyWiring / coldWiring, these rules are read off the source:
 *
 *  - ONE run, many lenses (D8): every engine call spreads `engineInputs` (the PREFIX rule — not the parents' exact
 *    regex, which a selector call would fail), and the Worst (modeled) selector reads the very same `engineInputs`
 *    — and the path note names the rule it decided by (`crown.worstBy`, W1);
 *  - the four policy objects are memoised; the support path comes only from `buildSupportPath` and is never stressed;
 *  - THE MOVE reads the held anchor and today's support through ONE input object (B1), and the card prices its cliff
 *    from that same object — never the polled quote;
 *  - the run starts from THE MOVE only when it is made (D10, v1.6), with the store's own balances as the fallback;
 *  - the policy's memory is rebuilt from prices and logged deposits (D14) and reaches the engine;
 *  - the schedule row is the tap target and the crash link is a SIBLING row (C2); the print class is never cleared
 *    synchronously after `window.print()` (C1);
 *  - no forbidden control, no worst option in a band table (I19), no store write (I20), the hub branch (I21), no
 *    "the answer" (I28), and no sentence composed in the face (I31, Run B).
 *
 * Each check was proven red by a temporary edit to the real file before it landed.
 */
const ALMANAC = join(process.cwd(), 'src/components/Almanac');
const read = (file: string): string => readFileSync(join(ALMANAC, file), 'utf8');
const SRC = read('DecisionFace.tsx');

/** The text of the first `useMemo(...)` whose declaration starts with `const <name> = useMemo(`, up to its deps. */
function memoBody(src: string, name: string): string {
  const at = src.indexOf(`const ${name} = useMemo(`);
  if (at < 0) return '';
  const end = src.indexOf(']);', at);
  return end < 0 ? '' : src.slice(at, end + 3);
}

/** The argument text of every call `fn(` — up to its matching close paren. */
function callArgs(src: string, fn: string): string[] {
  const out: string[] = [];
  for (let at = src.indexOf(`${fn}(`); at >= 0; at = src.indexOf(`${fn}(`, at + 1)) {
    // Only a real call: not the tail of a longer identifier.
    if (at > 0 && /[A-Za-z0-9_$.]/.test(src[at - 1])) continue;
    let depth = 0;
    let i = at + fn.length;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(at + fn.length + 1, i));
  }
  return out;
}

describe('⭐ one run, many lenses (D8)', () => {
  it('⭐ every engine call spreads engineInputs — the prefix rule', () => {
    const calls = SRC.match(/runCyclingSim\(/g) ?? [];
    const spread = SRC.match(/runCyclingSim\(\{ \.\.\.engineInputs, /g) ?? [];
    expect(calls.length, 'engine calls found').toBeGreaterThanOrEqual(2);   // base + stress
    expect(spread.length, 'engine calls that do not start by spreading engineInputs').toBe(calls.length);
  });

  it('⭐ the Worst (modeled) selector reads the same engineInputs as the displayed run', () => {
    const args = callArgs(SRC, 'evaluatePaths');
    expect(args.length, 'evaluatePaths calls found').toBeGreaterThanOrEqual(1);
    for (const a of args) expect(a.trimStart().startsWith('engineInputs,'), `evaluatePaths(${a})`).toBe(true);
  });

  it('⭐ W1 — the path note names the rule the ranking used: `worstBy` comes from the crown, never a literal', () => {
    const args = callArgs(SRC, 'pathNote');
    expect(args.length, 'pathNote calls found').toBe(1);
    expect(args[0]).toMatch(/\bworstBy: crown\.worstBy,/);
  });
});

describe('⭐ the support policy — memoised, and its line never stressed', () => {
  it.each(['policyRaw', 'policySettings', 'supportPath', 'supportPolicy'])('⭐ %s is memoised', (name) => {
    expect(SRC).toMatch(new RegExp(`\\bconst ${name} = useMemo\\(`));
  });

  it('⭐ supportPath comes only from buildSupportPath(startDate, months), and reaches the policy as built', () => {
    expect(SRC).toMatch(
      /const supportPath = useMemo\(\(\) => buildSupportPath\(startDate, months\), \[startDate, months\]\);/,
    );
    expect(SRC).toMatch(/supportPolicyFor\(policySettings, supportPath, s\.expenses, s\.strikeLiquidationLtvPct, 'cycle'\)/);
    expect(SRC).not.toMatch(/\b(?:applyPathStress|plConvergencePath|cycleConvergencePath)\([^)]*\bsupportPath\b/);
    expect(SRC).not.toMatch(/plBandAt\(\s*['"]floor['"]/);
    expect(SRC).toMatch(/const supportAtMonth = supportPath\[monthIdx\];/);
  });

  it("⭐ the literal 'cycle' — no mode of its own — and the shared card is rendered", () => {
    // Run B (B4): the literal lives in ENGINE_CONTEXT, which engineInputs spreads (and the seeding gate reads).
    expect(SRC).toMatch(/const ENGINE_CONTEXT = \{\s*mode: 'cycle' as const,/);
    expect(memoBody(SRC, 'engineInputs')).toMatch(/\.\.\.ENGINE_CONTEXT,/);
    expect(SRC).toMatch(/<SupportPolicyCard\b/);
  });
});

describe('⭐ THE MOVE — the held anchor, today\'s support, one input object (B1)', () => {
  const body = memoBody(SRC, 'placementInput');

  it('⭐ placementInput prices at the anchor and today\'s support, with the run\'s breaker seed', () => {
    expect(body, 'the placementInput memo').not.toBe('');
    expect(body).toMatch(/\bprice: anchorPrice,/);
    expect(body).toMatch(/\bsupport: supportPath\[0\],/);
    expect(body).toMatch(/\bbroken: breakerSeed\?\.state\.broken \?\? false,/);
    expect(body).toMatch(/\binHold: hold\.inHold,/);
    expect(body).toMatch(/\bcreditLine: runLine,/);
    expect(SRC).toMatch(/const placement = useMemo\(\(\) => placementPlan\(placementInput\), \[placementInput\]\);/);
  });

  it('⭐ path-invariant by construction — the move never reads a path, a choice or the stress', () => {
    expect(body).not.toMatch(/\b(?:pricePath|stressPath|displayedPath|paths|choice|lens|s\.btcPrice)\b/);
  });

  it('⭐ B1 — the card reads its price, support, debt and stop from that same object', () => {
    const args = callArgs(SRC, 'moveCard');
    expect(args.length, 'moveCard calls found').toBe(1);
    const ctx = args[0];
    expect(ctx).toMatch(/\bprice: placementInput\.price,/);
    expect(ctx).toMatch(/\bsupport: placementInput\.support,/);
    expect(ctx).toMatch(/\bcbDebt: placementInput\.cbDebt,/);
    expect(ctx).toMatch(/\bcbStop: placementInput\.cbStop,/);
    expect(ctx).toMatch(/\bplan: placement,/);
    expect(ctx).not.toMatch(/s\.btcPrice/);
  });
});

describe('⭐ the run starts from THE MOVE only when it is made (D10, v1.6)', () => {
  const body = memoBody(SRC, 'engineInputs');

  it('⭐ the seed needs a move worth making AND the policy on — off, the card names no move', () => {
    // Run B (B4): "on" is the engine's own answer — seedsFromMove asks supportPolicyResolution — never "supplied".
    expect(SRC).toMatch(/const seedFromMove = seedsFromMove\(placement\.seeded, /);
    expect(SRC).not.toMatch(/placement\.seeded && supportPolicy !== undefined/);
  });

  it.each([
    ['strikeCollateralBtc', 'strikeCollateralBtc', 's.strikeCollateralBtc'],
    ['cbCollateralBtc', 'cbCollateralBtc', 's.cbCollateralBtc'],
    ['openingColdBtc', 'coldBtc', 's.openingColdBtc'],
  ])('⭐ %s — the move when seeded, the store\'s own balance otherwise', (field, opening, store) => {
    const re = new RegExp(`\\b${field}: seedFromMove \\? placement\\.opening\\.${opening} : ${store.replace('.', '\\.')},`);
    expect(body, `${field} in engineInputs`).toMatch(re);
  });
});

describe('⭐ B4 (Run B) — ONE engine context: the seeding gate asks the run\'s own question', () => {
  it('⭐ ENGINE_CONTEXT holds exactly the five; engineInputs spreads it and declares none of them; the gate reads it', () => {
    expect(SRC).toMatch(new RegExp('const ENGINE_CONTEXT = \\{\\s*mode: \'cycle\' as const,\\s*cbLtvCapPct: CAP_PCT,'
      + '\\s*strikeLtvCapPct: STRIKE_CAP_PCT,\\s*strikeMarginLtv: STRIKE_MARGIN_CALL_LTV,'
      + '\\s*strikeMaxDrawLtv: STRIKE_MAX_DRAW_LTV,\\s*\\} as const;'));
    const body = memoBody(SRC, 'engineInputs');
    expect(body, 'the engineInputs memo').not.toBe('');
    expect(body).toMatch(/\.\.\.ENGINE_CONTEXT,/);
    expect(body).not.toMatch(/\b(?:mode|cbLtvCapPct|strikeLtvCapPct|strikeMarginLtv|strikeMaxDrawLtv):/);
    expect(SRC).toMatch(
      /const seedFromMove = seedsFromMove\(placement\.seeded, \{ \.\.\.ENGINE_CONTEXT, supportPolicy, pricePath: paths\[0\], expenses: s\.expenses \}\);/,
    );
  });
});

describe('⭐ the policy\'s memory is rebuilt from prices and logged deposits (D14)', () => {
  const body = memoBody(SRC, 'engineInputs');

  it('⭐ the hold, the breaker seed and the hold months reach the engine', () => {
    expect(SRC).toMatch(/const hold = useMemo\(\(\) => strikeHoldFrom\(s\.dayLog, todayISO\), \[s\.dayLog, todayISO\]\);/);
    expect(SRC).toMatch(/breakerFromHistory\(historical, startDate, DEFAULT_BREAKER_REARM_MONTHS \?\? null\)/);
    expect(SRC).toMatch(/holdMonthsFrom\(hold\.throughISO, startDate\)/);
    expect(body).toMatch(/\bopeningBreaker: breakerSeed\?\.state,/);
    expect(body).toMatch(/\bopeningStrikeHoldMonths: holdMonths,/);
  });

  it('⭐ ONE frozen today feeds the start date, the hold and the seed', () => {
    expect(SRC).toMatch(/const todayISO = useMemo\(\(\) => todayLocalISO\(\), \[\]\);/);
    expect(SRC).toMatch(/const startDate = useMemo\(\(\) => new Date\(todayISO\), \[todayISO\]\);/);
  });
});

describe('⭐ the chart', () => {
  it('⭐ the history support line is a FUNCTION (supportAtDates), and the series read the displayed run', () => {
    const args = callArgs(SRC, 'buildChartSeries');
    expect(args.length).toBe(1);
    const parts = args[0].split(',').map((p) => p.trim());
    expect(parts).toEqual([
      'historical', 'startDate', 'displayedPath', 'stitched', 'supportPath', 'supportAtDates', 'months', 'cliff',
    ]);
    expect(SRC).toMatch(/const displayedPath = lens === 1 \? pricePath : stressPath;/);
  });

  it('⭐ the legend note reads the DISPLAYED path against the support line, so an engaged stress hides it', () => {
    expect(SRC).toMatch(/pathOnSupport\(displayedPath, supportPath, months\)/);
    expect(SRC).not.toMatch(/pathOnSupport\(pricePath/);
  });

  it('⭐ the gradient id is per mount (useId), never a document-global literal', () => {
    expect(SRC).toMatch(/\buseId\(\)/);
    expect(SRC).toMatch(/<linearGradient id=\{gradientId\}/);
    expect(SRC).toMatch(/fill=\{`url\(#\$\{gradientId\}\)`\}/);
    expect(SRC).not.toMatch(/<linearGradient id="/);
  });
});

describe('⭐ C2 — the whole schedule row is the button; the crash link is a sibling row', () => {
  const start = SRC.indexOf('<tr role="button" tabIndex={0}');
  const end = SRC.indexOf('</tr>', start);
  const rowButton = start >= 0 && end > start ? SRC.slice(start, end) : '';
  const after = end >= 0 ? SRC.slice(end, SRC.indexOf('</tbody>', end)) : '';

  it('⭐ the row is <tr role="button" tabIndex={0}>, with a click and Enter / Space', () => {
    expect(rowButton, 'the row button').not.toBe('');
    expect(rowButton).toMatch(/onClick=\{\(\) => setSelectedMonth\(r\.m\)\}/);
    expect(rowButton).toMatch(/e\.key === 'Enter' \|\| e\.key === ' '/);
  });

  it('⭐ the console link never sits inside the row button — it is a row of its own, named for its month', () => {
    expect(rowButton).not.toMatch(/consoleLinkLabel|onNavigate\('defense'\)/);
    expect(after).toMatch(/\{r\.crash && \(\s*<tr className=\{styles\.crashRow\}>/);
    expect(after).toMatch(/aria-label=\{consoleLinkLabel\(r\.m\)\}/);
    expect(after).toMatch(/onNavigate\('defense'\)/);
  });
});

describe('⭐ C1 — the print class', () => {
  const printFn = SRC.slice(SRC.indexOf('const printSchedule = () => {'), SRC.indexOf('};', SRC.indexOf('const printSchedule = () => {')));

  it('⭐ Print sets the class, then prints — and NOTHING clears it synchronously after window.print()', () => {
    expect(printFn, 'printSchedule').not.toBe('');
    const add = printFn.indexOf('document.body.classList.add(PRINT_CLASS)');
    const print = printFn.indexOf('window.print()');
    expect(add).toBeGreaterThan(0);
    expect(print).toBeGreaterThan(add);
    expect(printFn.slice(print + 'window.print()'.length)).not.toMatch(/classList\.remove|clearPrint/);
  });

  it.each(['afterprint', 'pointerdown', 'keydown', 'focus'])(
    '⭐ it clears on %s — and on unmount', (ev) => {
      expect(SRC).toMatch(new RegExp(`window\\.addEventListener\\('${ev}', clearPrint\\);`));
      expect(SRC).toMatch(new RegExp(`window\\.removeEventListener\\('${ev}', clearPrint\\);`));
      expect(SRC).toMatch(/return \(\) => \{[^}]*clearPrint\(\);\s*\};/);
    },
  );

  it('the class the face sets is the class the stylesheet gates on', () => {
    expect(SRC).toMatch(/const PRINT_CLASS = 'decision-print';/);
    expect(read('DecisionFace.module.css')).toMatch(/:global\(body\.decision-print\)/);
  });
});

describe('⭐ what the face must never do', () => {
  it('⭐ no buffer, stop or mode control — those are the parents\' and the policy card\'s', () => {
    expect(SRC).not.toMatch(/\bbufferPct\b|\bstopLtvPct\b|\bMODE_META\b|set\('mode'/);
  });

  it('⭐ I19 — a worst option never reaches a band table', () => {
    expect(SRC).not.toMatch(/PL_BAND_LABEL\[/);
    for (const fn of ['plBandsAt', 'plBandAt']) {
      for (const a of callArgs(SRC, fn)) expect(a, `${fn}(${a})`).not.toMatch(/choice|worst|overlay\.path/i);
    }
    expect(SRC).not.toMatch(/bandsToday\[(?!resolvedKind\])/);
  });

  it('⭐ I20 — no store setter is selected or called (local setOverlay / setLens are fine)', () => {
    expect(SRC).not.toMatch(/\bst\.set[A-Z]/);
    expect(SRC).not.toMatch(/getState\(\)\.set[A-Z]/);
  });

  it('⭐ I28 — no "the answer" in the Decision face\'s files', () => {
    for (const f of ['DecisionFace.tsx', 'decisionView.ts', 'decisionChartView.ts']) {
      expect(read(f), f).not.toMatch(/the answer/i);
    }
    expect(readFileSync(join(process.cwd(), 'src/simulation/placement.ts'), 'utf8')).not.toMatch(/the answer/i);
  });
});

describe('⭐ I21 — the hub', () => {
  const HUB = read('AlmanacView.tsx');

  it('⭐ the renderFace branch sits ABOVE the Converter fallback (the C8 trap)', () => {
    const branch = HUB.indexOf("if (f === 'decision')  return <DecisionFace onNavigate={setFace} />;");
    const fallback = HUB.indexOf('return <div className={styles.faceStack}><ConverterMain />');
    expect(branch, 'the decision branch').toBeGreaterThan(0);
    expect(fallback, 'the fallback').toBeGreaterThan(0);
    expect(branch).toBeLessThan(fallback);
  });

  it('⭐ the pill is appended LAST, and ungated', () => {
    const list = HUB.slice(HUB.indexOf('const visibleFaces'), HUB.indexOf('];', HUB.indexOf('const visibleFaces')));
    const entries = list.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('{') || l.startsWith('...'));
    expect(entries[entries.length - 1]).toBe("{ key: 'decision' as Face, label: '◆ Decision' },");
  });
});

describe('⭐ I31 (Run B) — the face composes no sentence', () => {
  /** The face with its comments removed — block, JSX and line comments carry sentences by design. */
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  /** A sentence: at least four words, ending in a full stop or an em dash. */
  const isSentence = (t: string): boolean => {
    const s = t.trim();
    return (s.endsWith('.') || s.endsWith('—')) && (s.match(/[A-Za-z]{2,}/g) ?? []).length >= 4;
  };
  const strings = [...code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)]
    .map((m) => m[1] ?? m[2] ?? m[3] ?? '');
  const jsxText = [...code.matchAll(/>([^<>{}]*)</g)].map((m) => m[1]);

  it('the extraction is real (non-vacuous)', () => {
    expect(strings.length).toBeGreaterThan(50);
    expect(jsxText.some((t) => t.includes('Moves'))).toBe(true);
    expect(strings.some((t) => t === 'Worst (stitched)')).toBe(true);
  });

  it('⭐ no string literal and no JSX text in DecisionFace.tsx is a sentence — every one lives in decisionView', () => {
    const found = [...strings, ...jsxText].filter(isSentence);
    expect(found).toEqual([]);
  });
});
