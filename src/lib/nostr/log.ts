// In-app Nostr log ring buffer — pure (no store imports), sessionStorage-backed.
// PRIVACY RULE: entries carry sync METADATA only — never balances, amounts, or log-entry contents.

export interface NostrLogEntry {
  ts:    number;
  level: 'info' | 'warn' | 'error';
  msg:   string;
  data?: string;
}

const STORAGE_KEY = 'bloc-nostr-log';
const MAX = 50;

function load(): NostrLogEntry[] {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as NostrLogEntry[]) : [];
  } catch { return []; }   // node/test env, private mode, corrupt JSON
}

let entries: NostrLogEntry[] = load();
const subscribers = new Set<() => void>();

function persist(): void {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries)); } catch { /* quota/private-mode/node */ }
}

function notify(): void {
  for (const fn of subscribers) fn();
}

function serializeData(data: unknown): string | undefined {
  if (data === undefined) return undefined;
  try {
    const s = data instanceof Error ? data.message : JSON.stringify(data);
    return s === undefined ? undefined : s.slice(0, 300);
  } catch { return undefined; }
}

export function nostrLog(level: NostrLogEntry['level'], msg: string, data?: unknown): void {
  const dataStr = serializeData(data);
  if (level === 'info') console.info(`[Nostr] ${msg}`, data ?? '');
  else console.warn(`[Nostr] ${msg}`, data ?? '');
  const entry: NostrLogEntry = { ts: Date.now(), level, msg, ...(dataStr !== undefined ? { data: dataStr } : {}) };
  entries = [...entries, entry].slice(-MAX);   // new array each time — stable snapshot for useSyncExternalStore
  persist();
  notify();
}

/** Newest last. */
export function getNostrLog(): NostrLogEntry[] {
  return entries;
}

export function clearNostrLog(): void {
  entries = [];
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* node/private mode */ }
  notify();
}

export function subscribeNostrLog(fn: () => void): () => void {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}
