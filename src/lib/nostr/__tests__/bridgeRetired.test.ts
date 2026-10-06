import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Phase 4e — the settings:v1 bridge retired. Its own file: the RELAY layer is mocked (every relay ACKs), so the CHAIN
// case sees every event any publish path signs and sends — including one routed inside publish.ts, which a mock of
// publish.ts's exports can't see (the bridge itself went that way: publishSettings → publish.ts's own publishEncrypted).
// Invariants 1, 3 and 5 of the 4e spec; the seed discipline (every publish would SUCCEED, so only the guard can stop
// it); and the retry predicate the bridge's dirty flag used to arm.
const { relayPublish } = vi.hoisted(() => ({ relayPublish: vi.fn() }));

vi.mock('nostr-tools/pool', () => ({
  SimplePool: vi.fn(function () {
    return {
      publish: (relays: string[], event: unknown) => { relayPublish(event); return relays.map(() => Promise.resolve('ok')); },
      close:   vi.fn(),
    };
  }),
}));

import { useStore } from '../../../store/useStore';
import { publishPlanEventsNow, publishPrefsNow, getPlanParity, checkPlanParity } from '../syncEngine';
import { syncDirty } from '../../../hooks/useNostrSync';
import { viewerDTag } from '../publish';

const SRC = join(__dirname, '..', '..', '..');
const flush = () => new Promise((r) => setTimeout(r, 0));
const sentDTags = () => relayPublish.mock.calls.map(([e]) => (e as { tags: string[][] }).tags.find(([t]) => t === 'd')?.[1]);
// a signer that works — every publish path signs with it, so whatever reaches the relays is in sentDTags()
const signer = {
  nip44:     { encrypt: async () => 'ciphertext' },
  signEvent: async (e: object) => ({ ...e, id: 'id', sig: 'sig', pubkey: 'ownerpk' }),
};
const codeOf = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

describe('4e — the bridge is retired', () => {
  it('RETIRED — no app code names the channel or any piece of its machinery (comments may tell the history)', () => {
    const banned = /settings:v1|SETTINGS_DTAG|publishSettings|scheduleSettingsPublish|syncSettingsToNostr|[sS]ettingsDirty|[lL]astSettingsSyncAt|[lL]astV1FallbackApplyAt|hydrateSettings|synthesizeGenesisEvents|pickPlanFields|sawSettingsV1|sawPlanEvents/;
    const hits = walk(SRC).filter((f) => banned.test(codeOf(readFileSync(f, 'utf8'))))
      .map((f) => relative(SRC, f));
    // persistConfig names the three retired keys ON PURPOSE — partializeState drops a pre-4e blob's copies.
    expect(hits, 'RETIRED').toEqual(['store/persistConfig.ts']);
  });

  beforeEach(() => {
    relayPublish.mockClear();
    useStore.setState({
      isAuthenticated: true, nostrSigner: signer as never, nostrPubkey: 'ownerpk', nostrSigningMethod: 'local',
      keyProvenance: 'imported', viewerMode: false, initialSettingsPullDone: true, nostrRelays: ['wss://r'],
      viewers: [{ index: 0, pubkeyHex: 'v'.repeat(64), npub: 'npub1v', label: 'V0', tier: 'trusted', keyVersion: 1 }],
      nextViewerIndex: 1, pendingViewerRevocations: ['x'.repeat(64)], planEvents: [], planDirty: false, prefsDirty: false,
    } as never);
  });

  it('CHAIN — a plan publish fans out the viewer snapshots and flushes the revocations, and publishes no settings:v1', async () => {
    useStore.getState().setIncome(5150);   // one plan edit → planDirty
    // plant a stale DIVERGED reading, then agree again: only a parity call inside THIS publish can turn it OK
    useStore.setState({ income: 1 } as never);
    expect(checkPlanParity().ok, 'CHAIN parity premise').toBe(false);
    useStore.setState({ income: 5150 } as never);
    expect(await publishPlanEventsNow(), 'CHAIN plan ok').toBe(true);
    await flush(); await flush();
    const dTags = sentDTags();
    expect(dTags.filter((t) => !t?.startsWith('personal-bloc:viewer:')), 'CHAIN only the plan channel')
      .toEqual(['personal-bloc:plan-events:v1']);
    expect(dTags, 'CHAIN fan-out').toContain(viewerDTag('v'.repeat(64)));
    expect(dTags, 'CHAIN revocation').toContain(viewerDTag('x'.repeat(64)));
    expect(useStore.getState().pendingViewerRevocations, 'CHAIN revocation cleared').toEqual([]);
    expect(getPlanParity(), 'CHAIN parity').toEqual({ ok: true, diverged: [] });
  });

  it('SEED — a fresh device publishes nothing before its first pull (the discipline the guards backed up)', async () => {
    useStore.setState({ initialSettingsPullDone: false } as never);
    useStore.getState().setIncome(1);   // a pre-pull edit accumulates locally
    useStore.getState().setSimpleMode(true);   // and a pre-pull pref
    expect(await publishPlanEventsNow(), 'SEED plan').toBe(false);
    expect(await publishPrefsNow(), 'SEED prefs').toBe(false);
    await flush();
    // every relay would ACK, so only the guard can make these false — the premise, asserted at the relay layer
    expect(relayPublish, 'SEED nothing reached a relay').not.toHaveBeenCalled();
    expect(useStore.getState().planDirty, 'SEED stays dirty for after the pull').toBe(true);
    expect(useStore.getState().prefsDirty, 'SEED stays dirty for after the pull').toBe(true);
  });

  it('RETRY — any unpublished channel or a pending revocation arms the retry; nothing else does', () => {
    const base = { recordsDirty: false, planDirty: false, prefsDirty: false, pendingRevocations: 0 };
    expect(syncDirty(base), 'RETRY idle').toBe(false);
    expect(syncDirty({ ...base, recordsDirty: true }), 'RETRY records').toBe(true);
    expect(syncDirty({ ...base, planDirty: true }), 'RETRY plan').toBe(true);
    expect(syncDirty({ ...base, prefsDirty: true }), 'RETRY prefs').toBe(true);
    expect(syncDirty({ ...base, pendingRevocations: 1 }), 'RETRY revocations').toBe(true);
    // the hook arms with this predicate, fed by the three flags it subscribes to
    const hook = codeOf(readFileSync(join(SRC, 'hooks', 'useNostrSync.ts'), 'utf8'));
    expect(hook, 'RETRY wired').toMatch(/dirty: syncDirty\(\{ recordsDirty, planDirty, prefsDirty, pendingRevocations: pendingViewerRevocations\.length \}\)/);
    expect(hook, 'RETRY wired').toMatch(/\[recordsDirty, planDirty, prefsDirty, pendingViewerRevocations\.length,/);
    expect(hook, 'RETRY waits for the unlock').toMatch(/backupGateOk, authenticated: isAuthenticated \}/);
  });

  it('PLAN SYNCED — Settings → SYNC reads the plan channel clock, under its own label', () => {
    const ui = codeOf(readFileSync(join(SRC, 'components', 'Settings', 'SettingsMain.tsx'), 'utf8'));
    expect(ui, 'PLAN SYNCED').toMatch(/>Plan synced<\/span><span className=\{styles\.syncRowValue\}>\{relativeSync\(lastPlanEventsSyncAt\)\}/);
    expect(ui, 'PLAN SYNCED').not.toMatch(/Settings synced/);
  });
});
