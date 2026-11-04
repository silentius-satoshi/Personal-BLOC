/**
 * BL51 — the preview opens at its top, and his Dashboard after it (the owner's report after BL50's live look: "Preview
 * as viewer" placed him part-way down the preview's home, its greeting off the screen). The app scrolls <body>
 * (global.css: html and body 100% tall, overflow-x hidden), and a page change keeps the offset the last page left:
 * Sharing's "Preview as viewer" sits at the page's foot, and the preview's "✕ Exit preview" rides its sticky bar — so the
 * preview opened at Sharing's offset (442 px down, measured on a phone) and his Dashboard at the preview's. Each of the
 * two buttons calls this first. Both scrollers, whichever a browser uses. ZERO imports.
 */
export function toPageTop(doc: Pick<Document, 'body' | 'documentElement'> = document): void {
  doc.body.scrollTop = 0;
  doc.documentElement.scrollTop = 0;
}
