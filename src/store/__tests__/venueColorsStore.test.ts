import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// BL15 (Customization; batch spec §2.4) — the venue colours on the REAL store, through the REAL prefs publish (its relay
// write captured) and the REAL receive path (`applyRemoteEvent`'s prefs:v1 branch → hydratePrefs). One more PREFS field
// beside the buying unit: no store version bump, no new channel. Two "devices" are two saved states of the one store.
// Every assertion carries its tag (SET, REFUSED, RULE, DEFAULT, RESET, UNCHANGED, HIDDEN, NEVER, ROUND TRIP, OLD WRITE,
// FRESH AFTER OLD, JUNK, NULL, LATER, LWW, BACKUP, VIEWERS, NO BUMP).
vi.hoisted(() => {
  const shim = () => {
    const mem = new Map<string, string>();
    return {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => { mem.clear(); },
    };
  };
  (globalThis as unknown as { localStorage: unknown }).localStorage = shim();
  (globalThis as unknown as { sessionStorage: unknown }).sessionStorage = shim();
});

const { sent } = vi.hoisted(() => ({ sent: [] as { dTag: string; json: string }[] }));
vi.mock('../../lib/nostr/publish', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../lib/nostr/publish')>();
  return {
    ...real,
    // The relay write, captured as the wire carries it: publishEncrypted's own JSON.stringify.
    publishEncrypted: vi.fn(async (_signer: unknown, _pk: string, dTag: string, data: unknown) => {
      sent.push({ dTag, json: JSON.stringify(data) });
      return 1_000 + sent.length;
    }),
  };
});

import { useStore } from '../useStore';
import type { StoreState } from '../types';
import { buildViewerSnapshotPayload } from '../payloads';
import { VALIDATE_WHITELIST, APPLY_FIELDS, VIEWER_SETTINGS_FIELDS, PREFS_FIELDS } from '../settingsFields';
import { applyRemoteEvent } from '../../lib/nostr/sync';
import { publishPrefsNow } from '../../lib/nostr/syncEngine';
import { PREFS_DTAG } from '../../lib/nostr/publish';
import { buildPlanBackup } from '../../lib/backup/exportPlan';
import { validatePlanBackup } from '../../lib/backup/validatePlanBackup';
import { CURRENT_STORE_VERSION } from '../../lib/storeVersion';
import {
  checkVenueColor, venuePaletteOf, applyVenueColors, DEFAULT_VENUE_COLORS, VENUES, type VenueColors,
} from '../../lib/venueColors';

const SKY = '#38bdf8';
const TEAL = '#2dd4bf';
const VIOLET = '#a78bfa';
const FRESH = useStore.getInitialState();
const signer = { nip44: { encrypt: vi.fn(), decrypt: vi.fn(async (_pk: string, ct: string) => ct) } };
const AUTHED = {
  isAuthenticated: true, nostrSigner: signer, nostrPubkey: 'pk', viewerMode: false, keyProvenance: null,
  backupVerifiedAt: null, initialSettingsPullDone: true, nostrSigningMethod: 'local',
} as unknown as Partial<StoreState>;

/** A fresh device, signed in and past its first pull. */
const boot = (extra: Partial<StoreState> = {}) => useStore.setState({ ...FRESH, ...AUTHED, ...extra } as StoreState, true);
const save = () => ({ ...useStore.getState() });
const resume = (st: StoreState) => useStore.setState(st, true);
const colors = () => useStore.getState().venueColors;
/** This device publishes its prefs (the real publishPrefsNow); returns the JSON the relay got. */
async function publish(): Promise<string> {
  expect(await publishPrefsNow(), 'premise: the prefs publish ran').toBe(true);
  const last = sent[sent.length - 1];
  expect(last.dTag, 'premise: on prefs:v1').toBe(PREFS_DTAG);
  return last.json;
}
/** This device receives a prefs:v1 event (the real receive path), newer than anything it has. */
let clock = 10_000;
async function receive(json: string): Promise<void> {
  clock += 10;
  const ev = { kind: 30078, created_at: clock, content: json, tags: [['d', PREFS_DTAG]], id: `prefs-${clock}` };
  expect(await applyRemoteEvent(signer as never, 'pk', ev as never, 1000), 'premise: the event applied').toBe(true);
}
/** An old build's prefs object: its four keys, never the colours. */
const oldPrefs = (tabOrder: string[]) => JSON.stringify({ tabOrder, hiddenTabs: [], simpleMode: true, btcBuyingUnit: 'sats' });

beforeEach(() => {
  vi.useFakeTimers();   // no debounced publish ever fires on its own
  sent.length = 0;
  boot();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('⭐ the setter — THE rule gates every write', () => {
  it('⭐ SET — a passing colour is written through the prefs channel', () => {
    expect(useStore.getState().setVenueColor('coinbase', SKY), 'SET returns true').toBe(true);
    expect(colors(), 'SET stored').toEqual({ coinbase: SKY });
    expect(useStore.getState().prefsDirty, 'SET the prefs channel is dirty').toBe(true);
    expect(useStore.getState().planEvents, 'SET no plan event').toEqual([]);
  });

  it('⭐ REFUSED — a refused or malformed colour writes nothing, dirties nothing', () => {
    for (const [v, c] of [['strike', '#0a5af0'], ['cold', '#646474'], ['coinbase', '#4ecb82'], ['cold', 'url(x)'], ['strike', '#fff']] as const) {
      expect(useStore.getState().setVenueColor(v, c), `REFUSED ${v} ${c}`).toBe(false);
    }
    expect(colors(), 'REFUSED nothing stored').toBeUndefined();
    expect(useStore.getState().prefsDirty, 'REFUSED nothing dirty').toBe(false);
  });

  it('⭐ RULE — the setter accepts exactly what the picker\'s rule passes (2,460 cases, a chosen palette)', () => {
    const P: VenueColors = { strike: VIOLET, cold: TEAL };
    let accepted = 0;
    let refused = 0;
    for (let i = 0; i < 4096; i += 5) {
      const c = `#${[(i >> 8) & 15, (i >> 4) & 15, i & 15].map((n) => (n * 17).toString(16).padStart(2, '0')).join('')}`;
      for (const v of VENUES) {
        boot({ venueColors: P });
        const want = checkVenueColor(v, c, venuePaletteOf(P)) === null;
        expect(useStore.getState().setVenueColor(v, c), `RULE ${v} ${c}`).toBe(want);
        if (!want) expect(colors(), `RULE ${v} ${c} unchanged`).toEqual(P);
        if (want) accepted++;
        else refused++;
      }
    }
    expect([accepted > 300, refused > 300], 'RULE both sides reached').toEqual([true, true]);
  });

  it('⭐ DEFAULT — a venue set back to its default drops its key; RESET writes {}', () => {
    useStore.getState().setVenueColor('coinbase', SKY);
    useStore.getState().setVenueColor('coinbase', DEFAULT_VENUE_COLORS.coinbase);
    expect(colors(), 'DEFAULT the key is gone').toEqual({});
    useStore.getState().setVenueColor('cold', TEAL);
    useStore.setState({ prefsDirty: false });
    useStore.getState().resetVenueColors();
    expect(colors(), 'RESET {}').toEqual({});
    expect(useStore.getState().prefsDirty, 'RESET dirty').toBe(true);
  });

  it('⭐ UNCHANGED — the colour a venue already wears writes nothing: a device that never chose stays that way', () => {
    for (const v of VENUES) expect(useStore.getState().setVenueColor(v, DEFAULT_VENUE_COLORS[v]), `UNCHANGED ${v}'s default taken`).toBe(true);
    expect(colors(), 'UNCHANGED still never chose').toBeUndefined();
    expect(useStore.getState().prefsDirty, 'UNCHANGED nothing dirty').toBe(false);
    useStore.getState().setVenueColor('coinbase', SKY);
    useStore.setState({ prefsDirty: false });
    expect(useStore.getState().setVenueColor('coinbase', SKY.toUpperCase()), 'UNCHANGED the same colour again').toBe(true);
    expect(useStore.getState().prefsDirty, 'UNCHANGED … writes nothing').toBe(false);
  });

  it('⭐ HIDDEN — a stored colour the rule hides (Strike in Coinbase\'s blue) goes with the next write, never revived', () => {
    boot({ venueColors: { strike: DEFAULT_VENUE_COLORS.coinbase } });
    expect(venuePaletteOf(colors()).strike, 'HIDDEN premise: Strike shows its white').toBe(DEFAULT_VENUE_COLORS.strike);
    expect(useStore.getState().setVenueColor('coinbase', TEAL), 'HIDDEN Coinbase moves to teal').toBe(true);
    expect(colors(), 'HIDDEN the hidden blue is gone').toEqual({ coinbase: TEAL });
    expect(venuePaletteOf(colors()).strike, 'HIDDEN Strike still in white').toBe(DEFAULT_VENUE_COLORS.strike);
  });
});

describe('⭐ the wire — what travels, and what a device does with it', () => {
  it('⭐ NEVER — a device that never chose sends no colours anywhere; one that chose the defaults sends {}', async () => {
    const json = await publish();
    expect(JSON.parse(json), 'NEVER the prefs object').not.toHaveProperty('venueColors');
    expect(Object.keys(JSON.parse(json)).sort(), 'NEVER the other four keys travel').toEqual(['btcBuyingUnit', 'hiddenTabs', 'simpleMode', 'tabOrder']);
    const s = useStore.getState();
    expect(JSON.stringify(buildPlanBackup(s)), 'NEVER the backup').not.toContain('venueColors');
    expect(JSON.stringify(buildViewerSnapshotPayload(s, 'trusted')), 'NEVER the trusted snapshot').not.toContain('venueColors');
    useStore.getState().resetVenueColors();
    expect(JSON.parse(await publish()).venueColors, 'NEVER — the defaults, chosen, travel as {}').toEqual({});
  });

  it('⭐ ROUND TRIP — two new devices: each one\'s choice reaches the other, the defaults too', async () => {
    useStore.getState().setVenueColor('coinbase', SKY);
    useStore.getState().setVenueColor('cold', TEAL);
    const a = save();
    const fromA = await publish();
    boot();
    await receive(fromA);
    expect(colors(), 'ROUND TRIP B wears A\'s').toEqual({ coinbase: SKY, cold: TEAL });
    useStore.getState().setVenueColor('strike', VIOLET);
    const fromB = await publish();
    const b = save();
    resume(a);
    await receive(fromB);
    expect(colors(), 'ROUND TRIP A wears B\'s change').toEqual({ coinbase: SKY, cold: TEAL, strike: VIOLET });
    useStore.getState().resetVenueColors();
    const reset = await publish();
    resume(b);
    await receive(reset);
    expect(colors(), 'ROUND TRIP the reset reaches B').toEqual({});
  });

  it('⭐ OLD WRITE — an old build\'s prefs (no colours) change its four keys and leave the colours', async () => {
    useStore.getState().setVenueColor('coinbase', SKY);
    await receive(oldPrefs(['bloc', 'living']));
    expect(colors(), 'OLD WRITE colours kept').toEqual({ coinbase: SKY });
    expect(useStore.getState().tabOrder, 'OLD WRITE premise: the old object applied').toEqual(['bloc', 'living']);
    expect(useStore.getState().btcBuyingUnit, 'OLD WRITE premise: every old key').toBe('sats');
  });

  it('⭐ FRESH AFTER OLD — a new device that joined after an old write never resets the colours it never had', async () => {
    useStore.getState().setVenueColor('coinbase', SKY);
    const a = save();
    boot();
    await receive(oldPrefs(['bloc', 'living']));   // the relay's latest came from an old build
    expect(colors(), 'FRESH AFTER OLD premise: C has none').toBeUndefined();
    useStore.getState().setSimpleMode(false);      // C changes another pref and publishes
    const fromC = await publish();
    expect(JSON.parse(fromC), 'FRESH AFTER OLD C sends no colours').not.toHaveProperty('venueColors');
    resume(a);
    await receive(fromC);
    expect(colors(), 'FRESH AFTER OLD A keeps its colours').toEqual({ coinbase: SKY });
    expect(useStore.getState().simpleMode, 'FRESH AFTER OLD premise: C\'s change applied').toBe(false);
  });

  it('⭐ JUNK — a malformed value lands as the apply finds it, but never reaches CSS, and the next pick starts clean', async () => {
    await receive(JSON.stringify({ venueColors: { coinbase: 'url(https://x.example/t)', ghost: '#123456', cold: '#2DD4BF' } }));
    expect(colors(), 'JUNK premise: a plain object lands as it is').toEqual({ coinbase: 'url(https://x.example/t)', ghost: '#123456', cold: '#2DD4BF' });
    const props = new Map<string, string>();
    applyVenueColors({ setProperty: (k: string, v: string | null) => { props.set(k, String(v)); }, removeProperty: (k: string) => { props.delete(k); return ''; } }, colors());
    expect([...props], 'JUNK only the well-formed colour reaches CSS').toEqual([['--venue-cold', TEAL]]);
    expect(useStore.getState().setVenueColor('strike', VIOLET), 'JUNK a pick still works').toBe(true);
    expect(colors(), 'JUNK the stored value is cleaned').toEqual({ cold: TEAL, strike: VIOLET });
  });

  it('⭐ NULL — a prefs object with null colours (a hand-made event) reads as one without them', async () => {
    boot({ venueColors: { coinbase: SKY } });
    await receive(JSON.stringify({ tabOrder: ['bloc', 'living'], venueColors: null }));
    expect(colors(), 'NULL the colours stay').toEqual({ coinbase: SKY });
    expect(useStore.getState().tabOrder, 'NULL premise: the object applied').toEqual(['bloc', 'living']);
  });

  it('⭐ LATER — colours this build can\'t read (a later version\'s) land as they are, show the defaults, and travel on untouched', async () => {
    const later = { coinbase: '#38bdf8ff', ghost: '#123456' };
    await receive(JSON.stringify({ tabOrder: ['bloc', 'living'], venueColors: later }));
    expect(colors(), 'LATER as it came').toEqual(later);
    expect(venuePaletteOf(colors()), 'LATER the defaults show').toEqual(DEFAULT_VENUE_COLORS);
    expect(JSON.parse(await publish()).venueColors, 'LATER … and go out as they came, never as {}').toEqual(later);
  });

  it('⭐ LWW — the limit: after an old build\'s write, a device that never had the colours starts without them, and its pick\'s palette wins whole — as the tabs', async () => {
    useStore.getState().setVenueColor('coinbase', SKY);
    const a = save();
    boot();
    await receive(oldPrefs(['bloc', 'living']));   // the relays' latest came from an old build
    expect(colors(), 'LWW premise: C has none').toBeUndefined();
    useStore.getState().setVenueColor('strike', VIOLET);
    const fromC = await publish();
    resume(a);
    await receive(fromC);
    expect(colors(), 'LWW A wears C\'s whole palette').toEqual({ strike: VIOLET });
  });
});

describe('⭐ backups, viewers, and the formats', () => {
  it('⭐ BACKUP — the colours restore; a backup from before them leaves a device\'s colours as they are', () => {
    expect([VALIDATE_WHITELIST.has('venueColors'), APPLY_FIELDS.has('venueColors')], 'BACKUP the whitelist takes the key').toEqual([true, true]);
    useStore.getState().setVenueColor('cold', TEAL);
    const file = JSON.parse(JSON.stringify(buildPlanBackup(useStore.getState())));
    const ok = validatePlanBackup(file);
    expect(ok.ok, 'BACKUP validates').toBe(true);
    boot();
    if (ok.ok) useStore.getState().applyPlanBackup(ok.backup);
    expect(colors(), 'BACKUP restored on a new device').toEqual({ cold: TEAL });
    expect(useStore.getState().prefsDirty, 'BACKUP the restore publishes the prefs').toBe(true);
    const before = { ...file, plan: { ...file.plan, settings: { ...file.plan.settings } } };
    delete before.plan.settings.venueColors;
    boot({ venueColors: { coinbase: SKY } });
    const old = validatePlanBackup(before);
    expect(old.ok, 'BACKUP an old file validates').toBe(true);
    if (old.ok) useStore.getState().applyPlanBackup(old.backup);
    expect(useStore.getState().income, 'BACKUP premise: the old file applied').toBe(file.plan.settings.income);
    expect(colors(), 'BACKUP an old file leaves the colours').toEqual({ coinbase: SKY });
    const nul = { ...file, plan: { ...file.plan, settings: { ...file.plan.settings, venueColors: null } } };
    boot({ venueColors: { coinbase: SKY } });
    const n = validatePlanBackup(nul);
    expect(n.ok, 'BACKUP premise: a null validates (the validator checks keys)').toBe(true);
    if (n.ok) useStore.getState().applyPlanBackup(n.backup);
    expect(colors(), 'BACKUP a null leaves the colours').toEqual({ coinbase: SKY });
  });

  it('⭐ VIEWERS — a trusted viewer wears the owner\'s colours; the safe snapshot never carries them', () => {
    expect(VIEWER_SETTINGS_FIELDS, 'VIEWERS exposed to a trusted viewer').toContain('venueColors');
    useStore.getState().setVenueColor('coinbase', SKY);
    const owner = useStore.getState();
    const trusted = JSON.parse(JSON.stringify(buildViewerSnapshotPayload(owner, 'trusted')));
    const safe = JSON.stringify(buildViewerSnapshotPayload(owner, 'safe'));
    expect(safe, 'VIEWERS the safe snapshot: no key').not.toContain('venueColors');
    expect(safe, 'VIEWERS the safe snapshot: no colour').not.toContain(SKY);
    boot({ viewerMode: true });
    useStore.getState().applyViewerSettings(trusted.settings);
    expect(colors(), 'VIEWERS the trusted viewer wears them').toEqual({ coinbase: SKY });
    useStore.getState().applyViewerSettings({ ...trusted.settings, venueColors: null });
    expect(colors(), 'VIEWERS a null leaves them').toEqual({ coinbase: SKY });
  });

  it('⭐ NO BUMP — the store version stays 21; the colours ride prefs:v1, the one prefs channel', () => {
    expect(CURRENT_STORE_VERSION, 'NO BUMP the store version').toBe(21);
    expect(PREFS_FIELDS, 'NO BUMP a pref').toContain('venueColors');
    expect(PREFS_DTAG, 'NO BUMP the channel').toBe('personal-bloc:prefs:v1');
  });
});
