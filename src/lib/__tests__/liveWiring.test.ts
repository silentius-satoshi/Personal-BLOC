import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The live price's wiring (BL64), read off the source: one socket, one REST price, one writer of the saved price, a frame
 * that holds the feed without rendering, and browser tests that never reach Coinbase. Each ⭐ names the edit that turns
 * it red.
 */

const ROOT = process.cwd();
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(ROOT, dir))) {
    const p = join(dir, name);
    if (statSync(join(ROOT, p)).isDirectory()) { if (name !== '__tests__') out.push(...sources(p)); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
const SRC = sources('src');
const where = (re: RegExp): string[] => SRC.filter((p) => re.test(stripComments(read(p)))).map((p) => relative(ROOT, join(ROOT, p))).sort();

/** The body of `function name(` up to its closing brace at the start of a line. */
function fnBody(src: string, name: string): string {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) return '';
  const end = src.indexOf('\n}', i);
  return src.slice(i, end < 0 ? undefined : end + 2);
}

describe('the live price\'s wiring (BL64)', () => {
  it('⭐ ONE SOCKET — the app opens a WebSocket in one place, the live feed\'s', () => {
    // mutation: a screen opening its own socket → red
    expect(where(/new WebSocket\(/), 'ONE SOCKET').toEqual(['src/lib/liveBtc.ts']);
  });

  it('⭐ ONE REST PRICE — the spot price is asked in one place, the live feed\'s fallback', () => {
    // mutation: a screen polling the spot price again → red
    expect(where(/api\.coinbase\.com\/v2\/prices/), 'ONE REST PRICE').toEqual(['src/lib/liveFeed.ts']);
  });

  it('⭐ ONE WRITER — the saved price is written by the feed and by the owner\'s own taps, nowhere else', () => {
    // mutation: a hook or a chart writing the store's price on a tick → red
    expect(where(/\bsetBtcPrice\(/), 'ONE WRITER').toEqual([
      'src/components/Advisor/AdvisorSidebar.tsx',
      'src/components/CoinbaseLoan/CoinbaseLoanSidebar.tsx',
      'src/components/Converter/ConverterSidebar.tsx',
      'src/components/Inputs/InputsPanel.tsx',
      'src/components/LivingOnBitcoin/LivingInputsPanel.tsx',
      'src/lib/liveBtc.ts',
    ]);
    const hooks = stripComments(read('src/hooks/useBtcPrice.ts')) + stripComments(read('src/hooks/useLivePrice.ts'));
    expect(hooks, 'ONE WRITER the hooks write nothing').not.toMatch(/useStore|setBtcPrice/);
  });

  it('⭐ FRAME — the app\'s frame holds the feed and reads nothing, so a tick never re-renders it', () => {
    // mutations: AppShell reading the price (useBtcPrice or useLivePrice) → red; the hold keeping state → red
    const shell = stripComments(read('src/components/Layout/AppShell.tsx'));
    expect(shell, 'FRAME holds the feed').toMatch(/\buseLiveFeedHold\(\);/);
    expect(shell, 'FRAME reads no price').not.toMatch(/\buseBtcPrice\(|\buseLivePrice\(/);
    const hold = fnBody(stripComments(read('src/hooks/useLivePrice.ts')), 'useLiveFeedHold');
    expect(hold, 'FRAME the hold').toMatch(/liveBtc\.hold\(\)/);
    expect(hold, 'FRAME the hold keeps no state').not.toMatch(/useState|useReducer|useSyncExternalStore|useStore/);
  });

  it('⭐ CLOCKS — what kept time by the frame\'s old re-draw keeps a clock of its own: the console ages the price on its own, the frame turns the day (v1.1)', () => {
    // mutations: the console back on Date.now() as it draws → red; the frame's day clock dropped → red; the day clock
    // holding a timestamp (every show or focus would re-draw the frame) → red. The console's clock below its early return
    // is the lint's (react-hooks/rules-of-hooks).
    const console_ = stripComments(read('src/components/Tools/EmergencyConsole.tsx'));
    expect(console_, 'CLOCKS the console: its own clock').toMatch(/const now = useNow\(30_000\);/);
    expect(console_, 'CLOCKS the console: no time read as it draws').not.toMatch(/Date\.now\(\)/);
    const shell = stripComments(read('src/components/Layout/AppShell.tsx'));
    expect(shell, 'CLOCKS the frame: the day').toMatch(/\buseLocalDay\(\);/);
    const day = fnBody(stripComments(read('src/hooks/useClock.ts')), 'useLocalDay');
    expect(day, 'CLOCKS the day: a day, never a timestamp').toMatch(/useState\(todayLocalISO\)/);
    expect(day, 'CLOCKS set to the day alone').toMatch(/setDay\(todayLocalISO\(\)\)/);
    expect(day, 'CLOCKS woken at the next local midnight').toMatch(/msToNextLocalDay\(Date\.now\(\)\)/);
  });

  it('⭐ CADENCES — the old screens keep the old cadence; what you watch gets the live one', () => {
    // mutation: useBtcPrice on the live cadence (the Mining tab re-running each second) → red
    const old = stripComments(read('src/hooks/useBtcPrice.ts'));
    expect(old, 'CADENCES useBtcPrice: the slow one').toMatch(/useSyncExternalStore\(liveBtc\.subscribeSlow, liveBtc\.getSlow/);
    const live = stripComments(read('src/hooks/useLivePrice.ts'));
    expect(live, 'CADENCES useLivePrice: the live one').toMatch(/useSyncExternalStore\(liveBtc\.subscribe, liveBtc\.get,/);
    for (const p of ['src/components/SimpleMode/PriceChart.tsx', 'src/components/PowerLaw/PowerLawFace.tsx', 'src/components/PowerLaw/PowerLawChart.tsx']) {
      expect(stripComments(read(p)), `CADENCES ${p}`).toMatch(/\buseLivePrice\(\)/);
    }
  });

  it('⭐ TESTS NEVER REACH COINBASE — the browser tests resolve its feed and its REST price nowhere', () => {
    // mutation: the rule dropped, so a run on a networked machine reads the real price → red
    expect(read('playwright.config.ts'), 'TESTS NEVER REACH COINBASE').toContain(
      "--host-resolver-rules=MAP ws-feed.exchange.coinbase.com ~NOTFOUND, MAP api.coinbase.com ~NOTFOUND");
  });
});
