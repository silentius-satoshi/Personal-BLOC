import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  CANDLES_KEY, HISTORY_FRESH_MS, MAX_CANDLES, asOfLabel, historyTime, isDrawable, isOld, isWellFormed, msUntilOld,
  parseCandlesCache, readHistory, resetCandlesCache, subscribeHistory, writeHistory, type CandlesStorage, type HistoryEntry,
} from '../btcCandlesCache';

/**
 * 5e (F12, spec `pbloc-spec-batch-1-v1` §2.1 and its review's change 1) — the price chart's history, kept on this device
 * and drawn at once, at any age: up to 5 minutes old as live, older muted with "as of …" until a fresh one lands. A history
 * is dated by the EARLIER of its landing and its newest candle's close, so an edge-cached copy is dated by its own
 * candles; one dated in the future, or malformed, is never drawn; and one never replaces a newer one. The hook and the
 * chart are read off their source (the repo has no render harness). Round synthetic prices — public data, invented here.
 */

const MIN = 60_000;
const G_1D = 15 * MIN;   // 1D's candles are 15 minutes
const NOW = 1_800_000_000_000;

/** A history of `n` candles whose newest STARTS at `newestT` (so it closes at newestT + granularity), landed at `at`. */
const history = (at: number, newestT: number, n = 4, step = G_1D): HistoryEntry => ({
  at,
  candles: Array.from({ length: n }, (_, i) => ({ t: newestT - (n - 1 - i) * step, price: 90_000 + i * 100 })),
});
/** Landed at `at`, its newest candle still open then (closes after it lands): the history's time is its landing. */
const landed = (at: number): HistoryEntry => history(at, at - MIN);

const memStorage = (): CandlesStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
};

beforeEach(() => { resetCandlesCache(memStorage()); });

describe('⭐ F12 OLD — at any age it is drawn; past 5 minutes it is labeled', () => {
  it('⭐ F12 OLD — at exactly 5 minutes: drawn, unlabeled; 1 ms past: drawn, labeled', () => {
    const atLine = landed(NOW - HISTORY_FRESH_MS);
    expect(historyTime(atLine, G_1D), 'OLD premise: its time is its landing').toBe(NOW - HISTORY_FRESH_MS);
    expect(isDrawable(atLine, G_1D, NOW), 'OLD drawn at the line').toBe(true);
    expect(isOld(atLine, G_1D, NOW), 'OLD unlabeled at the line').toBe(false);
    const past = landed(NOW - HISTORY_FRESH_MS - 1);
    expect(isDrawable(past, G_1D, NOW), 'OLD drawn past the line').toBe(true);
    expect(isOld(past, G_1D, NOW), 'OLD labeled past the line').toBe(true);
  });

  it('⭐ F12 OLD — a day-old history is still drawn (at once, not "loading…"), labeled', () => {
    const dayOld = landed(NOW - 24 * 60 * MIN);
    expect(isDrawable(dayOld, G_1D, NOW), 'OLD a day old, drawn').toBe(true);
    expect(isOld(dayOld, G_1D, NOW), 'OLD a day old, labeled').toBe(true);
  });

  it('⭐ F12 OLD — the timer: a history drawn as live is labeled the moment it crosses (offline, nothing renews it)', () => {
    const fresh = landed(NOW);
    const wait = msUntilOld(fresh, G_1D, NOW);
    expect(wait, 'OLD the wait').toBe(HISTORY_FRESH_MS + 1);
    expect(isOld(fresh, G_1D, NOW + wait - 1), 'OLD not yet').toBe(false);
    expect(isOld(fresh, G_1D, NOW + wait), 'OLD at the timer').toBe(true);
    expect(msUntilOld(landed(NOW - 2 * HISTORY_FRESH_MS), G_1D, NOW), 'OLD an old one needs no wait').toBe(0);
  });

  it('the label line is the app\'s own staleness line for a price: 5 minutes', () => {
    expect(HISTORY_FRESH_MS).toBe(5 * 60 * 1000);
  });
});

describe('⭐ F12 EDGE — a history is dated by its own candles when they are older than its arrival', () => {
  it('⭐ F12 EDGE — a live response whose newest candle closed an hour ago is labeled at once', () => {
    // An edge cache's stale copy: it lands now, but its newest 15-minute candle started an hour and a quarter ago.
    const edge = history(NOW, NOW - 60 * MIN - G_1D);
    expect(historyTime(edge, G_1D), 'EDGE dated by its candles').toBe(NOW - 60 * MIN);
    expect(isDrawable(edge, G_1D, NOW), 'EDGE drawn').toBe(true);
    expect(isOld(edge, G_1D, NOW), 'EDGE labeled at once').toBe(true);
  });

  it('a live response whose newest candle is still open is dated by its landing', () => {
    const live = history(NOW, NOW - 5 * MIN);   // closes 10 minutes from now
    expect(historyTime(live, G_1D)).toBe(NOW);
    expect(isOld(live, G_1D, NOW)).toBe(false);
  });
});

describe('⭐ F12 NEWER — a history never replaces a newer one', () => {
  it('⭐ F12 NEWER — an older history (an edge-cached copy) is refused; the newer one stays, in the cache and so on screen', () => {
    expect(writeHistory('1D', landed(NOW).candles, NOW, G_1D, NOW), 'NEWER premise: the fresh one is kept').toBe(true);
    const held = readHistory('1D');
    const stale = history(NOW + MIN, NOW - 60 * MIN - G_1D);   // lands a minute later, dated an hour ago by its candles
    expect(writeHistory('1D', stale.candles, stale.at, G_1D, NOW + MIN), 'NEWER the older one is refused').toBe(false);
    expect(readHistory('1D'), 'NEWER the newer one stays').toBe(held);
  });

  it('⭐ F12 NEWER — a newer history replaces it, and an equal one too (a later fetch of the same data)', () => {
    writeHistory('1D', landed(NOW).candles, NOW, G_1D, NOW);
    const newer = landed(NOW + MIN);
    expect(writeHistory('1D', newer.candles, newer.at, G_1D, newer.at), 'NEWER newer replaces').toBe(true);
    expect(readHistory('1D')?.at).toBe(NOW + MIN);
    expect(writeHistory('1D', newer.candles, newer.at, G_1D, newer.at), 'NEWER equal replaces').toBe(true);
  });

  it('one held from the future (a clock set back) is no history: it gives way', () => {
    writeHistory('1D', landed(NOW + 60 * MIN).candles, NOW + 60 * MIN, G_1D, NOW + 60 * MIN);
    expect(writeHistory('1D', landed(NOW).candles, NOW, G_1D, NOW)).toBe(true);
    expect(readHistory('1D')?.at).toBe(NOW);
  });

  it('each range keeps its own history: a write to one never touches another', () => {
    writeHistory('1D', landed(NOW).candles, NOW, G_1D, NOW);
    const oneD = readHistory('1D');
    writeHistory('1H', landed(NOW).candles, NOW, MIN, NOW);
    expect(readHistory('1D')).toBe(oneD);
    expect(readHistory('1W')).toBeNull();
  });
});

describe('⭐ F12 FUTURE and SHAPE — never drawn', () => {
  it('⭐ F12 FUTURE — a history dated in the future is never drawn', () => {
    expect(isDrawable(landed(NOW + 1), G_1D, NOW), 'FUTURE landed a millisecond from now').toBe(false);
    expect(isDrawable(landed(NOW), G_1D, NOW), 'FUTURE non-vacuity: landed now is drawn').toBe(true);
    expect(isDrawable(null, G_1D, NOW)).toBe(false);
  });

  it('⭐ F12 SHAPE — malformed copies are never drawn, and a bad stored value reads as nothing', () => {
    const ok = landed(NOW);
    expect(isWellFormed(ok), 'SHAPE premise').toBe(true);
    const bad: unknown[] = [
      null, 7, 'x', {}, { at: NOW }, { candles: ok.candles },
      { ...ok, at: NaN }, { ...ok, at: 0 }, { ...ok, at: -1 }, { ...ok, candles: 'x' },
      { ...ok, candles: ok.candles.slice(0, 1) },                                                            // one point
      { ...ok, candles: Array.from({ length: MAX_CANDLES + 1 }, (_, i) => ({ t: i + 1, price: 1 })) },        // past the cap
      { ...ok, candles: [ok.candles[1], ok.candles[0]] },                                                    // descending
      { ...ok, candles: [ok.candles[0], ok.candles[0]] },                                                    // a repeated time
      { ...ok, candles: [{ t: 1, price: 0 }, { t: 2, price: 1 }] },
      { ...ok, candles: [{ t: 1, price: 1 }, { t: 2, price: NaN }] },
      { ...ok, candles: [{ t: 1, price: 1 }, { t: Infinity, price: 1 }] },
      { ...ok, candles: [{ t: 1, price: 1 }, null] },
    ];
    for (const b of bad) expect(isWellFormed(b), `SHAPE ${JSON.stringify(b)?.slice(0, 60)}`).toBe(false);
    expect(parseCandlesCache('{not json'), 'SHAPE bad JSON').toEqual({});
    expect(parseCandlesCache(null)).toEqual({});
    expect(parseCandlesCache(JSON.stringify({ v: 1 })), 'SHAPE no ranges').toEqual({});
    const mixed = parseCandlesCache(JSON.stringify({ v: 1, ranges: { '1D': ok, '1H': { at: NOW }, '5Y': ok } }));
    expect(Object.keys(mixed), 'SHAPE keeps only the good, known ranges').toEqual(['1D']);
    expect(writeHistory('1D', ok.candles.slice(0, 1), NOW, G_1D, NOW), 'SHAPE a one-point response is never kept').toBe(false);
  });
});

describe('⭐ F12 LABEL — "as of" in local time', () => {
  it('⭐ F12 LABEL — today: the time; another day: the date and the time', () => {
    const at = new Date(2026, 9, 18, 14, 5).getTime();   // Oct 18, 2:05 PM, local
    expect(asOfLabel(at, new Date(2026, 9, 18, 16, 0).getTime()), 'LABEL today').toMatch(/^as of 2:05\sPM$/);
    expect(asOfLabel(at, new Date(2026, 9, 19, 9, 0).getTime()), 'LABEL not today').toMatch(/^as of Oct 18, 2:05\sPM$/);
    // Local midnight is the line — the local-date helper, never the UTC date.
    expect(asOfLabel(new Date(2026, 9, 18, 23, 59).getTime(), new Date(2026, 9, 19, 0, 1).getTime())).toMatch(/^as of Oct 18, /);
  });
});

describe('⭐ F12 STORE — its own key on this device', () => {
  it('⭐ F12 STORE — a kept history is written under its key and read back by a fresh session', () => {
    const s = memStorage();
    resetCandlesCache(s);
    let heard = 0;
    const off = subscribeHistory(() => { heard++; });
    writeHistory('1W', landed(NOW).candles, NOW, 60 * MIN, NOW);
    off();
    expect(heard, 'STORE every mounted chart hears a write').toBe(1);
    expect([...s.data.keys()], 'STORE one key').toEqual([CANDLES_KEY]);
    expect(CANDLES_KEY).toBe('bloc-btc-candles');
    expect(JSON.parse(s.data.get(CANDLES_KEY)!).ranges['1W'].at).toBe(NOW);
    resetCandlesCache(s);   // a new session: memory forgotten, the device's copy read again
    expect(readHistory('1W')?.at, 'STORE read back').toBe(NOW);
  });

  it('a storage that refuses (quota, private mode) keeps the history in memory; no storage at all works the same', () => {
    resetCandlesCache({ getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('quota'); } });
    expect(writeHistory('1D', landed(NOW).candles, NOW, G_1D, NOW)).toBe(true);
    expect(readHistory('1D')?.at).toBe(NOW);
    resetCandlesCache(null);
    expect(readHistory('1D')).toBeNull();
    expect(writeHistory('1D', landed(NOW).candles, NOW, G_1D, NOW)).toBe(true);
  });
});

// ── Wiring, read off the source ───────────────────────────────────────────────────────────────────────────────────────

const SRC = join(process.cwd(), 'src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : sources(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name) ? [p] : [];
  });
}

describe('⭐ F12 OWN KEY — outside the store, never synced, never in a backup, never the breaker\'s history', () => {
  it('⭐ F12 OWN KEY — the key lives in one module; the store, the backup, the sync and usePowerLawData never touch it', () => {
    const files = sources(SRC);
    expect(files.length, 'OWN KEY the sweep reads src').toBeGreaterThan(200);
    const named = files.filter((f) => readFileSync(f, 'utf8').includes(CANDLES_KEY)).map((f) => f.slice(SRC.length + 1));
    expect(named.sort(), 'OWN KEY named only by its module and the key inventory').toEqual(['lib/btcCandlesCache.ts', 'lib/store/wipeLocalPlanData.ts']);
    const cache = code(read('lib/btcCandlesCache.ts'));
    expect(cache, 'OWN KEY the cache imports no store').not.toMatch(/from '[^']*store[^']*'/);
    for (const f of files.filter((p) => /[\\/](store|backup|nostr|planEvents)[\\/]/.test(p))) {
      expect(readFileSync(f, 'utf8'), `OWN KEY ${f.slice(SRC.length + 1)} never imports the chart's cache`).not.toMatch(/from '[^']*btcCandlesCache'/);
    }
    expect(read('hooks/usePowerLawData.ts'), 'OWN KEY the breaker\'s history stays network-only').not.toMatch(/btcCandlesCache|bloc-btc-candles/);
  });
});

describe('⭐ F12 RANGE and MONEY — the hook and the chart', () => {
  const HOOK = code(read('hooks/useBtcHistory.ts'));
  const CHART = code(read('components/SimpleMode/PriceChart.tsx'));

  it('⭐ F12 RANGE — the hook draws only its range\'s history, from the cache, by the age rule; the timer labels it', () => {
    expect(HOOK, 'RANGE from the cache, by range').toMatch(/useSyncExternalStore\(subscribeHistory, \(\) => readHistory\(range\), \(\) => readHistory\(range\)\)/);
    expect(HOOK, 'RANGE no candles of its own to leave behind on a switch').not.toMatch(/useState<Candle\[\]>/);
    expect(HOOK, 'RANGE drawn by the rule').toMatch(/const drawn = isDrawable\(entry, granularityMs, now\) \? entry : null;/);
    expect(HOOK, 'RANGE labeled by the rule').toMatch(/const old\s+= drawn !== null && isOld\(drawn, granularityMs, now\);/);
    expect(HOOK, 'RANGE the timer').toMatch(/setTimeout\(\(\) => setTick\(\(n\) => n \+ 1\), msUntilOld\(drawn, granularityMs, Date\.now\(\)\)\)/);
    expect(HOOK, 'RANGE a landing is written through the newer-wins rule').toMatch(/writeHistory\(range, parsed, landed, granularity \* 1000, landed\);/);
    expect(HOOK, 'RANGE asOf is the history\'s time, only when old').toMatch(/asOf:\s+drawn && old \? historyTime\(drawn, granularityMs\) : null,/);
  });

  it('⭐ F12 MONEY — the counting price prints through `money` (cents on THIS MONTH and Daily); an old history shows its time instead of the change', () => {
    expect(CHART, 'MONEY whole by default').toMatch(/\{ money = fmtUSD \}/);
    expect(CHART, 'MONEY the count').toMatch(/const shown\s+= useCountTo\(hasData \? last : null\);/);
    expect(CHART, 'MONEY the headline prints the counting figure through money').toMatch(/\{money\(shown \?\? last\)\}/);
    expect(CHART, 'MONEY no figure printed any other way').not.toMatch(/\bfmtUSD\(|fmtUSDCents\(|toLocaleString\(/);
    expect(CHART, 'MONEY the label in place of the change').toMatch(/asOf !== null \? \(\s*<span className=\{styles\.asOf\}>\{asOfLabel\(asOf, Date\.now\(\)\)\}<\/span>\s*\) : \(\s*<span className=\{styles\.change\}/);
    expect(CHART, 'MONEY muted when old').toMatch(/const color\s+= old \? 'var\(--text-muted\)'/);
    expect(read('components/SimpleMode/SafetyDashboard.tsx'), 'MONEY THIS MONTH and Daily: to the cent').toMatch(/<PriceChart money=\{fmtUSDCents\} \/>/);
  });
});
