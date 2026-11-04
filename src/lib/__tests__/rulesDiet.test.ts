import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Sweep 2a (BL52) — the rules diet. `.claude/rules/` loads into every Claude Code session that touches the files its
 * `paths:` cover, so it holds what binds and no more: each rule's mechanism, measures and history live in
 * `docs/claude/rules-in-full.md`, which nothing loads. The budget keeps the rules from growing back their prose; a rule
 * that truly needs the room raises it on purpose, in the same change.
 */
const ROOT = process.cwd();
const RULES = join(ROOT, '.claude/rules');
const FULL = join(ROOT, 'docs/claude/rules-in-full.md');
const BUDGET_BYTES = 84 * 1024;     // all the rules — 77,345 bytes at Sweep 2a
const FILE_CAP_BYTES = 32 * 1024;   // any one file — the largest, engine.md, 23,148 bytes at Sweep 2a

describe('⭐ RULES DIET', () => {
  it('⭐ RULES DIET — the rules stay within their budget, each file within its cap and pointing to its full text, which is there', () => {
    // every .md under .claude/rules/, a subfolder's too — Claude Code reads them all
    const files = (readdirSync(RULES, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.split(sep).join('/'))
      .sort();
    expect(files.length, 'RULES DIET premise: the rules files are read').toBeGreaterThanOrEqual(8);
    expect(existsSync(FULL), 'RULES DIET the full text is there').toBe(true);
    const full = readFileSync(FULL, 'utf8');
    let total = 0;
    for (const f of files) {
      const text = readFileSync(join(RULES, f), 'utf8');
      const bytes = Buffer.byteLength(text, 'utf8');
      total += bytes;
      expect(bytes, `RULES DIET ${f} within its cap`).toBeLessThanOrEqual(FILE_CAP_BYTES);
      expect(text, `RULES DIET ${f} points to its full text`).toContain(`\`docs/claude/rules-in-full.md\` § \`${f}\``);
      const at = full.indexOf(`\n## \`${f}\` — `);
      expect(at, `RULES DIET ${f}'s full text`).toBeGreaterThan(-1);
      const next = full.indexOf('\n## `', at + 1);
      const section = full.slice(at, next === -1 ? undefined : next);
      expect(section.length, `RULES DIET ${f}'s full text, not just its heading`).toBeGreaterThan(500);
    }
    expect(total, 'RULES DIET the budget').toBeLessThanOrEqual(BUDGET_BYTES);
  });
});
