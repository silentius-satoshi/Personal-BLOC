// 5e (F12) — the price chart's own history, kept on this device and drawn at once on the next visit, at any age: an old one
// is drawn muted with its time ("as of 2:05 PM") until a fresh one lands. One localStorage key of its own, outside the
// persisted store: no store version, never synced, never in a backup. Public prices only, the same for every identity,
// so "Remove local key" keeps it (wipeLocalPlanData's inventory: device-level).
//
// ⚠ Never the history THIS MONTH's breaker reads (usePowerLawData, /api/btc-history): that one stays network-only, and
// sharing this cache with it would make F12 a Safety change. Nothing here imports the store, and the store imports nothing
// here.
//
// A history's time is the EARLIER of when it landed on this device and when its newest candle closes (its time plus the
// range's granularity). A copy the API's edge cache kept too long is then dated by its own candles, not by its arrival.
// Up to HISTORY_FRESH_MS old it is drawn as live; older, it is labeled; dated in the future, or malformed, never drawn.
// A history never replaces a newer one — in this cache, and so on screen, which draws from it.
import type { Candle, ChartRange } from '../hooks/useBtcHistory';
import { toLocalISO } from '../utils/format';

export const CANDLES_KEY = 'bloc-btc-candles';

/** Past this age a history is labeled with its time: the age at which the app already calls a price stale (useBtcPrice's
 *  STALE_MS — stale once older than 5 minutes). */
export const HISTORY_FRESH_MS = 5 * 60 * 1000;

/** Coinbase's cap per request, so the most one range can hold (the three ranges keep 60 + 96 + 168 = 324). */
export const MAX_CANDLES = 300;

const RANGES: readonly ChartRange[] = ['1H', '1D', '1W'];

/** One range's history: `at` is when this device's fetch landed (epoch ms, this device's clock). */
export interface HistoryEntry {
  at:      number;
  candles: Candle[];
}

type Histories = Partial<Record<ChartRange, HistoryEntry>>;

/** Two to MAX_CANDLES candles, finite ascending times, finite positive prices, and a finite landing time. */
export function isWellFormed(e: unknown): e is HistoryEntry {
  if (!e || typeof e !== 'object') return false;
  const { at, candles } = e as { at?: unknown; candles?: unknown };
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return false;
  if (!Array.isArray(candles) || candles.length < 2 || candles.length > MAX_CANDLES) return false;
  let prev = -Infinity;
  for (const c of candles) {
    if (!c || typeof c !== 'object') return false;
    const { t, price } = c as { t?: unknown; price?: unknown };
    if (typeof t !== 'number' || !Number.isFinite(t) || t <= prev) return false;
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return false;
    prev = t;
  }
  return true;
}

/** The earlier of the history's landing and its newest candle's close (the candle's time plus the range's granularity). */
export function historyTime(e: HistoryEntry, granularityMs: number): number {
  return Math.min(e.at, e.candles[e.candles.length - 1].t + granularityMs);
}

/** Drawn at all: well formed, and not dated in the future (a clock set back, or a bad copy). */
export function isDrawable(e: HistoryEntry | null | undefined, granularityMs: number, now: number): e is HistoryEntry {
  return !!e && isWellFormed(e) && historyTime(e, granularityMs) <= now;
}

/** Drawn with its label: more than HISTORY_FRESH_MS old. At exactly the line it is still drawn as live. */
export function isOld(e: HistoryEntry, granularityMs: number, now: number): boolean {
  return now - historyTime(e, granularityMs) > HISTORY_FRESH_MS;
}

/** How long until a history drawn as live has to be labeled — the chart's timer, so an offline one is labeled on time. */
export function msUntilOld(e: HistoryEntry, granularityMs: number, now: number): number {
  return Math.max(0, historyTime(e, granularityMs) + HISTORY_FRESH_MS + 1 - now);
}

/** "as of 2:05 PM", or "as of Oct 18, 2:05 PM" when it isn't today — local time, the day by the local-date helper. */
export function asOfLabel(time: number, now: number): string {
  const d = new Date(time);
  const clock = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (toLocalISO(d) === toLocalISO(new Date(now))) return `as of ${clock}`;
  return `as of ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${clock}`;
}

// ── The cache: one key on this device, read lazily into memory, shared by every mounted chart ─────────────────────────

/** The two calls the cache makes. Node (the tests) has no localStorage; a test passes its own. */
export interface CandlesStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let storageOverride: CandlesStorage | null | undefined;
let memory: Histories | null = null;
const listeners = new Set<() => void>();

function storage(): CandlesStorage | null {
  if (storageOverride !== undefined) return storageOverride;
  try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

/** The stored value, malformed ranges dropped (a bad copy is never drawn). */
export function parseCandlesCache(raw: string | null): Histories {
  if (!raw) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return {}; }
  if (!parsed || typeof parsed !== 'object') return {};
  const ranges = (parsed as { ranges?: unknown }).ranges;
  if (!ranges || typeof ranges !== 'object') return {};
  const out: Histories = {};
  for (const r of RANGES) {
    const e = (ranges as Record<string, unknown>)[r];
    if (isWellFormed(e)) out[r] = { at: e.at, candles: e.candles.map((c) => ({ t: c.t, price: c.price })) };
  }
  return out;
}

function load(): Histories {
  if (memory) return memory;
  let raw: string | null = null;
  try { raw = storage()?.getItem(CANDLES_KEY) ?? null; } catch { raw = null; }
  memory = parseCandlesCache(raw);
  return memory;
}

/** The range's history as stored — a stable reference until the next write (useSyncExternalStore's snapshot). */
export function readHistory(range: ChartRange): HistoryEntry | null {
  return load()[range] ?? null;
}

/**
 * A history that landed. Kept only if it is well formed and isn't older than the one held — a history never replaces a
 * newer one (one held from the future is no history: it gives way). Returns whether it was kept.
 */
export function writeHistory(range: ChartRange, candles: Candle[], at: number, granularityMs: number, now: number = at): boolean {
  const entry: HistoryEntry = { at, candles };
  if (!isWellFormed(entry)) return false;
  const held = load()[range];
  if (held && isDrawable(held, granularityMs, now) && historyTime(held, granularityMs) > historyTime(entry, granularityMs)) {
    return false;
  }
  memory = { ...load(), [range]: entry };
  try { storage()?.setItem(CANDLES_KEY, JSON.stringify({ v: 1, ranges: memory })); } catch { /* quota or private mode: memory only */ }
  for (const l of listeners) l();
  return true;
}

export function subscribeHistory(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Tests only: forget the memory, and read from (and write to) `s` instead of localStorage. */
export function resetCandlesCache(s?: CandlesStorage | null): void {
  memory = null;
  storageOverride = s;
  for (const l of listeners) l();
}
