// 5c (spec `pbloc-spec-plan-load-guard-v1`) — "No plan found on this key" only when a relay answered with nothing and the
// device is waiting; never while the relays couldn't be reached, and never once the plan is loaded (a later pull applied
// it, or the owner started a new one). It no longer says "starting fresh": it offers "Start a new plan" and warns not to
// if a plan was expected. The store and the hooks are mocked: a selector over a plain object (renderToStaticMarkup reads
// zustand's initial state, not a test's setState). The entry fork's sign-in card is checked here too: it no longer
// promises a fresh start.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanPull } from '../../../lib/nostr/planLoad';

const h = vi.hoisted(() => ({
  state: { remotePlanFound: false as boolean | null, keyProvenance: 'external' as string | null, setRemotePlanFound: () => {} },
  pull: { status: 'pending' } as PlanPull,
  waiting: true,
}));
vi.mock('../../../store/useStore', () => ({ useStore: (sel: (s: typeof h.state) => unknown) => sel(h.state) }));
vi.mock('../../../hooks/usePlanLoad', async (importActual) => ({
  ...(await importActual<typeof import('../../../hooks/usePlanLoad')>()),
  usePlanPull: () => h.pull,
  usePlanMissing: () => h.waiting,
}));

import { NoPlanNotice } from '../NoPlanNotice';
import { ChoosePathView } from '../ChoosePathView';

const at = 1;
const render = (remotePlanFound: boolean | null, pull: PlanPull, waiting = true, keyProvenance: string | null = 'external') => {
  Object.assign(h.state, { remotePlanFound, keyProvenance });
  h.pull = pull;
  h.waiting = waiting;
  return renderToStaticMarkup(<NoPlanNotice />);
};

describe('5c — the no-plan notice believes only a relay that answered, and lets the owner decide', () => {
  it('⭐ NO-PLAN — a relay answered with nothing: no "starting fresh" — "Start a new plan", and don\'t if you expected one; the entry fork promises no fresh start either', () => {
    const html = render(false, { status: 'none', at });
    expect(html).toContain('No plan found on this key.');
    expect(html).toContain('if you expected one, it hasn’t loaded — don’t start a new one.');
    expect(html).toContain('>Start a new plan</button>');
    expect(html).not.toContain('starting fresh');
    // The sign-in card used to say "…we'll load your plan, or start fresh on your key" — priming exactly the wrong tap.
    const fork = renderToStaticMarkup(<ChoosePathView onStartNew={() => {}} onLogIn={() => {}} onConnectShared={() => {}} />);
    expect(fork).toContain('load your plan; if your key has none yet, you can start one');
    expect(fork).not.toContain('start fresh');
  });

  it('⭐ NO-PLAN unreachable — the same empty pull from relays that couldn\'t be reached says nothing here', () => {
    expect(render(false, { status: 'unreachable', at })).toBe('');
  });

  it('nothing once the plan is loaded — a later pull applied it, or the owner started a new one', () => {
    expect(render(false, { status: 'applied', at, plainBytes: 100 }, false)).toBe('');
    expect(render(false, { status: 'none', at }, false)).toBe('');
  });

  it('nothing while no pull has settled the plan\'s status', () => {
    expect(render(false, { status: 'pending' })).toBe('');
  });

  it('as before 5c: nothing when a plan was found, once dismissed, or for a key made here', () => {
    expect(render(true, { status: 'none', at })).toBe('');
    expect(render(null, { status: 'none', at })).toBe('');
    expect(render(false, { status: 'none', at }, true, 'generated')).toBe('');
  });
});
