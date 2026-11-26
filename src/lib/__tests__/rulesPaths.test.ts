import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * Sweep 3 (1.7) — a rule reaches a session only through its file's `paths:`: Claude Code loads `.claude/rules/x.md` when
 * a file those globs cover is read, written or edited (CLAUDE.md, "How these instructions are organized"). A row that
 * names a source file outside them is a rule that never loads when that file is edited — review found three before
 * (fireDeploy.ts, planGoal.ts, fireInputs.ts). So: every source file a scoped rules file names — `name.ts`, `name.tsx`,
 * `name.css`, a path ending in one, or a slash-qualified module like `lib/planGoal` — exists under src/ and sits under one
 * of that file's globs. Tests, specs and goldens are not source. general.md has no `paths:` — it loads in every session.
 * Mutation: drop "src/lib/planGoal.ts" from engine.md's `paths:` → red (engine.md names `lib/planGoal`).
 */
const ROOT = process.cwd();
const RULES = join(ROOT, '.claude/rules');

/** Every file under src/, as 'src/…' with forward slashes. */
const ALL = (readdirSync(join(ROOT, 'src'), { recursive: true }) as string[]).map((f) => `src/${f.split(sep).join('/')}`);
/** The source files a rule can name: code and styles, never a test. */
const SOURCES = ALL.filter((f) => /\.(ts|tsx|css)$/.test(f) && !/\.(test|spec)\.tsx?$/.test(f) && !f.includes('/__tests__/'));
/** Tokens that read like a file name and aren't one: journal.md's `e.at ?? e.ts` (a day event's `ts` field). */
const NOT_FILES = new Set(['e.ts']);

/** A `paths:` glob as a regex: `**` (with its slash) crosses folders, zero or more; `*` stays inside one. */
function globRegex(glob: string): RegExp {
  const source = glob
    .split(/\*\*\/?/)
    .map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*'))
    .join('.*');
  return new RegExp(`^${source}$`);
}

/** The source files a token can mean: the path itself, or any file whose path ends in it. */
function candidates(token: string): string[] {
  const t = token.replace(/^\.?\//, '');
  return SOURCES.filter((s) => s === t || s.endsWith(`/${t}`));
}

interface RulesFile { name: string; globs: RegExp[] | null; body: string }

function rulesFiles(): RulesFile[] {
  return (readdirSync(RULES, { recursive: true }) as string[])
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.split(sep).join('/'))
    .sort()
    .map((name) => {
      const text = readFileSync(join(RULES, name), 'utf8');
      const fm = text.match(/^---\n([\s\S]*?)\n---/);
      if (fm === null) return { name, globs: null, body: text };
      const globs = [...fm[1].matchAll(/-\s*"([^"]+)"/g)].map((m) => globRegex(m[1]));
      return { name, globs, body: text.slice(fm[0].length) };
    });
}

/** Every source file a rules file's body names, by the name as written. */
function namedFiles(body: string): string[] {
  const withExt = [...body.matchAll(/[A-Za-z0-9_./-]*[A-Za-z0-9_]\.(?:tsx?|css)\b/g)].map((m) => m[0])
    .filter((t) => !/\.(test|spec)\.tsx?$/.test(t) && !NOT_FILES.has(t));
  const modules = [...body.matchAll(/`([A-Za-z]+\/[A-Za-z0-9_]+)`/g)].map((m) => m[1]);
  return [...new Set([...withExt, ...modules])];
}

describe('⭐ RULES PATHS', () => {
  it('⭐ RULES PATHS — every source file a rules row names exists and sits under that rules file\'s paths:', () => {
    const files = rulesFiles();
    expect(files.length, 'RULES PATHS premise: the rules files are read').toBeGreaterThanOrEqual(8);
    expect(files.filter((f) => f.globs === null).map((f) => f.name), 'RULES PATHS only general.md loads everywhere')
      .toEqual(['general.md']);
    let named = 0;
    const unresolved: string[] = [];
    const outside: string[] = [];
    for (const f of files) {
      if (f.globs === null) continue;
      expect(f.globs.length, `RULES PATHS premise: ${f.name} has globs`).toBeGreaterThan(0);
      for (const token of namedFiles(f.body)) {
        const isModule = !/\.(tsx?|css)$/.test(token);
        const c = isModule
          ? SOURCES.filter((s) => s.endsWith(`/${token}.ts`) || s.endsWith(`/${token}.tsx`))
          : candidates(token);
        named += 1;
        if (c.length === 0) { unresolved.push(`${f.name}: ${token}`); continue; }
        if (!c.some((s) => f.globs!.some((g) => g.test(s)))) outside.push(`${f.name}: ${token} → ${c.join(' | ')}`);
      }
    }
    expect(named, 'RULES PATHS premise: the rows name files').toBeGreaterThan(20);
    expect(unresolved, 'RULES PATHS every named file exists under src/').toEqual([]);
    expect(outside, 'RULES PATHS every named file sits under its rules file\'s paths:').toEqual([]);
  });
});
