/**
 * BL51 — app updates: "New version ready · Update", one tap, never a restart by itself.
 *
 * The cause it answers (measured on two production builds of BL50's code, spec `pbloc-spec-app-updates-v1` §4): the
 * service worker takes over as soon as a new one installs (`sw.ts`'s skipWaiting + clientsClaim; `registerSW` in
 * autoUpdate mode reloads the page then), but nothing asks for one while the app runs — so an app brought back to the
 * front keeps its build, and its next fresh start loads the old build and restarts by itself on the new one, seconds in.
 *
 * Here: the app asks the server which build is live — `/version.json`, written beside the bundle at build time with the
 * same sha and time the bundle carries (`vite.config.ts`; `__BUILD_SHA__`, `__BUILD_TIME__`) — when it opens, when it
 * comes back to the front and every hour. Another build → the home's card and Settings → About offer the update; ONE TAP
 * applies it (applyUpdate): the service worker checks its script, the new one installs and takes over, and registerSW's
 * own restart loads it. Nothing here restarts the app without that tap, and nothing here touches the service worker's
 * own path — offline launch and unlock read the same precache as before. No store field: the state lives in this
 * module, for the session.
 */
import { withTimeLimit } from '../utils/timeLimit';

/** The deployed build's stamp, beside the app (not precached: the PWA's globPatterns take no `.json`). */
export const VERSION_URL = '/version.json';
/** When it opens: after the service worker's own check, which on a fresh start that finds a new build restarts the app
 *  once the new worker has installed — about 3 s in on a fast link (measured), so the card doesn't show on a build about
 *  to go; on a slow link the restart can come later, and the card first (a tap then waits for that same worker). */
export const OPEN_DELAY_MS = 10_000;
/** Back to the front: at most one check a minute (a phone flips visibility often). iOS home-screen apps fire
 *  `visibilitychange` unreliably on resume, so `focus` and `pageshow` count too — `usePageVisibility`'s three signals. */
export const FOREGROUND_GAP_MS = 60_000;
/** Every hour, while the app is on screen. */
export const HOURLY_MS = 60 * 60_000;
/** A check's request and its body, within this or none (a request that never answers would hold every later check). */
export const CHECK_TIMEOUT_MS = 15_000;
/** After a tap, once the new worker is active: if registerSW hasn't restarted the page by then, the tap's own restart. */
export const RELOAD_FALLBACK_MS = 5_000;

export type UpdateStatus = 'idle' | 'checking' | 'current' | 'available' | 'unknown' | 'updating' | 'failed';
export interface UpdateState { status: UpdateStatus; checkedAt: number | null }
/** A build's stamp: its sha and its time — `version.json`'s, and the bundle's own. */
export interface BuildStamp { sha: string; time: string }

/** The words, one place: the home's card and Settings → About read them. */
export const UPDATE_WORDS = {
  ready: 'New version ready',
  update: 'Update',
  updating: 'Updating…',
  tryAgain: 'Try again',
  check: 'Check for updates',
  checking: 'Checking…',
  current: 'You’re on the latest version',
  unknown: 'Couldn’t check — check your connection',
  failed: 'Couldn’t update — check your connection',
} as const;

/** This bundle's own stamp — the same two constants `versionFile()` writes into its `version.json`. */
export function ownStamp(): BuildStamp {
  return { sha: __BUILD_SHA__, time: __BUILD_TIME__ };
}

/** The deployed build's stamp from `version.json`'s body — a non-empty sha and time — else null. PURE. */
export function deployedStamp(body: unknown): BuildStamp | null {
  const b = body as { sha?: unknown; time?: unknown } | null;
  const sha = typeof b?.sha === 'string' ? b.sha.trim() : '';
  const time = typeof b?.time === 'string' ? b.time.trim() : '';
  return sha !== '' && time !== '' ? { sha, time } : null;
}

/** PURE: another build deployed → 'available' — another commit, or the same one built again (a redeploy, a changed
 *  setting: a new bundle all the same); this one → 'current'; no stamp to read → 'unknown'. */
export function compareBuild(own: BuildStamp, deployed: BuildStamp | null): 'current' | 'available' | 'unknown' {
  if (deployed === null) return 'unknown';
  return deployed.sha === own.sha && deployed.time === own.time ? 'current' : 'available';
}

/** Asks the server which build is live, within CHECK_TIMEOUT_MS. An older deploy has no file, and its SPA rewrite
 *  answers with the page (200, text/html) — read as no stamp, never as a new build. Offline, past the limit, or any
 *  failure: null. */
export async function fetchDeployedStamp(fetchImpl: typeof fetch = fetch, limitMs: number = CHECK_TIMEOUT_MS): Promise<BuildStamp | null> {
  try {
    return await withTimeLimit(limitMs, async (signal) => {
      const res = await fetchImpl(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store', signal });
      if (!res.ok || !(res.headers.get('content-type') ?? '').includes('json')) return null;
      return deployedStamp(await res.json());
    });
  } catch {
    return null;
  }
}

// ── the session's state (no store field) ────────────────────────────────────────────────────────────────────────────

let state: UpdateState = { status: 'idle', checkedAt: null };
let inFlight: Promise<UpdateStatus> | null = null;
const listeners = new Set<() => void>();
export const getUpdateState = (): UpdateState => state;
export function subscribeUpdate(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function setState(next: Partial<UpdateState>): void {
  state = { ...state, ...next };
  for (const l of listeners) l();
}
/** Tests only: back to a fresh session. */
export function resetUpdateStateForTests(): void {
  state = { status: 'idle', checkedAt: null };
  inFlight = null;
}

/** An update on offer: found ('available'), or a tap on it that failed ('failed' — "Try again"). */
const offered = (s: UpdateStatus): boolean => s === 'available' || s === 'failed';

/** One check. It NEVER applies an update — only a tap does (applyUpdate). An update on offer stays on screen through a
 *  check, and stays offered when the check can't reach the file — a failed tap's words too ("Try again", until the next
 *  tap: v1.1, Claude Code's note 3); a check that finds this build again takes it away (a rollback). A tap made while a
 *  check is out keeps its own state: the check's answer never overwrites 'updating', nor a tap that failed meanwhile. */
export function checkForUpdate(fetchImpl?: typeof fetch, limitMs?: number): Promise<UpdateStatus> {
  if (state.status === 'updating') return Promise.resolve(state.status);
  if (inFlight) return inFlight;
  if (!offered(state.status)) setState({ status: 'checking' });
  inFlight = fetchDeployedStamp(fetchImpl, limitMs).then((stamp) => {
    if (state.status === 'updating') return state.status;
    const found = compareBuild(ownStamp(), stamp);
    const status: UpdateStatus = offered(state.status) && found !== 'current' ? state.status : found;
    setState({ status, checkedAt: Date.now() });
    return status;
  }).finally(() => { inFlight = null; });
  return inFlight;
}

export interface ApplyEnv {
  getRegistration: () => Promise<ServiceWorkerRegistration | undefined>;
  /** Calls `fn` with the worker's state now, and again at each change. */
  watch: (worker: ServiceWorker, fn: (s: ServiceWorkerState) => void) => void;
  reload: () => void;
  later: (fn: () => void, ms: number) => void;
}
const browserApply: ApplyEnv = {
  getRegistration: () => (navigator.serviceWorker ? navigator.serviceWorker.getRegistration() : Promise.resolve(undefined)),
  watch: (worker, fn) => {
    worker.addEventListener('statechange', () => fn(worker.state));
    fn(worker.state);
  },
  reload: () => window.location.reload(),
  later: (fn, ms) => { window.setTimeout(fn, ms); },
};

/** THE TAP — the only way this module restarts the app. The service worker checks its script; a new one installs and
 *  takes over (sw.ts' skipWaiting), and registerSW's autoUpdate restarts the page on it — the tap restarts it itself only
 *  once that worker is active (RELOAD_FALLBACK_MS later), never while it still installs: a restart then would reopen
 *  the old build, and a page opened then isn't told when the worker takes over, so it would stay an old page under the
 *  new worker, its lazy chunks gone (the independent check's F1, measured on a slow link). A worker that fails to
 *  install → 'failed'. No service worker (the dev server, a browser without one) or nothing new to install → a plain
 *  restart, which loads the live build. Offline → nothing changes, and the card says so. */
export async function applyUpdate(env: ApplyEnv = browserApply): Promise<void> {
  if (state.status === 'updating') return;
  setState({ status: 'updating' });
  try {
    const reg = await env.getRegistration();
    if (!reg) { env.reload(); return; }
    await reg.update();
    const worker = reg.installing ?? reg.waiting;
    if (!worker) { env.reload(); return; }
    let settled = false;
    env.watch(worker, (s) => {
      if (settled) return;
      if (s === 'activated') { settled = true; env.later(() => env.reload(), RELOAD_FALLBACK_MS); }
      if (s === 'redundant') { settled = true; setState({ status: 'failed' }); }
    });
  } catch {
    setState({ status: 'failed' });
  }
}

export interface CheckEnv {
  now: () => number;
  visible: () => boolean;
  onForeground: (fn: () => void) => () => void;
  after: (fn: () => void, ms: number) => () => void;
  every: (fn: () => void, ms: number) => () => void;
}
const browserCheck: CheckEnv = {
  now: () => Date.now(),
  visible: () => document.visibilityState === 'visible',
  onForeground: (fn) => {
    document.addEventListener('visibilitychange', fn);
    window.addEventListener('focus', fn);
    window.addEventListener('pageshow', fn);
    return () => {
      document.removeEventListener('visibilitychange', fn);
      window.removeEventListener('focus', fn);
      window.removeEventListener('pageshow', fn);
    };
  },
  after: (fn, ms) => { const id = window.setTimeout(fn, ms); return () => window.clearTimeout(id); },
  every: (fn, ms) => { const id = window.setInterval(fn, ms); return () => window.clearInterval(id); },
};

/** The three checks: when it opens (after OPEN_DELAY_MS), when it comes back to the front (at most once a minute) and
 *  every hour while on screen. Started once, from main.tsx. Returns its stop. Checks only — never applyUpdate.
 *  The minute counts from the start: a fresh start fires `pageshow` (and often `focus`) at once, and the open check is
 *  the first — never a check before the service worker's own restart onto a new build. */
export function startUpdateChecks(env: CheckEnv = browserCheck, check: () => unknown = () => checkForUpdate()): () => void {
  let lastAt = env.now();
  const run = () => { lastAt = env.now(); void check(); };
  const stops = [
    env.after(run, OPEN_DELAY_MS),
    env.onForeground(() => { if (env.visible() && env.now() - lastAt >= FOREGROUND_GAP_MS) run(); }),
    env.every(() => { if (env.visible()) run(); }, HOURLY_MS),
  ];
  return () => { for (const s of stops) s(); };
}
