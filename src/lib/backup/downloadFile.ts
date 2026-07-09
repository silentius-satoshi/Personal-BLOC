/**
 * The browser-standard "save a Blob to disk" pattern — an anchor with a `download` attribute, clicked, then the
 * object URL revoked. Extracted verbatim from `downloadPlanBackup` (exportPlan.ts), which is the iOS-verified
 * original; both the plan backup and the Recovery Key ceremony's save aids now share this one implementation.
 *
 * iOS caveat (unchanged from the original): a standalone PWA may OPEN the file rather than save it. That is why
 * every surface offering a download also offers a copy/share alternative.
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
