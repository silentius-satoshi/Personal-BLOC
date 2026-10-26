import { describe, it, expect, vi, afterEach } from 'vitest';
import { accruedCbBalance, accruedCbLiquidationPrice } from '../cbMetrics';

afterEach(() => { vi.useRealTimers(); });

describe('cbMetrics hardening', () => {
  it('HS-02 · cbMetrics.ts — accruedCbBalance never ages a balance backwards (a future as-of returns it unchanged)', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    expect(accruedCbBalance(10_000, 10, '2099-01-01')).toBe(10_000);
  });

  it('HS-03 · cbMetrics.ts — accruedCbLiquidationPrice never ages an entered liquidation price backwards', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T12:00:00Z'));
    expect(accruedCbLiquidationPrice(50_000, 10, '2099-01-01')).toBe(50_000);
  });
});
