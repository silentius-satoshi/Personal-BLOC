import { describe, it, expect } from 'vitest';
// 5a — the plan log's size (spec `pbloc-spec-plan-log-size-v1`). Node; pure; no store import. The compaction's two new
// rules — a burst of one field's edits keeps its last event; the history is trimmed, oldest first, to a byte budget —
// and the merge-safety they must keep: the fold never changes, the latest per field always stays, devices converge.
// Every ⭐ is proven red by a named mutation (the spec's Appendix P). Round synthetic figures only — this repo is public.
import { compactPlanEvents, BURST_WINDOW_MS, PLAN_LOG_BUDGET_BYTES } from '../compact';
import { foldPlanEvents, unionPlanEvents } from '../fold';
import type { PlanEvent, PlanField } from '../types';

const NOW = 1_800_000_000_000;
const SEC = 1000;
const DAY = 24 * 60 * 60 * SEC;
const W = BURST_WINDOW_MS;
// What the publish sends — `{"events":[…]}`, the log plus 11 bytes. The budget is on this.
const payload = (log: PlanEvent[]) => new TextEncoder().encode(JSON.stringify({ events: log })).length;
const bytes = (log: PlanEvent[]) => new TextEncoder().encode(JSON.stringify(log)).length;   // the bare log
const ids = (log: PlanEvent[]) => log.map((e) => e.id);

let seq = 0;
const ev = (field: string, ts: number, value: unknown, device = 'phone'): PlanEvent =>
  ({ id: `${field}-${ts}-${(seq++).toString(16).padStart(4, '0')}`, ts, device, kind: 'set', field: field as PlanField, value });

// A drag across a slider: one event per notch, `every` ms apart (Living's income slider gave 173 in 3 s).
const drag = (field: string, start: number, notches: number, every: number, from = 0, step = 500): PlanEvent[] =>
  Array.from({ length: notches }, (_, i) => ev(field, start + i * every, from + i * step));

describe('5a — a burst of edits to one field keeps its last event', () => {
  it('⭐ BURST — a 173-notch drag compacts to its last notch; the edits before and after it stay', () => {
    const before = ev('income', NOW - 2 * DAY, 4000);
    const dragged = drag('income', NOW - DAY, 173, 17);
    const after = ev('income', NOW - DAY + 173 * 17 + W + 1, 9000);
    const out = compactPlanEvents([before, ...dragged, after], NOW);
    expect(ids(out), 'BURST').toEqual(ids([before, dragged[172], after]));
    // the premise: without the burst rule all 175 are history under 90 days
    expect(dragged.every((e) => e.ts >= NOW - 90 * DAY), 'BURST premise').toBe(true);
  });

  it('⭐ BURST edge — a gap of exactly the window is a burst; one ms more is two edits', () => {
    const a = ev('expenses', NOW - DAY, 3000);
    const b = ev('expenses', NOW - DAY + W, 3100);
    expect(ids(compactPlanEvents([a, b], NOW)), 'BURST edge W').toEqual(ids([b]));
    const c = ev('expenses', NOW - DAY + W + 1, 3200);
    expect(ids(compactPlanEvents([a, c], NOW)), 'BURST edge W+1').toEqual(ids([a, c]));
  });

  it('⭐ BURST per field — another field\'s events in between never shield or drop it', () => {
    const inc = drag('income', NOW - DAY, 20, 50);
    const exp = drag('expenses', NOW - DAY + 5, 20, 50);
    const out = compactPlanEvents([...inc, ...exp], NOW);
    expect(ids(out), 'BURST per field').toEqual(ids([inc[19], exp[19]]));
  });

  it('⭐ BURST device-blind — `device` is never a merge input: a second device within the window ends the first one\'s burst', () => {
    const a = ev('creditLine', NOW - DAY, 40_000, 'phone');
    const b = ev('creditLine', NOW - DAY + 2 * SEC, 50_000, 'laptop');
    expect(ids(compactPlanEvents([a, b], NOW)), 'BURST device-blind').toEqual(ids([b]));
  });

  it('⭐ BURST pairs — a dragged AsOf pair keeps one event per field, at the same ts (it never tears)', () => {
    const pairs = Array.from({ length: 30 }, (_, i) => {
      const ts = NOW - DAY + i * 20;
      return [ev('cbLoanBalance', ts, 50_000 + i * 100), ev('cbLoanBalanceAsOf', ts, '2026-10-01')];
    }).flat();
    const out = compactPlanEvents(pairs, NOW);
    expect(out.map((e) => e.field).sort(), 'BURST pairs fields').toEqual(['cbLoanBalance', 'cbLoanBalanceAsOf']);
    expect(out[0].ts, 'BURST pairs same ts').toBe(out[1].ts);
    expect(foldPlanEvents(out), 'BURST pairs fold').toEqual(foldPlanEvents(pairs));
  });

  it('⭐ BURST ties — two events for one field at the same ts keep the (ts, id) winner only', () => {
    const lo = { ...ev('blocApr', NOW - DAY, 12), id: 'blocApr-tie-a' };
    const hi = { ...ev('blocApr', NOW - DAY, 13), id: 'blocApr-tie-b' };
    const out = compactPlanEvents([hi, lo], NOW);
    expect(ids(out), 'BURST ties').toEqual(['blocApr-tie-b']);
    expect(foldPlanEvents(out), 'BURST ties fold').toEqual({ blocApr: 13 });
  });

  it('the 90-day rule still holds beside it — history older than 90 days goes, the latest stays forever', () => {
    const old = ev('income', NOW - 100 * DAY, 1000);
    const mid = ev('income', NOW - 30 * DAY, 2000);
    const latest = ev('income', NOW - DAY, 3000);
    const ancient = ev('expenses', NOW - 400 * DAY, 500);
    expect(ids(compactPlanEvents([old, mid, latest, ancient], NOW)).sort(), '90 DAYS').toEqual(ids([mid, latest, ancient]).sort());
  });
});

describe('5a — the history is trimmed, oldest first, to the budget', () => {
  // 600 deliberate edits, a minute apart (no bursts), spread over a few fields, 30 days old at most.
  const fields = ['income', 'expenses', 'blocApr', 'creditLine'];
  const history = Array.from({ length: 600 }, (_, i) => ev(fields[i % 4], NOW - 30 * DAY + i * 60 * SEC, 1000 + i));

  it('⭐ BUDGET — over the budget, the log is trimmed to fit, oldest first, and every field keeps its latest', () => {
    expect(payload(history), 'BUDGET premise: over the budget').toBeGreaterThan(PLAN_LOG_BUDGET_BYTES);
    const out = compactPlanEvents(history, NOW);
    expect(payload(out), 'BUDGET fits — the payload, wrapper and all').toBeLessThanOrEqual(PLAN_LOG_BUDGET_BYTES);
    // oldest first: what remains is the newest stretch of the history, unbroken
    const kept = new Set(ids(out));
    const firstKept = history.findIndex((e) => kept.has(e.id));
    expect(firstKept, 'BUDGET trimmed some').toBeGreaterThan(0);
    expect(history.slice(firstKept).every((e) => kept.has(e.id)), 'BUDGET oldest first').toBe(true);
    for (const f of fields) {
      const latest = history.filter((e) => e.field === f).at(-1)!;
      expect(kept.has(latest.id), `BUDGET keeps the latest ${f}`).toBe(true);
    }
    // and it is no tighter than it needs to be: one more event back would not fit
    const back = history[firstKept - 1];
    expect(payload([back, ...out]), 'BUDGET no tighter').toBeGreaterThan(PLAN_LOG_BUDGET_BYTES);
  });

  it('⭐ BUDGET latest-only — when the latests alone exceed it, every latest stays and all history goes', () => {
    const big = (n: number) => Array.from({ length: n }, (_, i) => ({ index: i, label: `viewer ${i}`, pubkey: 'f'.repeat(64) }));
    const log = [
      ev('viewers', NOW - 3 * DAY, big(320)),   // a large superseded roster
      ev('viewers', NOW - 2 * DAY, big(340)),   // the latest roster alone is over the budget
      ev('income', NOW - 2 * DAY + 60 * SEC, 1000),
      ev('income', NOW - DAY, 2000),
    ];
    expect(payload([log[1]]), 'BUDGET latest-only premise').toBeGreaterThan(PLAN_LOG_BUDGET_BYTES);
    const out = compactPlanEvents(log, NOW);
    expect(ids(out), 'BUDGET latest-only').toEqual(ids([log[1], log[3]]));
  });

  it('under the budget, nothing is trimmed', () => {
    const small = history.slice(-40);
    expect(payload(small), 'BUDGET untouched premise').toBeLessThan(PLAN_LOG_BUDGET_BYTES);
    expect(ids(compactPlanEvents(small, NOW)), 'BUDGET untouched').toEqual(ids(small));
  });

  it('⭐ BUDGET wrapper — the budget counts the payload, not the bare log: 8 bytes under as a log, 3 over as a payload, loses its oldest edit', () => {
    // 250 deliberate edits a minute apart (no burst, under 90 days); the oldest is padded so the bare log is exactly
    // 32,760 B — the payload the publish sends, 11 bytes more, is 32,771 B.
    const log = Array.from({ length: 250 }, (_, i) => ev('expenses', NOW - 20 * DAY + i * 60 * SEC, 1000 + i));
    const digits = JSON.stringify(log[0].value).length;
    log[0] = { ...log[0], value: 'x'.repeat(32_760 - bytes(log) + digits - 2) };
    expect([bytes(log), payload(log)], 'BUDGET wrapper premise').toEqual([32_760, 32_771]);
    const out = compactPlanEvents(log, NOW);
    expect(payload(out), 'BUDGET wrapper fits').toBeLessThanOrEqual(PLAN_LOG_BUDGET_BYTES);
    expect(ids(out), 'BUDGET wrapper trims the oldest').toEqual(ids(log.slice(1)));
  });
});

// ── The sweeps: seeded random logs shaped like real use — drags, typed numbers, deliberate edits, AsOf pairs, roster
// arrays, same-ts ties, two devices, ages up to 200 days, and logs big enough to reach the budget. ──
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SWEEP_FIELDS = ['income', 'expenses', 'blocApr', 'creditLine', 'cbLoanBalance', 'viewers', 'nextViewerIndex'];

// `sessions` edit sessions over the last `spanDays`; a session is one edit, a few, or a drag (`dragShare` of them).
function randomLog(rng: () => number, sessions: number, spanDays: number, dragShare: number): PlanEvent[] {
  const log: PlanEvent[] = [];
  for (let s = 0; s < sessions; s++) {
    const field = SWEEP_FIELDS[Math.floor(rng() * SWEEP_FIELDS.length)];
    const device = rng() < 0.8 ? 'phone' : 'laptop';
    let ts = NOW - Math.floor(rng() * spanDays * DAY);
    const kind = rng();
    const n = kind < dragShare ? 20 + Math.floor(rng() * 160) : kind < dragShare + 0.3 ? 2 + Math.floor(rng() * 8) : 1;
    for (let i = 0; i < n; i++) {
      const value = field === 'viewers'
        ? Array.from({ length: 1 + Math.floor(rng() * 4) }, (_, k) => ({ index: k, label: `v${k}`, pubkey: 'a'.repeat(64) }))
        : Math.round(rng() * 100_000);
      log.push(ev(field, ts, value, device));
      if (field === 'cbLoanBalance') log.push(ev('cbLoanBalanceAsOf', ts, '2026-10-01', device));   // the AsOf pair, same ts
      const r = rng();
      ts += r < 0.05 ? 0 : r < 0.9 ? 10 + Math.floor(rng() * 400) : Math.floor(rng() * 2.5 * W);   // ties, notches, pauses
    }
  }
  return log;
}

const byTsId = (a: PlanEvent, b: PlanEvent) => (a.ts - b.ts) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

// An independent oracle for the two rules BEFORE the budget: keep the latest per field, and a superseded event only if
// it is under 90 days old and its field's next event is more than the window later.
function oracle(log: PlanEvent[]) {
  const sorted = [...log].sort(byTsId);
  const next = new Map<string, number>();
  const kept: PlanEvent[] = [];
  const latests = new Set<string>();
  let burst = false, aged = false, tie = false;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const e = sorted[i], n = next.get(e.field);
    if (n === undefined) { kept.push(e); latests.add(e.id); }
    else {
      if (n - e.ts <= W) burst = true;
      if (n === e.ts) tie = true;
      if (e.ts < NOW - 90 * DAY) aged = true;
      if (e.ts >= NOW - 90 * DAY && n - e.ts > W) kept.push(e);
    }
    next.set(e.field, e.ts);
  }
  return { kept: kept.reverse(), latests, burst, aged, tie };
}

describe('5a — the sweeps (seeded)', () => {
  it('⭐ FOLD-SAFE — 1,500 random logs: the fold never changes, every latest stays, only the rules drop, the trim is oldest first, a second pass changes nothing', () => {
    const rng = mulberry32(0x5a5a);
    let burstLogs = 0, agedLogs = 0, tieLogs = 0, trimmedLogs = 0;
    for (let k = 0; k < 1500; k++) {
      const big = k % 10 === 0;
      const log = big ? randomLog(rng, 700 + Math.floor(rng() * 400), 60, 0.02) : randomLog(rng, 1 + Math.floor(rng() * 40), 200, 0.3);
      const out = compactPlanEvents(log, NOW);
      const o = oracle(log);
      expect(foldPlanEvents(out), `FOLD-SAFE fold #${k}`).toEqual(foldPlanEvents(log));
      const outIds = new Set(ids(out));
      for (const id of o.latests) expect(outIds.has(id), `FOLD-SAFE latest #${k}`).toBe(true);
      expect(compactPlanEvents(out, NOW), `FOLD-SAFE idempotent #${k}`).toEqual(out);
      // only the rules drop: out is the oracle's set, or that set trimmed — oldest history first — to the budget
      const keptIds = ids(o.kept);
      expect(ids(out).every((id) => keptIds.includes(id)) || false, `FOLD-SAFE only the rules #${k}`).toBe(true);
      if (payload(o.kept) <= PLAN_LOG_BUDGET_BYTES) {
        expect(ids(out), `FOLD-SAFE untrimmed #${k}`).toEqual(keptIds);
      } else {
        trimmedLogs++;
        const latestOnly = out.every((e) => o.latests.has(e.id));
        expect(payload(out) <= PLAN_LOG_BUDGET_BYTES || latestOnly, `FOLD-SAFE budget #${k}`).toBe(true);
        const trimmed = o.kept.filter((e) => !outIds.has(e.id));
        const keptHistory = out.filter((e) => !o.latests.has(e.id));
        expect(trimmed.every((e) => !o.latests.has(e.id)), `FOLD-SAFE trims history only #${k}`).toBe(true);
        if (trimmed.length && keptHistory.length) {
          expect(byTsId(trimmed.at(-1)!, keptHistory[0]) < 0, `FOLD-SAFE oldest first #${k}`).toBe(true);
        }
      }
      if (o.burst) burstLogs++;
      if (o.aged) agedLogs++;
      if (o.tie) tieLogs++;
    }
    // non-vacuous: every rule fires somewhere in the sweep
    expect(burstLogs, 'FOLD-SAFE non-vacuous: bursts').toBeGreaterThan(500);
    expect(agedLogs, 'FOLD-SAFE non-vacuous: aged').toBeGreaterThan(300);
    expect(tieLogs, 'FOLD-SAFE non-vacuous: ties').toBeGreaterThan(50);
    expect(trimmedLogs, 'FOLD-SAFE non-vacuous: budget').toBeGreaterThan(100);
  }, 60_000);   // a heavy sweep: a few seconds alone, past vitest's 5 s default in a loaded full suite

  it('⭐ CONVERGE — three devices publishing and pulling in random order: no step moves a fold, and they settle on one log', () => {
    const rng = mulberry32(0xc0de);
    for (let k = 0; k < 200; k++) {
      const created = [0, 1, 2].map(() => randomLog(rng, 1 + Math.floor(rng() * 30), 120, 0.3));
      const all = created.flat();
      const logs = created.map((l) => [...l]);
      const seen = created.map((l) => [...l]);                 // every event a device has ever held
      let relay: PlanEvent[] | null = null;
      for (let step = 0; step < 30; step++) {
        const d = Math.floor(rng() * 3);
        if (rng() < 0.5) { logs[d] = compactPlanEvents(logs[d], NOW); relay = logs[d]; }                          // publish
        else if (relay) { logs[d] = unionPlanEvents(logs[d], relay); seen[d] = unionPlanEvents(seen[d], relay); }  // pull
        expect(foldPlanEvents(logs[d]), `CONVERGE step fold #${k}`).toEqual(foldPlanEvents(seen[d]));
      }
      // settle: each device publishes and the others pull, round after round, until nothing moves
      let rounds = 0, moved = true;
      while (moved && rounds < 6) {
        moved = false; rounds++;
        for (let d = 0; d < 3; d++) {
          const published = compactPlanEvents(logs[d], NOW);
          if (ids(published).join() !== ids(logs[d]).join()) moved = true;
          logs[d] = published;
          for (let o = 0; o < 3; o++) if (o !== d) {
            const merged = unionPlanEvents(logs[o], published);
            if (ids(merged).join() !== ids(logs[o]).join()) moved = true;
            logs[o] = merged;
          }
        }
      }
      expect(moved, `CONVERGE settles #${k}`).toBe(false);
      expect(ids(logs[1]), `CONVERGE one log #${k}`).toEqual(ids(logs[0]));
      expect(ids(logs[2]), `CONVERGE one log #${k}`).toEqual(ids(logs[0]));
      expect(foldPlanEvents(logs[0]), `CONVERGE fold #${k}`).toEqual(foldPlanEvents(all));
    }
  }, 60_000);   // as FOLD-SAFE: past the 5 s default in a loaded full suite
});
