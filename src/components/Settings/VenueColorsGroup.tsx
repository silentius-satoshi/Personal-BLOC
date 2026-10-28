import { useState } from 'react';
import { useStore } from '../../store/useStore';
import {
  VENUES, VENUE_LABEL, VENUE_TOKEN, VENUE_SWATCHES, DEFAULT_VENUE_COLORS,
  venuePaletteOf, checkVenueColor, refusalText, hasCustomVenueColors, colorName, type Venue,
} from '../../lib/venueColors';
import css from './VenueColorsGroup.module.css';

type PickFn = (venue: Venue, color: string) => void;

/**
 * BL15 (Customization) — the venue colours, on Settings → Customization (owner only). Each venue: its own default and
 * six swatches — the only choices. Every pick goes through THE rule (lib/venueColors `checkVenueColor`, against the other
 * venues' colours now): a swatch the rule refuses for that venue shows dimmed, its reason in its label, and a tap on it
 * changes nothing and says why under its row. "Back to the default colors" writes {}. The store's setter applies the
 * same rule, so no screen can store a colour this page would refuse.
 */
export function VenueColorsGroup({ styles }: { styles: Record<string, string> }) {
  const venueColors = useStore((s) => s.venueColors);
  const setVenueColor = useStore((s) => s.setVenueColor);
  const resetVenueColors = useStore((s) => s.resetVenueColors);
  const palette = venuePaletteOf(venueColors);
  const [refused, setRefused] = useState<{ venue: Venue; text: string } | null>(null);

  const pick: PickFn = (venue, color) => {
    const r = checkVenueColor(venue, color, palette);
    if (r !== null) {
      setRefused({ venue, text: refusalText(r) });
      return;
    }
    setRefused(null);
    setVenueColor(venue, color);
  };

  return (
    <div className={styles.setupGroup}>
      <div className={styles.setupGroupLabel}>VENUE COLORS</div>
      <div className={css.desc}>
        The color each venue wears across the app — its dots, bars, chart lines and name. Your other devices follow.
      </div>
      <div className={css.preview} aria-hidden="true">
        {VENUES.map((v) => <span key={v} className={css.previewSeg} style={{ background: `var(${VENUE_TOKEN[v]})` }} />)}
      </div>
      {VENUES.map((venue) => (
        <div key={venue} className={css.row} data-venue={venue}>
          <div className={css.rowHead}>
            <span className={css.dot} style={{ background: `var(${VENUE_TOKEN[venue]})` }} />
            <span className={css.name}>{VENUE_LABEL[venue]}</span>
          </div>
          <div className={css.swatches} role="group" aria-label={`${VENUE_LABEL[venue]} color`}>
            {[DEFAULT_VENUE_COLORS[venue], ...VENUE_SWATCHES].map((c) => {
              const current = palette[venue] === c;
              const why = current ? null : checkVenueColor(venue, c, palette);
              const name = `${VENUE_LABEL[venue]}: ${colorName(c)}${c === DEFAULT_VENUE_COLORS[venue] ? ' (default)' : ''}`;
              return (
                <button
                  key={c}
                  type="button"
                  className={`${css.swatch}${current ? ` ${css.current}` : ''}${why ? ` ${css.refused}` : ''}`}
                  style={{ background: c }}
                  aria-pressed={current}
                  aria-label={why ? `${name} — ${refusalText(why)}` : name}
                  title={why ? refusalText(why) : undefined}
                  onClick={() => pick(venue, c)}
                />
              );
            })}
          </div>
          {refused?.venue === venue && <div className={css.refusal} role="status">{refused.text}</div>}
        </div>
      ))}
      <button
        type="button"
        className={css.reset}
        disabled={!hasCustomVenueColors(venueColors)}
        onClick={() => { setRefused(null); resetVenueColors(); }}
      >
        Back to the default colors
      </button>
    </div>
  );
}
