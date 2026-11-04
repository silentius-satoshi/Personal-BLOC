import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { VERSION_URL } from '../appUpdate';

/**
 * ⚠ BL51 — app updates (spec `pbloc-spec-app-updates-v1`), the wiring, read off the source: the checks start once, beside
 * the service worker's registration, which stays as it was; only the two buttons apply an update, and the checks never
 * do; the build writes `version.json` with the bundle's own stamp and the service worker never precaches it; the card on
 * the home (never the preview) and the row in both Settings; no store field. appUpdate.test.ts tests the module's
 * behaviour, appUpdateViews.test.tsx the two views, e2e/appUpdate.spec.ts all of it in a browser. Each assertion carries
 * its tag.
 */

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/.*$/gm, '');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === '__tests__' ? [] : files(p);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const naming = (re: RegExp): string[] => files(SRC).filter((f) => re.test(code(readFileSync(f, 'utf8'))))
  .map((f) => f.slice(ROOT.length + 1)).sort();
/** A top-level function's text, from its `export function` line to the closing brace at column 0. */
function fn(src: string, name: string): string {
  const i = src.search(new RegExp(`^export (async )?function ${name}\\b`, 'm'));
  expect(i, `premise: ${name} found`).toBeGreaterThanOrEqual(0);
  return src.slice(i, src.indexOf('\n}\n', i) + 2);
}

const MOD = 'src/lib/appUpdate.ts';
const CARD = 'src/components/ui/UpdateCard.tsx';
const CHECK = 'src/components/Settings/UpdateCheck.tsx';

describe('⭐ where it starts, and who may apply', () => {
  it('⭐ ONE START — main.tsx starts the checks once, after the service worker\'s registration, which is as it was', () => {
    const main = code(read('src/main.tsx'));
    expect(main.match(/\bregisterSW\(/g), 'ONE START one registration').toHaveLength(1);
    expect(main, 'ONE START the registration unchanged: autoUpdate\'s own restart on a new worker').toContain('registerSW({ immediate: true });');
    expect(main.match(/\bstartUpdateChecks\(/g), 'ONE START once').toHaveLength(1);
    expect(main.indexOf('startUpdateChecks();'), 'ONE START after the registration').toBeGreaterThan(main.indexOf('registerSW({ immediate: true });'));
    expect(naming(/\bstartUpdateChecks\(/), 'ONE START no other caller').toEqual([MOD, 'src/main.tsx']);
  });

  it('⭐ ONLY THE TAP — the two buttons apply an update and nothing else does; a check never restarts the app', () => {
    expect(naming(/\bapplyUpdate\(/), 'ONLY THE TAP who names it').toEqual([CHECK, CARD, MOD]);
    for (const f of [CARD, CHECK]) {
      const c = code(read(f));
      expect(c.match(/\bapplyUpdate\(/g), `ONLY THE TAP ${f}: once`).toHaveLength(1);
      expect(c, `ONLY THE TAP ${f}: a button's handler`).toContain('onClick={() => { void applyUpdate(); }}');
    }
    const mod = code(read(MOD));
    for (const name of ['checkForUpdate', 'fetchDeployedStamp', 'startUpdateChecks']) {
      expect(fn(mod, name), `ONLY THE TAP ${name} never restarts or touches the worker`).not.toMatch(/reload|applyUpdate|serviceWorker|getRegistration/);
    }
    expect(mod.match(/location\.reload\(\)/g), 'ONLY THE TAP one restart in the module: the tap\'s env').toHaveLength(1);
    expect(fn(mod, 'applyUpdate'), 'ONLY THE TAP the tap restarts through its env').toMatch(/env\.reload\(\)/);
  });

  it('⭐ WORKER CALLS — only the tap (appUpdate.ts) and dev mode\'s diagnostics (DevPanel, older; its update() on its Refresh tap alone) reach the service worker; only the seven known files restart the app', () => {
    // A hook that "warms" the worker when an update is found — `navigator.serviceWorker…update()` anywhere else — would
    // restart the app with no tap (the independent check planted one: every other BL51 test stayed green).
    expect(naming(/\bserviceWorker\b|\bgetRegistration\b|\bskipWaiting\b|\bclientsClaim\b/), 'WORKER CALLS who reaches it').toEqual([
      'src/components/Settings/DevPanel.tsx', MOD, 'src/sw.ts',
    ]);
    const mod = code(read(MOD));
    const env = mod.slice(mod.indexOf('const browserApply: ApplyEnv = {'), mod.indexOf('\n};\n', mod.indexOf('const browserApply: ApplyEnv = {')));
    expect(env, 'WORKER CALLS premise: the tap\'s env').toContain('navigator.serviceWorker.getRegistration()');
    expect(mod.replace(env, '').match(/\bserviceWorker\b/g), 'WORKER CALLS in appUpdate.ts, the tap\'s env alone').toBeNull();
    const dev = code(read('src/components/Settings/DevPanel.tsx'));
    expect(dev.match(/\.update\(\)/g), 'WORKER CALLS DevPanel\'s one diagnostic update').toHaveLength(1);
    // v1.1 (Claude Code's note 1) — DevPanel asks only on its Refresh tap: opening it (Settings → About, dev mode) asked,
    // and after a deploy registerSW restarted the app onto the new build with no tap
    expect(dev, 'WORKER CALLS DevPanel\'s update() behind its tap').toMatch(/if \(askUpdate\) \{\s*try \{\s*await reg\.update\(\);/);
    expect(dev, 'WORKER CALLS DevPanel opens reading alone').toContain('useEffect(() => { void refreshSwStatus(false); }, []);');
    expect(dev, 'WORKER CALLS DevPanel\'s Refresh asks').toContain('onClick={() => { void refreshSwStatus(true); }}');
    expect(dev.match(/refreshSwStatus\(/g), 'WORKER CALLS nothing else runs it').toHaveLength(2);
    expect(naming(/location\.reload\(/), 'WORKER CALLS who restarts the app').toEqual([
      'src/components/Auth/StoreMigrationGate.tsx', 'src/components/Layout/ErrorBoundary.tsx', 'src/components/Settings/DevPanel.tsx',
      'src/components/Settings/SettingsMain.tsx', 'src/lib/appUpdate.ts', 'src/lib/nostr/disconnect.ts', 'src/lib/store/escapeHatch.ts',
    ]);
  });
});

describe('⭐ the stamp', () => {
  it('⭐ STAMP FILE — the build writes version.json with the bundle\'s own sha and time; the service worker never precaches it', () => {
    const vite = code(read('vite.config.ts'));
    expect(vite.match(/=\s*gitSha\(\)/g), 'STAMP FILE the sha read once a build').toHaveLength(1);
    expect(vite, 'STAMP FILE the bundle\'s sha').toContain('__BUILD_SHA__:  JSON.stringify(BUILD_SHA),');
    expect(vite, 'STAMP FILE the bundle\'s time').toContain('__BUILD_TIME__: JSON.stringify(BUILD_TIME),');
    expect(vite, 'STAMP FILE the file\'s, the same two').toContain('source: `${JSON.stringify({ sha: BUILD_SHA, time: BUILD_TIME })}\\n`');
    expect(vite, 'STAMP FILE the file\'s name').toContain("fileName: 'version.json'");
    expect(VERSION_URL, 'STAMP FILE the app asks for that file').toBe('/version.json');
    expect(vite, 'STAMP FILE a build\'s alone').toContain("apply: 'build'");
    expect(vite, 'STAMP FILE in the build').toMatch(/plugins: \[\s*react\(\),\s*versionFile\(\),/);
    const glob = vite.match(/globPatterns: \[([^\]]*)\]/)?.[1] ?? '';
    expect(glob, 'STAMP FILE premise: the precache\'s patterns').toContain('js');
    expect(glob, 'STAMP FILE never precached').not.toMatch(/json/);
    const sw = code(read('src/sw.ts'));
    expect(sw, 'STAMP FILE no runtime cache to keep an old stamp').not.toMatch(/registerRoute\((?!new NavigationRoute)/);
  });
});

describe('⭐ where it shows', () => {
  it('⭐ PLACES — the card on the home, never in the owner\'s preview; the row in the owner\'s About and the viewer\'s Settings', () => {
    const home = code(read('src/components/Viewer/ViewerHomeView.tsx'));
    expect(home.match(/<UpdateCard \/>/g), 'PLACES the card once').toHaveLength(1);
    expect(home, 'PLACES never in the preview').toContain('{!preview && <UpdateCard />}');
    const settings = code(read('src/components/Settings/SettingsMain.tsx'));
    expect(settings.match(/<UpdateCheck \/>/g), 'PLACES the owner\'s About').toHaveLength(1);
    expect(settings, 'PLACES under the build line').toMatch(/Build \{__BUILD_SHA__\}[^<]*<\/p>\s*<UpdateCheck \/>/);
    const about = settings.slice(settings.indexOf("settingsPage === 'about'"));
    expect(about.indexOf('<UpdateCheck />'), 'PLACES on the About page').toBeGreaterThan(0);
    expect(code(read('src/components/Settings/ViewerSettings.tsx')).match(/<UpdateCheck inRow \/>/g), 'PLACES the viewer\'s Settings').toHaveLength(1);
    expect(naming(/<Update(Card|Check)\b/), 'PLACES nowhere else').toEqual([
      'src/components/Settings/SettingsMain.tsx', 'src/components/Settings/ViewerSettings.tsx', 'src/components/Viewer/ViewerHomeView.tsx',
    ]);
  });

  it('⭐ NO STORE — the session\'s state lives in the module: no store field, nothing saved, nothing synced', () => {
    for (const f of [MOD, 'src/hooks/useAppUpdate.ts', CARD, CHECK]) {
      const c = code(read(f));
      expect(c, `NO STORE ${f}`).not.toMatch(/store\/|useStore|localStorage|sessionStorage|indexedDB/);
    }
  });
});
