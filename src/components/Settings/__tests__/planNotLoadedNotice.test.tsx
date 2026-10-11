// 5c (spec `pbloc-spec-plan-load-guard-v1`) — Settings › SYNC: the plan hasn't loaded on this device — why, and what that
// means — in plain words; after a pull that found nothing at all, the one way out a person decides ("Start a new plan");
// nothing once the plan is loaded, or before a pull has settled why.
import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PlanPull } from '../../../lib/nostr/planLoad';

const h = vi.hoisted(() => ({ missing: true, gated: false, pull: { status: 'pending' } as PlanPull }));
vi.mock('../../../hooks/usePlanLoad', async (importActual) => {
  const actual = await importActual<typeof import('../../../hooks/usePlanLoad')>();
  return {
    ...actual,
    usePlanMissing: () => h.missing,
    usePlanPull: () => h.pull,
    usePlanNotLoadedWhy: () => actual.planNotLoadedWhy(h.pull, h.gated),
  };
});

import { PlanNotLoadedNotice } from '../PlanNotLoadedNotice';
import { planNotLoadedWhy, START_NEW_PLAN_LABEL } from '../../../hooks/usePlanLoad';

const at = 1;
const render = (missing: boolean, pull: PlanPull, gated = false) => {
  h.missing = missing; h.pull = pull; h.gated = gated;
  return renderToStaticMarkup(<PlanNotLoadedNotice />);
};

describe('5c — Settings › SYNC: the plan hasn\'t loaded here', () => {
  it('⭐ NOTICE — says it, says why, says nothing is lost; never "Reconnect", and no way to start a new plan', () => {
    const html = render(true, { status: 'unreadable', at, reason: 'decrypt' });
    expect(html).toContain('Your plan hasn’t loaded on this device');
    expect(html).toContain('This device’s signer couldn’t decrypt the plan saved on your relays.');
    expect(html).toContain('nothing is lost or overwritten');
    expect(html).not.toContain('Reconnect');
    expect(html).not.toContain(START_NEW_PLAN_LABEL);
  });

  it('⭐ NONE — the relays answered with nothing: the owner is told both readings, and offered "Start a new plan"', () => {
    const html = render(true, { status: 'none', at });
    expect(html).toContain('Your relays answered, but hold no plan for this key.');
    expect(html).toContain('If this key is new, start your plan here. If you expected your plan, don’t');
    expect(html).toContain(`>${START_NEW_PLAN_LABEL}</button>`);
  });

  it('nothing while a pull hasn\'t settled why, and nothing once the plan is loaded', () => {
    expect(render(true, { status: 'pending' })).toBe('');
    expect(render(false, { status: 'unreadable', at, reason: 'parse' })).toBe('');
    expect(render(false, { status: 'none', at })).toBe('');
    expect(render(false, { status: 'applied', at, plainBytes: 100 })).toBe('');
  });

  it('every reason has its words — and a key waiting on its backup is told so before any pull', () => {
    expect(planNotLoadedWhy({ status: 'unreadable', at, reason: 'parse' })).toBe('The plan saved on your relays couldn’t be read on this device.');
    expect(planNotLoadedWhy({ status: 'unreadable', at, reason: 'shape' })).toBe('The plan saved on your relays couldn’t be read on this device.');
    expect(planNotLoadedWhy({ status: 'unreadable', at, reason: 'apply' })).toBe('The plan saved on your relays couldn’t be read on this device.');
    expect(planNotLoadedWhy({ status: 'unreadable', at, reason: 'not-reached' })).toBe('The sync stopped before it could read your plan.');
    expect(planNotLoadedWhy({ status: 'unreadable', at, reason: 'absent' })).toBe('Your relays hold your journal but no plan — if none of your devices has it, restore a plan backup (Settings → Backup).');
    expect(planNotLoadedWhy({ status: 'unreachable', at })).toBe('Your relays couldn’t be reached to load your plan.');
    expect(planNotLoadedWhy({ status: 'none', at })).toBe('Your relays answered, but hold no plan for this key.');
    expect(planNotLoadedWhy({ status: 'applied', at, plainBytes: 1 })).toBeNull();
    expect(planNotLoadedWhy({ status: 'pending' })).toBeNull();
    expect(planNotLoadedWhy({ status: 'pending' }, true)).toBe('Back up your Recovery Key first — until then this device can’t load your plan.');
    expect(render(true, { status: 'pending' }, true)).toContain('Back up your Recovery Key first');
  });
});
