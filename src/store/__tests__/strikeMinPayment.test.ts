import { describe, it, expect, afterEach } from 'vitest';
import { useStore, buildSettingsPayload } from '../useStore';

// Simple Mode Corrections A — the two new SYNCED settings (blocMinPaymentSource / blocStatementMinimum)
// travel in the settings payload and hydrate cleanly. Both default to the migration-free 'roll' / null.

const reset = () => useStore.setState({ blocMinPaymentSource: 'roll', blocStatementMinimum: null });

describe('Strike minimum payment source — synced settings', () => {
  afterEach(reset);

  it('defaults are roll / null (migration-free, byte-identical to today)', () => {
    const s = useStore.getState();
    expect(s.blocMinPaymentSource).toBe('roll');
    expect(s.blocStatementMinimum).toBe(null);
  });

  it('buildSettingsPayload carries both fields', () => {
    useStore.getState().setBlocMinPaymentSource('income');
    useStore.getState().setBlocStatementMinimum(142);
    const payload = buildSettingsPayload(useStore.getState());
    expect(payload.blocMinPaymentSource).toBe('income');
    expect(payload.blocStatementMinimum).toBe(142);
  });

  it('hydrateSettings applies both fields (cross-device sync)', () => {
    reset();
    useStore.getState().hydrateSettings({ blocMinPaymentSource: 'income', blocStatementMinimum: 200 });
    expect(useStore.getState().blocMinPaymentSource).toBe('income');
    expect(useStore.getState().blocStatementMinimum).toBe(200);
  });

  it('a remote event lacking the fields does not clobber local values (whitelist skips absent)', () => {
    useStore.getState().setBlocMinPaymentSource('income');
    useStore.getState().setBlocStatementMinimum(90);
    useStore.getState().hydrateSettings({ income: 5000 });   // no min-payment fields
    expect(useStore.getState().blocMinPaymentSource).toBe('income');
    expect(useStore.getState().blocStatementMinimum).toBe(90);
  });
});
