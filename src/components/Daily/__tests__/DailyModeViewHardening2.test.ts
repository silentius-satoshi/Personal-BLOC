import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { strikeAvailableCredit } from '../../../simulation/strikeCredit';

/**
 * Hardening 2 — DailyModeView.tsx's GAP from Hardening 1's mutation hunt (Claude outputs/hardening-1/survivors-HS.json).
 * The trio pill has no render harness, and the helper's four arguments are all numbers — the compiler can't tell price
 * from drawn — so every component call is read in the source: price third, the drawn balance fourth.
 */
const ROOT = join(process.cwd(), 'src/components');

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    if (d.isDirectory()) return d.name === '__tests__' ? [] : sources(p);
    return /\.tsx?$/.test(d.name) ? [p] : [];
  });
}

/** Each `strikeAvailableCredit(` call's top-level arguments, as written. */
function calls(file: string): string[][] {
  const src = readFileSync(file, 'utf8');
  const out: string[][] = [];
  const head = 'strikeAvailableCredit(';
  for (let at = src.indexOf(head); at !== -1; at = src.indexOf(head, at + 1)) {
    const args: string[] = [];
    let depth = 0;
    let cur = '';
    for (let i = at + head.length; i < src.length; i += 1) {
      const c = src[i];
      if (depth === 0 && c === ')') { args.push(cur.trim()); break; }
      if (depth === 0 && c === ',') { args.push(cur.trim()); cur = ''; continue; }
      if (c === '(' || c === '[' || c === '{') depth += 1;
      if (c === ')' || c === ']' || c === '}') depth -= 1;
      cur += c;
    }
    out.push(args);
  }
  return out;
}

describe('Hardening 2 — DailyModeView', () => {
  it('HS-34 · engine.md "Strike avail-credit invariant" (the daily-view trio pill) — every component call passes the price third and the drawn balance fourth', () => {
    const found = sources(ROOT).flatMap((f) => calls(f).map((args) => ({ file: f.slice(ROOT.length + 1), args })));
    expect(found.filter((c) => c.file === 'Daily/DailyModeView.tsx').length, 'HS-34 premise: the trio pill\'s call is read').toBe(1);
    const wrong = found
      .filter((c) => c.args.length !== 4 || !/price/i.test(c.args[2]) || /price/i.test(c.args[3]))
      .map((c) => `${c.file}: (${c.args.join(', ')})`);
    expect(wrong, 'HS-34 price third, drawn fourth').toEqual([]);
    // What a swap costs: 1 ₿ at $100,000 on a $40,000 line, $10,000 drawn — $30,000 available; swapped, none.
    expect([strikeAvailableCredit(40_000, 1, 100_000, 10_000).available, strikeAvailableCredit(40_000, 1, 10_000, 100_000).available])
      .toEqual([30_000, 0]);
  });
});
