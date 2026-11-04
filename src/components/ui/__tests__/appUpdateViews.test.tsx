import { describe, it, expect, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateCard } from '../UpdateCard';
import { UpdateCheck } from '../../Settings/UpdateCheck';
import {
  applyUpdate, checkForUpdate, getUpdateState, ownStamp, resetUpdateStateForTests, UPDATE_WORDS, type UpdateStatus,
} from '../../../lib/appUpdate';

/**
 * ⚠ BL51 — app updates (spec `pbloc-spec-app-updates-v1`): the home's card and Settings → About's row, rendered to static
 * markup in each of the session's seven states (the repo has no DOM harness). Each state is reached through the module
 * itself — a check against a fake `fetch`, a tap against a fake registration — never set by hand. The tap's own wiring
 * (a button's handler, nothing else) is appUpdateWiring.test.ts's; the card in a browser, e2e/appUpdate.spec.ts's.
 * Each assertion carries its tag.
 */

const stamp = (body: { sha: string; time: string }) => (async () => ({
  ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => body,
})) as unknown as typeof fetch;
const never = (() => new Promise(() => {})) as unknown as typeof fetch;
const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;

/** Puts the session in `status` the way the app gets there. */
async function reach(status: UpdateStatus): Promise<void> {
  resetUpdateStateForTests();
  if (status === 'checking') void checkForUpdate(never);
  if (status === 'current') await checkForUpdate(stamp(ownStamp()));
  if (status === 'available') await checkForUpdate(stamp({ sha: `${__BUILD_SHA__}x`, time: __BUILD_TIME__ }));
  if (status === 'unknown') await checkForUpdate(offline);
  if (status === 'updating') {
    void applyUpdate({ getRegistration: () => new Promise(() => {}), watch: () => {}, reload: () => {}, later: () => {} });
  }
  if (status === 'failed') {
    await applyUpdate({
      getRegistration: async () => ({ installing: null, waiting: null, update: async () => { throw new TypeError('offline'); } }) as unknown as ServiceWorkerRegistration,
      watch: () => {}, reload: () => {}, later: () => {},
    });
  }
  expect(getUpdateState().status, `premise: ${status}`).toBe(status);
}
const ALL: UpdateStatus[] = ['idle', 'checking', 'current', 'available', 'unknown', 'updating', 'failed'];
const text = (html: string) => html.replace(/<[^>]+>/g, '|').split('|').filter(Boolean);
const button = (html: string) => {
  const m = html.match(/<button([^>]*)>([^<]*)<\/button>/);
  return m ? { label: m[2], disabled: /\sdisabled=""/.test(m[1]) } : null;
};

beforeEach(() => resetUpdateStateForTests());

describe('⭐ the home\'s card', () => {
  it('⭐ CARD — only when another build is live: "New version ready" and one button; nothing before, while checking or when current', async () => {
    for (const status of ALL) {
      await reach(status);
      const html = renderToStaticMarkup(<UpdateCard />);
      if (status === 'available') {
        expect(text(html), 'CARD ready').toEqual([UPDATE_WORDS.ready, UPDATE_WORDS.update]);
        expect(button(html), 'CARD the tap').toEqual({ label: UPDATE_WORDS.update, disabled: false });
        expect(html, 'CARD announced').toContain('role="status"');
      } else if (status === 'updating') {
        expect(text(html), 'CARD updating').toEqual([UPDATE_WORDS.ready, UPDATE_WORDS.updating]);
        expect(button(html), 'CARD one tap at a time').toEqual({ label: UPDATE_WORDS.updating, disabled: true });
      } else if (status === 'failed') {
        expect(text(html), 'CARD failed').toEqual([UPDATE_WORDS.failed, UPDATE_WORDS.tryAgain]);
        expect(button(html), 'CARD try again').toEqual({ label: UPDATE_WORDS.tryAgain, disabled: false });
      } else {
        expect(html, `CARD none when ${status}`).toBe('');
      }
    }
  });

  it('⭐ CARD — the words', () => {
    expect(UPDATE_WORDS).toEqual({
      ready: 'New version ready', update: 'Update', updating: 'Updating…', tryAgain: 'Try again',
      check: 'Check for updates', checking: 'Checking…', current: 'You’re on the latest version',
      unknown: 'Couldn’t check — check your connection', failed: 'Couldn’t update — check your connection',
    });
  });
});

describe('⭐ Settings → About', () => {
  it('⭐ ABOUT — "Updates": a check on demand; another build live → "Update" ("Try again" after a failed tap); a line for every state but the first', async () => {
    const want: Record<UpdateStatus, { label: string; disabled: boolean; line: string | null }> = {
      idle: { label: UPDATE_WORDS.check, disabled: false, line: null },
      checking: { label: UPDATE_WORDS.check, disabled: true, line: UPDATE_WORDS.checking },
      current: { label: UPDATE_WORDS.check, disabled: false, line: UPDATE_WORDS.current },
      available: { label: UPDATE_WORDS.update, disabled: false, line: UPDATE_WORDS.ready },
      unknown: { label: UPDATE_WORDS.check, disabled: false, line: UPDATE_WORDS.unknown },
      updating: { label: UPDATE_WORDS.check, disabled: true, line: UPDATE_WORDS.updating },
      failed: { label: UPDATE_WORDS.tryAgain, disabled: false, line: UPDATE_WORDS.failed },
    };
    for (const status of ALL) {
      await reach(status);
      const html = renderToStaticMarkup(<UpdateCheck />);
      const w = want[status];
      expect(button(html), `ABOUT ${status}: the button`).toEqual({ label: w.label, disabled: w.disabled });
      expect(text(html), `ABOUT ${status}: the words`).toEqual(['Updates', w.label, ...(w.line ? [w.line] : [])]);
    }
  });

  it('⭐ ABOUT — a viewer\'s Settings sets it in its own row (inRow); the owner\'s, under the build line', () => {
    const own = renderToStaticMarkup(<UpdateCheck />);
    const row = renderToStaticMarkup(<UpdateCheck inRow />);
    expect(text(row), 'ABOUT the same words').toEqual(text(own));
    expect(row, 'ABOUT a second class in a row').not.toBe(own);
  });
});
