// BL15 / C1-B — the venue colours (Customization; spec `pbloc-spec-batch-1-v1` §2.4). Each venue wears one colour across
// the app — its dots, bar segments, chart lines and venue words: Strike white, Coinbase blue, cold storage orange.
// Settings → Customization lets the owner change them; the choice rides the prefs channel (`prefs:v1`, beside the buying
// unit) to the owner's devices, the plan backup and a trusted viewer's snapshot. No store version bump, no new channel.
//
// The defaults are tokens.css's own colours (`--text-primary`, `--coinbase`, `--btc`), reached through three venue tokens
// (`--venue-strike`, `--venue-coinbase`, `--venue-cold`); `applyVenueColors` sets a chosen colour on :root and removes it
// to fall back. Every venue mark reads a venue token — never `--text-primary`, `--coinbase` or `--btc` for a venue.
//
// THE RULE (BL15's kill criterion — a requirement, not an option): the picker refuses a colour that would make a venue
// unreadable on the app's dark background, or hard to tell from the other venues or from the status colours (green,
// amber, red). Readable = a contrast of at least READABLE_MIN against every surface a venue mark sits on (the level the
// app's own Coinbase blue holds). Apart = a CIEDE2000 distance of at least VENUE_APART_MIN from each other venue's colour
// and STATUS_APART_MIN from each status colour; a venue's own default is exempt from the status test only (cold storage's
// orange sits 4.8 from the app's amber, and stays the default).
//
// The rule runs twice: in the store's setter, on every pick (`checkVenueColor`), and at the sink, on whatever the stored
// pref holds (`resolveVenueColors`) — a synced object, a restored backup, a trusted viewer's snapshot, a later version's
// colours. A stored colour that fails it is never shown, so no device or file can paint an unreadable or clashing venue.
//
// PURE, ZERO imports (the planPolicy.ts / planGoal.ts precedent), so the picker, the store's setter and the sink take the
// palette one way. Math.pow and Math.cbrt appear here (the sRGB curve, Lab) — no engine imports this file, and its tests
// compare against tolerances and thresholds, never an exact golden (general.md).

export type Venue = 'strike' | 'coinbase' | 'cold';
export const VENUES: readonly Venue[] = Object.freeze(['strike', 'coinbase', 'cold'] as const);

/**
 * The synced pref (`venueColors`, a PREFS field): only the venues the owner changed, each a lowercase '#rrggbb'.
 * Three states, like the plan's fold (absent = seed, empty = an event):
 *  - undefined — never set on this device. JSON drops it, so it is never published, exported or snapshotted, and a
 *    device that never chose can't reset the colours another device chose (hydratePrefs skips an absent key).
 *  - {}        — the defaults, chosen ("Back to the default colours"): published, so every device resets.
 *  - { … }     — the chosen colours; a venue set back to its default drops its key.
 * A pick of the colour a venue already wears writes nothing, so a device stays "never chose" until it changes one. On
 * the way in (a prefs object, a trusted snapshot, a backup) the pref lands only as a plain object, as it is
 * (`incomingVenueColors`); anything else is skipped like an absent key. The sink cleans and checks what it shows.
 */
export type VenueColors = Partial<Record<Venue, string>>;

/** The defaults — equal to tokens.css's `--text-primary`, `--coinbase` and `--btc` (a test reads the stylesheet). */
export const DEFAULT_VENUE_COLORS: Readonly<Record<Venue, string>> = Object.freeze({
  strike: '#e8e8e8', coinbase: '#0052ff', cold: '#f7931a',
});

/** The CSS custom property each venue's marks read (tokens.css defines the defaults). */
export const VENUE_TOKEN: Readonly<Record<Venue, string>> = Object.freeze({
  strike: '--venue-strike', coinbase: '--venue-coinbase', cold: '--venue-cold',
});

export const VENUE_LABEL: Readonly<Record<Venue, string>> = Object.freeze({
  strike: 'Strike', coinbase: 'Coinbase', cold: 'Cold storage',
});

/** The status colours (tokens.css `--green`, `--amber`, `--red`) — Safe/Fair/Poor, warnings, liquidation. */
export const STATUS_COLORS = Object.freeze({ green: '#4ecb82', amber: '#f0a030', red: '#e8504a' });
export type StatusColor = keyof typeof STATUS_COLORS;
const STATUS_ORDER: readonly StatusColor[] = ['green', 'amber', 'red'];
const STATUS_MEANS: Readonly<Record<StatusColor, string>> = Object.freeze({
  green: 'safe', amber: 'caution', red: 'danger',
});

/**
 * Every surface a venue mark sits on (tokens.css): `--bg-app`, `--bg-card`, `--surface` and `--surface-2` — the venue bars'
 * track, and the charts' hover boxes (moved off `--surface-3` for this: the app's own Coinbase blue reads 2.7:1 there).
 * Measured — every element drawn in a venue colour, on every screen that draws one, at rest and in its hover box, sits
 * on one of these. A selected calendar day (`--surface-3`) carries no venue mark: its "CB collateral" dot is bitcoin
 * orange.
 */
export const VENUE_SURFACES: readonly string[] = Object.freeze(['#09090e', '#111318', '#0e1219', '#151b25']);

/** At least 3:1 on every surface — WCAG's floor for graphics and large text, and where the app's own Coinbase blue sits. */
export const READABLE_MIN = 3;
/** At least this far (CIEDE2000) from each other venue's colour — the defaults' closest pair, Strike and cold, is 32. */
export const VENUE_APART_MIN = 20;
/** At least this far (CIEDE2000) from green, amber and red — a venue's own default exempt. */
export const STATUS_APART_MIN = 10;

/**
 * The picker's choices beside each venue's own default: six colours, each readable, at least STATUS_APART_MIN from the
 * status colours, and — with the three defaults — at least VENUE_APART_MIN from one another, so any three of them pass.
 * Each also stays clear of the app's other meaningful colours (its greys, maroon and bitcoin orange; §6.2 of the spec).
 */
export const VENUE_SWATCHES: readonly string[] = Object.freeze([
  '#38bdf8', '#a78bfa', '#fb7185', '#2dd4bf', '#facc15', '#a3e635',
]);

/** What a screen reader says for the defaults and the swatches; any other colour reads as its hex. */
const COLOR_NAME: Readonly<Record<string, string>> = Object.freeze({
  '#e8e8e8': 'white', '#0052ff': 'blue', '#f7931a': 'orange',
  '#38bdf8': 'sky blue', '#a78bfa': 'violet', '#fb7185': 'rose', '#2dd4bf': 'teal', '#facc15': 'yellow', '#a3e635': 'lime',
});
export function colorName(hex: string): string {
  const h = normalizeHex(hex);
  return h === null ? hex : (COLOR_NAME[h] ?? h);
}

/** A colour as the app stores it: '#rrggbb' in lowercase; anything else is null. */
export function normalizeHex(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
}

/**
 * The stored pref, cleaned: only the three venues, each with a well-formed colour. Junk — from a hand-edited backup (its
 * validator checks keys, never values), a foreign key, a non-object — is dropped, never applied.
 */
export function cleanVenueColors(v: unknown): VenueColors {
  const out: VenueColors = {};
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return out;
  for (const venue of VENUES) {
    const hex = normalizeHex((v as Record<string, unknown>)[venue]);
    if (hex !== null) out[venue] = hex;
  }
  return out;
}

/**
 * A pref arriving from elsewhere — a prefs object, a trusted viewer's snapshot, a backup: a plain object lands as it is
 * (the sink shows only what the rule passes, and a later version's colours this build can't read travel on untouched —
 * cleaned here, they would read as {}, the defaults chosen, and go out so); anything else (null, a string, an array) is
 * undefined, so the apply skips it like an absent key.
 */
export function incomingVenueColors(v: unknown): VenueColors | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as VenueColors) : undefined;
}

/** Each venue's colour in a cleaned pref, else its default — no rule applied. */
function filled(c: VenueColors): Record<Venue, string> {
  return {
    strike: c.strike ?? DEFAULT_VENUE_COLORS.strike,
    coinbase: c.coinbase ?? DEFAULT_VENUE_COLORS.coinbase,
    cold: c.cold ?? DEFAULT_VENUE_COLORS.cold,
  };
}

/**
 * THE rule at the sink — the chosen colours a stored pref may show. Cleaned first, and a venue at its default is no
 * choice; then every chosen colour the rule refuses against the palette as it stands is dropped — all of them at once,
 * so two venues too close to each other both fall back, and the outcome never depends on which came first — until none
 * is refused (the defaults always pass together: their closest pair is 32 apart). What the setter writes passes as is.
 */
export function resolveVenueColors(v: unknown): VenueColors {
  const chosen = cleanVenueColors(v);
  for (const venue of VENUES) if (chosen[venue] === DEFAULT_VENUE_COLORS[venue]) delete chosen[venue];
  let refused: Venue[];
  do {
    const palette = filled(chosen);
    refused = VENUES.filter((venue) => chosen[venue] !== undefined && checkVenueColor(venue, palette[venue], palette) !== null);
    for (const venue of refused) delete chosen[venue];
  } while (refused.length > 0);
  return chosen;
}

/** The palette in force — what the screens show: each venue's chosen colour the rule lets it show, else its default. */
export function venuePaletteOf(v: unknown): Record<Venue, string> {
  return filled(resolveVenueColors(v));
}

/** True when any venue wears a colour other than its default. */
export function hasCustomVenueColors(v: unknown): boolean {
  const p = venuePaletteOf(v);
  return VENUES.some((venue) => p[venue] !== DEFAULT_VENUE_COLORS[venue]);
}

/**
 * The sink: sets each colour the rule lets the stored pref show (`resolveVenueColors`) on the root style, and removes the
 * property for every other venue, so tokens.css's default applies. Only cleaned values reach CSS — a custom property
 * takes almost any token stream, so an unchecked string here could inject a `url(…)` wherever a venue token feeds a
 * background.
 */
export function applyVenueColors(style: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>, v: unknown): void {
  const c = resolveVenueColors(v);
  for (const venue of VENUES) {
    const hex = c[venue];
    if (hex !== undefined) style.setProperty(VENUE_TOKEN[venue], hex);
    else style.removeProperty(VENUE_TOKEN[venue]);
  }
}

// ── The measures ──────────────────────────────────────────────────────────────────────────────────────────────────

function channel(hex: string, i: number): number {
  return parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
}
function toLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a '#rrggbb'. */
export function relativeLuminance(hex: string): number {
  return 0.2126 * toLinear(channel(hex, 0)) + 0.7152 * toLinear(channel(hex, 1)) + 0.0722 * toLinear(channel(hex, 2));
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

type Lab = readonly [number, number, number];

/** CIE L*a*b* (D65) of a '#rrggbb'. */
export function toLab(hex: string): Lab {
  const r = toLinear(channel(hex, 0));
  const g = toLinear(channel(hex, 1));
  const b = toLinear(channel(hex, 2));
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const RAD = Math.PI / 180;
const POW25_7 = 6103515625;   // 25^7

/** CIEDE2000 colour difference of two Lab colours (Sharma, Wu & Dalal 2005). */
export function deltaE2000Lab(lab1: Lab, lab2: Lab): number {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = Math.pow((C1 + C2) / 2, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + POW25_7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, ap: number) => {
    if (b === 0 && ap === 0) return 0;
    const h = Math.atan2(b, ap) / RAD;
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * RAD);
  const Lbp = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hbp: number;
  if (C1p * C2p === 0) hbp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbp = (h1p + h2p + 360) / 2;
  else hbp = (h1p + h2p - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbp - 30) * RAD) + 0.24 * Math.cos(2 * hbp * RAD)
    + 0.32 * Math.cos((3 * hbp + 6) * RAD) - 0.20 * Math.cos((4 * hbp - 63) * RAD);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Cbp7 = Math.pow(Cbp, 7);
  const Rc = 2 * Math.sqrt(Cbp7 / (Cbp7 + POW25_7));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp;
  const Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * RAD) * Rc;
  const l = dLp / Sl;
  const c = dCp / Sc;
  const h = dHp / Sh;
  return Math.sqrt(l * l + c * c + h * h + Rt * c * h);
}

/** CIEDE2000 colour difference of two '#rrggbb' colours. */
export function deltaE2000(a: string, b: string): number {
  return deltaE2000Lab(toLab(a), toLab(b));
}

// ── The rule ──────────────────────────────────────────────────────────────────────────────────────────────────────

export type VenueRefusal =
  | { kind: 'malformed' }
  | { kind: 'unreadable'; ratio: number }
  | { kind: 'venue'; other: Venue; deltaE: number }
  | { kind: 'status'; status: StatusColor; deltaE: number };

/** The lowest contrast a colour has on any venue surface. */
export function venueContrastOf(hex: string): number {
  return Math.min(...VENUE_SURFACES.map((s) => contrastRatio(hex, s)));
}

/**
 * THE check, for `color` as `venue`'s colour while the other venues wear `palette`'s: null when it passes, else the first
 * reason it fails — unreadable, then too close to another venue, then too close to a status colour.
 */
export function checkVenueColor(venue: Venue, color: string, palette: Readonly<Record<Venue, string>>): VenueRefusal | null {
  const hex = normalizeHex(color);
  if (hex === null) return { kind: 'malformed' };
  const ratio = venueContrastOf(hex);
  if (ratio < READABLE_MIN) return { kind: 'unreadable', ratio };
  const others = filled(cleanVenueColors(palette));   // as given (the callers pass the palette in force); a malformed entry reads as its default
  for (const other of VENUES) {
    if (other === venue) continue;
    const dE = deltaE2000(hex, others[other]);
    if (dE < VENUE_APART_MIN) return { kind: 'venue', other, deltaE: dE };
  }
  if (hex !== DEFAULT_VENUE_COLORS[venue]) {
    for (const status of STATUS_ORDER) {
      const dE = deltaE2000(hex, STATUS_COLORS[status]);
      if (dE < STATUS_APART_MIN) return { kind: 'status', status, deltaE: dE };
    }
  }
  return null;
}

/** The refusal in words, for the line under the venue's row. */
export function refusalText(r: VenueRefusal): string {
  switch (r.kind) {
    case 'malformed': return 'That isn’t a color the app can use.';
    case 'unreadable': return 'Too dark to read on the app’s background.';
    case 'venue': return `Too close to ${VENUE_LABEL[r.other]}’s color.`;
    case 'status': return `Too close to the app’s ${r.status}, which means ${STATUS_MEANS[r.status]}.`;
  }
}
