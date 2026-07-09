import type { StoreState } from '../store/useStore'; // TYPE-only → erased at compile → no runtime cycle

/**
 * R2c-2 — the nag's data gate. True once the plan holds REAL logged data (a daily event OR a monthly record),
 * so the dashboard backup nag only fires when there's something on this phone worth losing.
 *
 * Pick-typed so a node test needs no full StoreState fixture; a full-state selector `(s: StoreState) => boolean`
 * is assignable where this is expected, so `useStore(hasLoggedData)` type-checks.
 */
export function hasLoggedData(s: Pick<StoreState, 'dayLog' | 'monthlyLog'>): boolean {
  return s.dayLog.length > 0 || s.monthlyLog.length > 0;
}
