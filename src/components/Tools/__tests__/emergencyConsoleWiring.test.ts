import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * ⚠ STRUCTURAL GUARD — how the Emergency Console runs the crash playbook (crash playbook Run 2). The repo has no render
 * harness, so, like supportPolicyWiring.test.ts, these rules are read off the source:
 *
 *  - the console builds its input through crashPlaybookView's one live builder (never a copy), runs crashPlaybook on
 *    it, and renders the waiting card or the playbook card — so the console and the engine give ONE answer;
 *  - it reads the live figures: the LIVE Strike balance (advisorActualBlocBalance — never the last logged month's),
 *    the reading-anchored Strike collateral, the live cold total, the target and the trigger, and the dayLog (Strike's
 *    60-day hold); the debt is accrued at the boundary, and the power-law support crossing stays in the component;
 *  - the Phase-1 buy-and-pledge surface is gone from the console, and its Settings field with it.
 *
 * Each check was proven red by a temporary edit before it landed.
 */
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');
const CONSOLE = read('src/components/Tools/EmergencyConsole.tsx');
const SETTINGS = read('src/components/Settings/SettingsMain.tsx');

describe('EmergencyConsole — the crash playbook wiring', () => {
  it('⭐ runs the playbook through the view module, on the live figures', () => {
    const calls = [
      'playbookInputFromLive(', 'crashPlaybook(', 'playbookCard(', 'waitingCard(', 'strikeHoldFrom(',
      'accruedCbBalance(', 'plBandsAt(',
    ];
    for (const call of calls) expect(CONSOLE, call).toContain(call);
    const reads = [
      'useStore((s) => s.getCurrentColdBtc())', 'useStore((s) => s.getCurrentBtcHeld())',
      'useStore((s) => s.advisorActualBlocBalance)', 'useStore((s) => s.cbLtvTargetPct)',
      'useStore((s) => s.cbLtvTriggerPct)', 'useStore((s) => s.dayLog)',
    ];
    for (const field of reads) expect(CONSOLE, field).toContain(field);
    // The playbook's Strike balance is the LIVE balance.
    expect(CONSOLE).toMatch(/strikeBalance: advisorActualBlocBalance\b/);
  });

  it('⭐ none of the Phase-1 surface survives in the console', () => {
    const gone = [
      'firepower', 'drawToLtv', 'floorTable', 'direSwitch', 'surplus(', 'deriveCurrentPosition',
      'cbEmergencyCeilingPct', 'BLOC_OPERATING_CEILING',
    ];
    for (const name of gone) expect(CONSOLE, name).not.toContain(name);
  });
});

describe('SettingsMain — the console ceiling field is gone', () => {
  it('⭐ no "Emergency ceiling" field and no reader of its setting', () => {
    expect(SETTINGS).not.toContain('Emergency ceiling');
    expect(SETTINGS).not.toContain('cbEmergencyCeilingPct');
  });
});
