import { describe, it, expect } from 'vitest';
import { fireFaceOnDeploy } from '../fireDeploy';

/**
 * Where the FIRE face shows (batch 1 build 4b — BL42): on the owner's deploy and in dev, never on the public deploy or the
 * sandbox, until its borrow lane ships. The rule is pure, so it is tested here without Vite; `fireWiring.test.ts` (DEPLOY
 * GATE) pins where the hub reads the two flags. A flag hides the face only at '1', as App.tsx's and AppShell's own reads
 * compare it. Every assertion carries its tag (DEPLOY RULE).
 */

describe('⭐ DEPLOY RULE — the FIRE face shows only where neither VITE_LANDING nor VITE_DEMO is \'1\'', () => {
  it('⭐ DEPLOY RULE — shown on the owner\'s deploy and in dev: neither flag, or a value other than \'1\'', () => {
    expect(fireFaceOnDeploy({}), 'DEPLOY RULE neither flag').toBe(true);
    expect(fireFaceOnDeploy({ VITE_LANDING: undefined, VITE_DEMO: undefined }), 'DEPLOY RULE both unset').toBe(true);
    for (const v of ['0', 'true', '', ' 1', '11']) {
      expect(fireFaceOnDeploy({ VITE_LANDING: v }), `DEPLOY RULE VITE_LANDING '${v}'`).toBe(true);
      expect(fireFaceOnDeploy({ VITE_DEMO: v }), `DEPLOY RULE VITE_DEMO '${v}'`).toBe(true);
    }
  });

  it('⭐ DEPLOY RULE — hidden on the public deploy, on the sandbox, and with both', () => {
    expect(fireFaceOnDeploy({ VITE_LANDING: '1' }), 'DEPLOY RULE the public deploy').toBe(false);
    expect(fireFaceOnDeploy({ VITE_DEMO: '1' }), 'DEPLOY RULE the sandbox').toBe(false);
    expect(fireFaceOnDeploy({ VITE_LANDING: '1', VITE_DEMO: '1' }), 'DEPLOY RULE both').toBe(false);
    expect(fireFaceOnDeploy({ VITE_LANDING: '1', VITE_DEMO: '0' }), 'DEPLOY RULE the public deploy, the other flag off').toBe(false);
    expect(fireFaceOnDeploy({ VITE_LANDING: '0', VITE_DEMO: '1' }), 'DEPLOY RULE the sandbox, the other flag off').toBe(false);
  });
});
