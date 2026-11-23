// Step 0 of the Engine (BL61; spec `pbloc-spec-cycle-clock-leg-v1`) — the two Clocks name the leg the idealized
// cadence is on. After a low it RISES toward the next high ("Rising phase · floor → peak"); after a high it DESCENDS
// toward the next low ("Descending phase · peak → floor"). They paired the last high with the next low, so from the
// 5 Oct 2026 low they counted down to the Sep 2030 floor and read "descending". ONE rule (`cycleLegAt`), ONE view
// (`cycleLegView`); the dial's screen-reader line says what its hand shows, the halving epoch. ⚠ Synthetic height.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { cycleLegView } from '../cycleClockView';
import CycleClock from '../CycleClock';
import HalvingClock from '../HalvingClock';
import CycleDial from '../CycleDial';
import clock from '../CycleClock.module.css';

const AFTER_LOW = Date.UTC(2026, 10, 22, 12); // 48½ days after the 5 Oct 2026 low
const IN_BEAR = Date.UTC(2026, 2, 1); // 146 days after the 6 Oct 2025 high
const LATER_FALL = Date.UTC(2030, 2, 1); // 179 days after the 3 Sep 2029 high — a fall after the first
const H = 925_000; // a height inside epoch 5 (synthetic)

const at = (ms: number) => { vi.useFakeTimers(); vi.setSystemTime(ms); };
// The text as read: tags out, entities back, spaces collapsed, none before a comma or a full stop.
const words = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ').replace(/ ([,.])/g, '$1');
// The Cycle Clock reads `document.hidden` once (usePageVisibility's first state); no effect runs in a static render.
const cycleClockHtml = () => {
  vi.stubGlobal('document', { hidden: false });
  return renderToStaticMarkup(<CycleClock height={H} mode="estimated" onSwitchToHalving={() => {}} />);
};
const cycleClock = () => words(cycleClockHtml());

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cycleLegView — the leg in words', () => {
  it('⭐ LEG WORDS — after a low: rising, floor → peak, the peak ahead', () => {
    expect(cycleLegView(AFTER_LOW)).toEqual({
      rising: true, phase: 'Rising phase', route: 'floor → peak', pct: 5,
      prev: { date: Date.UTC(2026, 9, 5), word: 'floor', kind: 'low' },
      next: { date: Date.UTC(2029, 8, 3), word: 'peak', kind: 'high' },
    });
  });

  it('⭐ LEG WORDS — inside a bear: descending, peak → floor, the floor ahead', () => {
    expect(cycleLegView(IN_BEAR)).toEqual({
      rising: false, phase: 'Descending phase', route: 'peak → floor', pct: 40,
      prev: { date: Date.UTC(2025, 9, 6), word: 'peak', kind: 'high' },
      next: { date: Date.UTC(2026, 9, 5), word: 'floor', kind: 'low' },
    });
  });

  it('is null where the projection has no leg', () => {
    expect(cycleLegView(Date.UTC(2025, 9, 5))).toBeNull();
  });
});

describe('the Cycle Clock', () => {
  it('⭐ CLOCK LEG — after a low it counts down to the projected peak and says it is rising', () => {
    at(AFTER_LOW);
    const t = cycleClock();
    for (const w of ['Projected peak 1015d 12:00:00 ~ Mon 3 Sep 2029', 'Rising phase ~5% floor → peak', 'Since proj. floor 48d 5 Oct 2026 low']) {
      expect(t).toContain(w);
    }
    for (const w of ['Projected floor', 'Descending phase', 'peak → floor', 'Since proj. peak']) expect(t).not.toContain(w);
    // The hues follow the leg: the turn ahead and the phase in the peak's amber, the floor behind in maroon.
    const html = cycleClockHtml();
    expect(html).toContain(`class="${clock.eyebrow} ${clock.eyebrowPeak}"`);
    expect(html).toContain(`class="${clock.v} ${clock.vAmber}">~5%`);
    expect(html).toContain(`class="${clock.v} ${clock.vMaroon}">48d`);
  });

  it('⭐ CLOCK LEG — inside a bear it counts down to the projected floor, as before', () => {
    at(IN_BEAR);
    const t = cycleClock();
    for (const w of ['Projected floor 218d 00:00:00 ~ Mon 5 Oct 2026', 'Descending phase ~40% peak → floor', 'Since proj. peak 146d 6 Oct 2025 high']) {
      expect(t).toContain(w);
    }
    expect(t).not.toContain('Rising phase');
    const html = cycleClockHtml();
    expect(html).toContain(`class="${clock.eyebrow}">`);
    expect(html).toContain(`class="${clock.v} ${clock.vMaroon}">~40%`);
    expect(html).toContain(`class="${clock.v} ${clock.vAmber}">146d`);
  });

  it("⭐ CLOCK LEG — in a later fall the turn behind is that leg's own peak, not main's hard-coded 6 Oct 2025", () => {
    at(LATER_FALL);
    const t = cycleClock();
    for (const w of ['Projected floor 185d 00:00:00 ~ Mon 2 Sep 2030', 'Descending phase ~49% peak → floor', 'Since proj. peak 179d 3 Sep 2029 high']) {
      expect(t).toContain(w);
    }
  });
});

describe("the Halving Clock's pattern card", () => {
  it('⭐ CARD LEG — after a low: a peak ahead, a floor behind, rising', () => {
    at(AFTER_LOW);
    const t = words(renderToStaticMarkup(<HalvingClock height={H} mode="estimated" />));
    expect(t).toContain('Pattern suggests a peak ~Sep 2029 — the cadence last printed a floor in Oct 2026, just behind where we are now.');
    expect(t).toContain("Oct '26 floor rising · ~5% Sep '29 peak");
    expect(t).not.toContain('descending');
  });

  it('⭐ CARD LEG — inside a bear: a floor ahead, a peak behind, descending', () => {
    at(IN_BEAR);
    const t = words(renderToStaticMarkup(<HalvingClock height={H} mode="estimated" />));
    expect(t).toContain('Pattern suggests a floor ~Oct 2026 — the cadence last printed a peak in Oct 2025, just behind where we are now.');
    expect(t).toContain("Oct '25 peak descending · ~40% Oct '26 floor");
  });

  it("⭐ CARD LEG — in a later fall: a floor ahead, that leg's own peak behind, descending", () => {
    at(LATER_FALL);
    const t = words(renderToStaticMarkup(<HalvingClock height={H} mode="estimated" />));
    expect(t).toContain('Pattern suggests a floor ~Sep 2030 — the cadence last printed a peak in Sep 2029, just behind where we are now.');
    expect(t).toContain("Sep '29 peak descending · ~49% Sep '30 floor");
  });
});

describe('the dial', () => {
  it("⭐ DIAL WORDS — on the Cycle Clock its screen-reader line says what the hand shows: the halving epoch's progress", () => {
    const html = renderToStaticMarkup(<CycleDial height={H} mode="estimated" emphasis="cycle" />);
    const said = /aria-valuetext="([^"]*)"/.exec(html)![1];
    expect(said).toMatch(/^Epoch 5, \d+% complete/);
    expect(said).not.toContain('descending');
    expect(said).toContain('idealized (estimated)');
  });
});
