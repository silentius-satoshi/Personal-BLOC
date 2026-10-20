import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 5e (E1, called A — spec `pbloc-spec-batch-1-v1` §2.1) — IBM Plex Mono is self-hosted: `@fontsource/ibm-plex-mono`
 * pinned at exactly 5.3.0, and ONE stylesheet of six @font-face rules of our own — Latin and extended Latin, each at 400,
 * 600 and 700, woff2 only, font-display: swap — each carrying that subset's unicode-range, copied from the package's
 * unicode.json. Not the package's ready-made CSS (its per-subset files carry no range; its per-weight files bring every
 * subset). Google's stylesheet left index.html, and Google's two hosts left the content security policy.
 */

const ROOT = process.cwd();
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const PKG_DIR = join(ROOT, 'node_modules', '@fontsource', 'ibm-plex-mono');
const UNICODE = JSON.parse(readFileSync(join(PKG_DIR, 'unicode.json'), 'utf8')) as Record<string, string>;
const CSS = read('src/styles/fonts.css');
const FACES = [...CSS.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
const prop = (face: string, name: string): string | undefined =>
  face.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+);`))?.[1].trim();

describe('⭐ E1 — the font, self-hosted', () => {
  it('⭐ E1 FACES — exactly six: Latin and extended Latin at 400, 600 and 700, woff2 only, swap, each with its subset\'s range', () => {
    expect(FACES.length, 'FACES six').toBe(6);
    const seen: string[] = [];
    for (const face of FACES) {
      const src = prop(face, 'src')!;
      const m = src.match(/^url\('@fontsource\/ibm-plex-mono\/files\/ibm-plex-mono-(latin|latin-ext)-(400|600|700)-normal\.woff2'\) format\('woff2'\)$/);
      expect(m, `FACES one woff2 source of the package's files: ${src}`).not.toBeNull();
      const [, subset, weight] = m!;
      expect(prop(face, 'font-family'), 'FACES family').toBe("'IBM Plex Mono'");
      expect(prop(face, 'font-style'), 'FACES normal').toBe('normal');
      expect(prop(face, 'font-display'), 'FACES swap').toBe('swap');
      expect(prop(face, 'font-weight'), 'FACES the weight matches its file').toBe(weight);
      expect(prop(face, 'unicode-range'), `FACES ${subset} ${weight}: the range is unicode.json's`).toBe(UNICODE[subset]);
      expect(existsSync(join(PKG_DIR, 'files', `ibm-plex-mono-${subset}-${weight}-normal.woff2`)), 'FACES the file exists').toBe(true);
      seen.push(`${subset}-${weight}`);
    }
    expect(seen.sort(), 'FACES the six pairs, once each').toEqual(
      ['latin-400', 'latin-600', 'latin-700', 'latin-ext-400', 'latin-ext-600', 'latin-ext-700']);
  });

  it('⭐ E1 FACES — ₿ (U+20BF) is extended Latin\'s, and plain letters are Latin\'s alone', () => {
    const covers = (range: string, cp: number) => range.split(',').some((part) => {
      const [a, b = a] = part.replace(/U\+/g, '').split('-');
      return cp >= parseInt(a, 16) && cp <= parseInt(b, 16);
    });
    expect(covers(UNICODE['latin-ext'], 0x20bf), '₿ in extended Latin').toBe(true);
    expect(covers(UNICODE.latin, 0x20bf), '₿ not in Latin').toBe(false);
    expect(covers(UNICODE['latin-ext'], 0x41), '"A" not in extended Latin').toBe(false);
    expect(covers(UNICODE.latin, 0x41), '"A" in Latin').toBe(true);
  });

  it('⭐ E1 PIN — @fontsource/ibm-plex-mono pinned at exactly 5.3.0, in package.json and the lock', () => {
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    expect(pkg.dependencies['@fontsource/ibm-plex-mono'], 'PIN exact').toBe('5.3.0');
    const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { version?: string; license?: string }> };
    expect(lock.packages['node_modules/@fontsource/ibm-plex-mono']?.version, 'PIN the lock').toBe('5.3.0');
    expect(lock.packages['node_modules/@fontsource/ibm-plex-mono']?.license, 'PIN the licence').toBe('OFL-1.1');
    expect((JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8')) as { version: string }).version, 'PIN installed').toBe('5.3.0');
  });

  it('⭐ E1 NO-GOOGLE — no Google stylesheet in index.html, and no source imports the package\'s ready-made CSS', () => {
    expect(read('index.html'), 'NO-GOOGLE index.html').not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(read('src/styles/global.css'), 'NO-GOOGLE the faces load with the global stylesheet').toMatch(/@import '\.\/fonts\.css';/);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__tests__') walk(p); }
        else if (/\.(ts|tsx|css)$/.test(e.name)) files.push(p);
      }
    };
    walk(join(ROOT, 'src'));
    expect(files.length, 'NO-GOOGLE the sweep reads src').toBeGreaterThan(200);
    for (const f of files) {
      const text = readFileSync(f, 'utf8');
      expect(text, `NO-GOOGLE ${f}`).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
      // Code only — a comment may name the package; an import or a url() is what loads something.
      const bare = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1');
      for (const ref of bare.match(/@fontsource\/ibm-plex-mono[^'")\s]*/g) ?? []) {
        expect(ref, `NO-GOOGLE ${f}: only the package's own woff2 files, never its CSS`).toMatch(/^@fontsource\/ibm-plex-mono\/files\/ibm-plex-mono-[a-z-]+-\d00-normal\.woff2$/);
      }
    }
  });

  it('⭐ E1 CSP — no Google host in the content security policy; \'self\' serves the styles and the fonts', () => {
    const vercel = JSON.parse(read('vercel.json')) as { headers: { headers: { key: string; value: string }[] }[] };
    const csp = vercel.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy')!.value;
    expect(csp, 'CSP no Google host').not.toMatch(/googleapis|gstatic/);
    const directive = (name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `))!;
    expect(directive('style-src'), 'CSP style-src').toBe("style-src 'self' 'unsafe-inline'");
    expect(directive('font-src'), 'CSP font-src').toBe("font-src 'self'");
  });
});
