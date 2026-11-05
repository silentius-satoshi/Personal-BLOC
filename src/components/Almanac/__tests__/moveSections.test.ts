import { describe, it, expect } from 'vitest';
import { placementPlan, type PlacementInput } from '../../../simulation/placement';
import { deriveVenueSplit } from '../../../simulation/viewerVenue';
import {
  moveCard, moveSections, todayActions, fmtSharePct, fmtBtc3, NOTHING_TODAY_LINE, TODAY_VENUES,
  type BreakerReading, type MoveCardContext, type MoveSections, type MoveCardCopy,
} from '../decisionView';
import { venuesOf } from '../planMonthView';
import { shownBtc } from '../supportPolicyView';

/**
 * R1 (BL45, B′) — THE MOVE in sections. `moveSections` arranges `moveCard`'s lines: To do today (THIS MONTH's own rows and
 * today's state lines), a card per venue that folds, the quiet foot. Its kill criteria (BL45): no figure on the card
 * moves, and the card shows no figure THE MOVE doesn't compute — the one new figure, cold storage's share, the
 * Dashboard's split. Read against a sweep of placements, lines, loans, breakers and states.
 */

/** The B′ board's own plan (the canvas "Almanac grid & Decision card mocks", 2026-10-28): its card's every figure. */
const PLACE: PlacementInput = {
  creditLine: 40_000, strikeBalance: 0, strikeCollateralBtc: 2.5, cbDebt: 20_000, cbCollateralBtc: 2.2,
  coldBtc: 0.5, price: 122_650, support: 65_634, skStop: 0.50, cbStop: 0.45, cbDefenseLtv: 0.70,
  bufferUsd: 36_000, accumulateBelow: 2.0, payDownAbove: 3.0, inHold: false, broken: false,
};
const CLEAN: BreakerReading = { broken: false, monthsAtOrAbove: 0, monthsBelow: 0, lastMonthEndLabel: '30 Sep 2026' };
/** A move under the threshold: each venue a sliver over its keep, together under 0.01 ₿ (N5 — nothing moves). */
const KEEPS = placementPlan(PLACE);
const SUB: PlacementInput = {
  ...PLACE, strikeCollateralBtc: KEEPS.strikeKeepBtc! + 0.004, cbCollateralBtc: KEEPS.cbKeepBtc! + 0.0004,
};

/** The face's own wiring (B1): the card's price, support, debt, stop and line are the placement input's. */
function ctxOf(input: PlacementInput, o: Partial<MoveCardContext> = {}): MoveCardContext {
  return {
    whatIf: false, policyApplied: true, policyEnabled: true, policyIgnoredReason: null,
    plan: placementPlan(input), holdThroughISO: '2026-12-01', holdDepositISO: '2026-10-02',
    breaker: CLEAN, rearmRule: 6,
    runLineUsd: input.creditLine, ownerLineUsd: input.creditLine, suggestedLineUsd: 20_000,
    expenses: 3_000, bearBufferMonths: 12, cbStop: input.cbStop, support: input.support, price: input.price,
    cbDebt: input.cbDebt, cbLtvTriggerPct: 75, cbLtvTargetPct: 65, hasCbLoan: input.cbDebt > 0, consoleRuns: input.cbDebt > 0,
    ...o,
  };
}
function both(input: PlacementInput, o: Partial<MoveCardContext> = {}): { card: MoveCardCopy; s: MoveSections; ctx: MoveCardContext } {
  const ctx = ctxOf(input, o);
  const card = moveCard(ctx);
  return { card, s: moveSections(card, ctx, input), ctx };
}
/** Every text the sectioned card prints. */
function textsOf(s: MoveSections): string[] {
  return [
    ...s.lead.map((l) => l.text),
    ...(s.todo?.rows.map((r) => r.text) ?? []), ...(s.todo?.notes.map((l) => l.text) ?? []),
    ...s.venues.flatMap((v) => [v.held, ...v.facts.flatMap((f) => [f.value, ...f.parts.map((p) => p.text)])]),
    ...s.foot.map((l) => l.text),
  ];
}
/** Every line key the sectioned card places. */
function keysOf(s: MoveSections): string[] {
  return [
    ...s.lead.map((l) => l.key), ...(s.todo?.notes.map((l) => l.key) ?? []),
    ...s.venues.flatMap((v) => v.facts.map((f) => f.key)), ...s.foot.map((l) => l.key),
  ];
}
const FIG = /\$[\d,]+(?:\.\d+)?|\d[\d,]*(?:\.\d+)?(?:×|%| ₿)?/g;
const figs = (texts: string[]): Set<string> => new Set(texts.flatMap((t) => t.match(FIG) ?? []));

// ── the sweep: placements × contexts ─────────────────────────────────────────────────────────────────────────────
interface Cell { name: string; input: PlacementInput; o: Partial<MoveCardContext> }
function sweep(): Cell[] {
  const cells: Cell[] = [];
  const strikes = [0, 0.004, 1.2, 2.5, 6];
  const cbs: [number, number][] = [[0, 0], [20_000, 2.2], [20_000, 0.4], [60_000, 1], [0, 1.1], [150_000, 2]];
  const colds = [0, 0.0003, 0.5, 3];
  const prices: [number, number][] = [[122_650, 65_634], [90_000, 65_634], [60_000, 65_634], [300_000, 65_634]];
  for (const sk of strikes) for (const [debt, cb] of cbs) for (const cold of colds) for (const [price, support] of prices) {
    const input = { ...PLACE, strikeCollateralBtc: sk, cbDebt: debt, cbCollateralBtc: cb, coldBtc: cold, price, support };
    cells.push({ name: `sk${sk} cb${debt}/${cb} cold${cold} p${price}`, input, o: {} });
  }
  const base = PLACE;
  // states and lines: the hold, the breaker, a sub-threshold move, the line's three readings, the stand-down, no bills
  cells.push(
    { name: 'hold', input: { ...base, inHold: true }, o: {} },
    { name: 'broken', input: { ...base, broken: true }, o: { breaker: { ...CLEAN, broken: true, monthsAtOrAbove: 2 } } },
    { name: 'one short', input: base, o: { breaker: { ...CLEAN, monthsBelow: 1 } } },
    { name: 'no history', input: base, o: { breaker: null } },
    { name: 'loading', input: base, o: { breaker: 'loading' } },
    { name: 'sub-threshold', input: SUB, o: {} },
    { name: 'try a line', input: base, o: { ownerLineUsd: 10_000, runLineUsd: 10_000, suggestedLineUsd: 20_000 } },
    { name: 'what-if line', input: { ...base, creditLine: 60_000 }, o: { ownerLineUsd: 40_000, whatIf: true } },
    { name: 'stand-down', input: { ...base, strikeBalance: 0, cbDebt: 0, goalNetBtc: 1 }, o: { hasCbLoan: true, cbDebt: 0 } },
    { name: 'no bills', input: base, o: { expenses: 0 } },
    { name: 'no room', input: base, o: { bearBufferMonths: 0 } },
    { name: 'console off', input: base, o: { consoleRuns: false } },
    { name: 'policy off', input: base, o: { policyApplied: false, policyEnabled: false } },
    { name: 'policy ignored', input: base, o: { policyApplied: false, policyEnabled: true, policyIgnoredReason: 'strikeLadder' } },
    { name: 'unavailable', input: { ...base, support: Number.NaN }, o: {} },
    { name: 'past liquidation', input: { ...base, cbDebt: 400_000 }, o: {} },
    { name: 'at the trigger', input: { ...base, cbDebt: 210_000 }, o: {} },
    { name: 'over the limit', input: { ...base, cbDebt: 80_000 }, o: {} },
    { name: 'into Coinbase', input: { ...base, cbCollateralBtc: 1.2 }, o: {} },
    { name: 'short of the line', input: { ...base, strikeCollateralBtc: 0.6 }, o: {} },
  );
  return cells;
}
const CELLS = sweep();

describe('⭐ R1 — THE MOVE in sections (B′, BL45)', () => {
  it('⭐ SECTIONS premise — the sweep reaches every state, every venue card and every line kind', () => {
    const states = new Set<string>(); const venues = new Set<string>(); const keys = new Set<string>();
    for (const c of CELLS) {
      const { card, s } = both(c.input, c.o);
      states.add(s.todo === null ? 'none' : `${c.o.policyApplied === false ? 'off' : 'on'}`);
      states.add(both(c.input, c.o).ctx.plan.state);
      for (const v of s.venues) venues.add(v.venue);
      for (const l of card.lines) keys.add(l.key);
    }
    expect([...states].sort(), 'SECTIONS states').toEqual(
      ['broken', 'cbPastLiquidation', 'none', 'on', 'paused', 'ready', 'unavailable'].sort());
    expect([...venues].sort(), 'SECTIONS venues').toEqual(['coinbase', 'cold', 'strike']);
    for (const k of ['moves', 'why', 'state', 'batch', 'aligned', 'breaker', 'short', 'overLimit', 'cliff', 'alert',
      'cliffDepth', 'line', 'lineHold', 'pathInvariant']) expect(keys.has(k), `SECTIONS reaches ${k}`).toBe(true);
  });

  it('⭐ LINES — every line the card shows is placed once, but `moves` and (save at the stand-down) `why`', () => {
    for (const c of CELLS) {
      const { card, s, ctx } = both(c.input, c.o);
      const placed = keysOf(s);
      const expected = card.lines.map((l) => l.key)
        .filter((k) => s.todo === null || (k !== 'moves' && (k !== 'why' || ctx.plan.standDown)));
      for (const k of expected) {
        expect(placed.filter((p) => p === k), `LINES ${c.name}: ${k}`).toHaveLength(1);
      }
      if (s.todo === null) expect(s.lead, `LINES ${c.name}: nothing to arrange`).toEqual(card.lines);
    }
  });

  it('⭐ FIGURES — no figure moves: every figure the card prints is on its sections; the new ones are THE MOVE\'s', () => {
    let compared = 0;
    for (const c of CELLS) {
      const { card, s, ctx } = both(c.input, c.o);
      if (s.todo === null) continue;
      const flat = figs(card.lines.map((l) => l.text));
      const sect = figs(textsOf(s));
      // With no Coinbase card (no loan switched on, no coins there today or after), its keep's clause goes with it.
      const why = card.lines.find((l) => l.key === 'why')!.text;
      const cbClause = why.includes('; ') ? why.slice(why.indexOf('; ')) : '';
      const dropped = s.venues.some((v) => v.venue === 'coinbase') ? new Set<string>() : figs([cbClause]);
      for (const f of flat) {
        if (dropped.has(f) && !sect.has(f)) continue;
        expect(sect.has(f), `FIGURES ${c.name}: "${f}" from the card`).toBe(true);
      }
      // New: today's holdings (THE MOVE's input), the position after (its `opening`), cold's arrival, the total, the share.
      const o = ctx.plan.opening;
      const coldIn = ctx.plan.state === 'ready' && ctx.plan.worthMoving ? ctx.plan.strikeToColdBtc + ctx.plan.cbToColdBtc : 0;
      const split = deriveVenueSplit(o.strikeCollateralBtc, o.cbCollateralBtc, o.coldBtc);
      const allowed = figs([
        ...[c.input.strikeCollateralBtc, c.input.cbCollateralBtc, c.input.coldBtc, o.strikeCollateralBtc,
          o.cbCollateralBtc, o.coldBtc, coldIn, split.combinedBtc].map((x) => `${fmtBtc3(x)} ₿`),
        fmtSharePct(split.coldShare),
      ]);
      for (const f of sect) {
        if (flat.has(f)) continue;
        expect(allowed.has(f), `FIGURES ${c.name}: "${f}" is new`).toBe(true);
      }
      compared += 1;
    }
    expect(compared, 'FIGURES premise').toBeGreaterThan(400);
  });

  it('⭐ FOLD — a warning never folds out of sight; folded, a card shows its warnings and the what-if\'s way back alone', () => {
    let warned = 0;
    for (const c of CELLS) {
      const { s } = both(c.input, c.o);
      for (const v of s.venues) for (const f of v.facts) {
        const warns = f.tone === 'warn' || f.tone === 'bad';
        const whatIf = f.action?.kind === 'backToLine';
        expect(f.folded, `FOLD ${c.name}: ${v.venue} ${f.key}`).toBe(warns || whatIf);
        if (warns) warned += 1;
      }
    }
    expect(warned, 'FOLD premise').toBeGreaterThan(50);
  });

  it('⭐ COINBASE FOLDED — with a seizure price, the folded Coinbase card shows it: amount, how far below today', () => {
    const { card, s } = both(PLACE);
    const cliff = card.lines.find((l) => l.key === 'cliff')!.text;
    const cb = s.venues.find((v) => v.venue === 'coinbase')!;
    const folded = cb.facts.filter((f) => f.folded);
    expect(folded.map((f) => f.key), 'COINBASE FOLDED').toEqual(['cliff']);
    const f = folded[0];
    expect(f.label).toBe('Seizes at');
    expect(cliff, 'COINBASE FOLDED the card\'s words').toBe(`Coinbase seizes this loan at ${f.value} — ${f.parts[0].text}.`);
  });

  it('⭐ TODO — the rows are THIS MONTH\'s own (`todayActions`), and each row\'s venues are its dot\'s (one rule)', () => {
    let rows = 0;
    for (const c of CELLS) {
      const { s, ctx } = both(c.input, c.o);
      if (s.todo === null) continue;
      const today = todayActions(ctx.plan);
      expect(s.todo.rows.map((r) => r.text), `TODO ${c.name}`).toEqual(today.map((a) => a.text));
      for (const r of s.todo.rows) {
        expect(r.venues, `TODO ${c.name}: ${r.key}`).toEqual(venuesOf(r.text));
        expect(r.venues).toEqual(TODAY_VENUES[r.key as keyof typeof TODAY_VENUES]);
        rows += 1;
      }
      // Never empty: a row, a state line, or "Nothing to move today." — and that only when there is nothing else.
      expect(s.todo.rows.length + s.todo.notes.length, `TODO ${c.name}: never empty`).toBeGreaterThan(0);
      const none = s.todo.notes.some((l) => l.text === NOTHING_TODAY_LINE);
      expect(none, `TODO ${c.name}: "nothing" alone`).toBe(s.todo.rows.length === 0 && s.todo.notes.length === 1 && none);
    }
    expect(rows, 'TODO premise').toBeGreaterThan(100);
  });

  it('⭐ HELD — each venue\'s row is what the owner holds once today\'s move is made (`opening`), never the deferred end', () => {
    const sub = both(SUB);
    expect(sub.ctx.plan.worthMoving, 'HELD premise — a move under the threshold').toBe(false);
    expect(fmtBtc3(sub.ctx.plan.after.strikeCollateralBtc), 'HELD premise — the end differs')
      .not.toBe(fmtBtc3(SUB.strikeCollateralBtc));
    const held = Object.fromEntries(sub.s.venues.map((v) => [v.venue, v.held]));
    expect(sub.s.venues.map((v) => v.rowName), 'HELD the row\'s name').toEqual(sub.s.venues.map((v) => `${v.name}, ${v.held}`));
    expect(held, 'HELD — today\'s holdings, the move deferred').toEqual({
      strike: `${fmtBtc3(SUB.strikeCollateralBtc)} ₿`, coinbase: `${fmtBtc3(SUB.cbCollateralBtc)} ₿`, cold: '0.500 ₿',
    });
    const made = both(PLACE);
    for (const v of made.s.venues) {
      const x = { strike: made.ctx.plan.opening.strikeCollateralBtc, coinbase: made.ctx.plan.opening.cbCollateralBtc,
        cold: made.ctx.plan.opening.coldBtc }[v.venue];
      expect(v.held, `HELD ${v.venue}`).toBe(shownBtc(x) ? `${fmtBtc3(x)} ₿` : '—');
    }
  });

  it('⭐ SHARE — cold storage\'s share is the Dashboard\'s split on the held position; its ends say so', () => {
    const { s, ctx } = both(PLACE);
    const o = ctx.plan.opening;
    const split = deriveVenueSplit(o.strikeCollateralBtc, o.cbCollateralBtc, o.coldBtc);
    const after = s.venues.find((v) => v.venue === 'cold')!.facts.find((f) => f.key === 'coldAfter')!;
    expect(after.parts[0].text, 'SHARE').toBe(`${Math.round(split.coldShare * 100)}% of all ${fmtBtc3(split.combinedBtc)} ₿`);
    expect([fmtSharePct(0.001), fmtSharePct(0.004), fmtSharePct(0.37), fmtSharePct(0.996), fmtSharePct(1)], 'SHARE ends')
      .toEqual(['less than 1%', 'less than 1%', '37%', 'more than 99%', '100%']);
  });

  it('⭐ B′ — the board, text for text: To do today, then Strike, Coinbase and cold storage, then the foot', () => {
    const { s } = both(PLACE);
    expect(s.lead.map((l) => l.text), 'B′ lead').toEqual(
      ["This is your plan of record's move this month — the support policy, with your settings."]);
    expect(s.todo!.rows.map((r) => [r.text, r.venues]), 'B′ To do today').toEqual([
      ['Release 1.281 ₿ of Strike collateral to cold storage.', ['strike', 'cold']],
      ['Move 0.304 ₿ from Coinbase to cold storage.', ['coinbase', 'cold']],
    ]);
    expect(s.todo!.notes.map((l) => [l.text, l.tone]), 'B′ the state line').toEqual([['Strike releases this today.', 'good']]);
    const card = (venue: string) => {
      const v = s.venues.find((x) => x.venue === venue)!;
      return [v.name, v.held, v.rowName, ...v.facts.map((f) => [f.label, f.value, ...f.parts.map((p) => p.text)])];
    };
    expect(card('strike'), 'B′ Strike').toEqual(['Strike', '1.219 ₿', 'Strike, 1.219 ₿',
      ['Keeps', '1.219 ₿ of 2.500 ₿'],
      ['For', 'your $40,000 line', 'At support: $65,634'],
      ['The line', 'covers', 'Two months of bills', 'One Coinbase paydown, 75% → 65%']]);
    expect(card('coinbase'), 'B′ Coinbase').toEqual(['Coinbase', '1.896 ₿', 'Coinbase, 1.896 ₿',
      ['Keeps', '1.896 ₿ of 2.200 ₿'],
      ['For', 'its $20,000 debt plus 12 months of bills at support'],
      ['Seizes at', '$12,265', '90% below today'],
      ['Price alert', '$14,064', 'Your 75% trigger', 'On the day, work from the Emergency Console'],
      ['Survives', 'down to 0.52× support ($34,343), at its limit']]);
    expect(card('cold'), 'B′ cold storage').toEqual(['Cold storage', '2.085 ₿', 'Cold storage, 2.085 ₿',
      ['Now', '0.500 ₿ in your own custody'],
      ['Today', '+1.585 ₿', '1.281 ₿ from Strike', '0.304 ₿ from Coinbase'],
      ['After', '2.085 ₿', '40% of all 5.200 ₿']]);
    expect(s.foot.map((l) => l.text), 'B′ the foot').toEqual([
      "Month-ends through 30 Sep 2026: the model isn't treated as broken.",
      "This move is measured at today's support and today's price, so switching paths below doesn't change it."]);
  });
});
