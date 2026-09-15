// Pure form helper shared by the two monthly-log editors (MonthlyLogSection + MonthlyLogOverlay). A .ts module on
// purpose — there is no render harness (zero .test.tsx), so logic left inside a .tsx cannot be tested.

/**
 * The editor's "Strike collateral" field → an entry fragment. MonthlyLogEntry.btcHeld is RECORDED Strike collateral:
 * a blank (or unparseable) field OMITS it — `{}` — and never writes 0, because 0 is a real position and nothing
 * recomputes the column any more to overwrite a placeholder. A typed "0" is a statement and records 0.
 */
export function strikeColFragment(value: string): { btcHeld?: number } {
  const n = parseFloat(value);
  return value.trim() !== '' && Number.isFinite(n) ? { btcHeld: n } : {};
}
