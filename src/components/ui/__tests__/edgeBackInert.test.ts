import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Sweep 3 (3.3) — EdgeBackGesture's under-layer is INERT while a swipe shows it, not only aria-hidden: its dim takes no
 * pointer, so a second finger on the revealed page's nav opened Settings or the Almanac mid-swipe. The behaviour is
 * e2e/edgeBackInert.spec.ts's (a real touch on the revealed nav; the page still takes taps after a cancelled and a
 * committed swipe); this pins the wiring in the unit suite. Mutation: drop the setAttribute → red here, and the e2e's
 * "the tap opened nothing" red (measured: the Almanac opened).
 */
const SRC = readFileSync(join(process.cwd(), 'src/components/ui/EdgeBackGesture.tsx'), 'utf8');

describe('⭐ EDGE INERT — the under-layer takes no tap while it shows', () => {
  it('⭐ EDGE INERT WIRED — set on the node as it mounts; the node is the under-layer, still aria-hidden', () => {
    const mount = SRC.slice(SRC.indexOf('const underMount = useCallback('), SRC.indexOf('}, []);', SRC.indexOf('const underMount')));
    expect(mount, 'EDGE INERT the callback ref marks the node').toContain("el?.setAttribute('inert', '');");
    expect(mount, 'EDGE INERT and keeps the ref the paint reads').toContain('underRef.current = el;');
    expect(SRC, 'EDGE INERT on the under-layer').toContain('<div ref={underMount} className={styles.under} aria-hidden="true">');
    // The under-layer mounts only during a gesture, so the page it reveals is never left inert once the swipe ends.
    expect(SRC).toContain('{underContent && (');
  });
});
