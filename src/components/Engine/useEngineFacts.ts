import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../store/useStore';
import { selectSafetyViewInputs, type SafetyViewInputs } from '../../simulation/safetyView';
import { supportToday } from '../../simulation/powerLaw';
import { cycleLegAt } from '../../simulation/cycleModel';
import { cycleLegView } from '../Almanac/cycleClockView';
import { usePlanMonth } from '../Almanac/usePlanMonth';
import { planMoveBringsCbWithin } from '../Almanac/planMonthView';
import { useBtcHistory } from '../../hooks/useBtcHistory';
import { useLivePrice } from '../../hooks/useLivePrice';
import { useNow } from '../../hooks/useClock';
import { STALE_MS } from '../../lib/liveFeed';
import { todayLocalISO } from '../../utils/format';
import type { EngineFacts } from './engineScene';
import type { FeedState } from './engineView';

/**
 * The Engine · Micro (BL61, step 1) — the facts, gathered where the Dashboard and THIS MONTH already gather them. READS
 * ONLY: it writes nothing of its own. (`usePlanMonth` keeps this device's breaker cache, as it does for THIS MONTH and
 * Daily; the app's one live feed keeps the store's price by its own rule — lib/liveBtc.ts, BL64.)
 *
 * - The Dashboard's inputs, exactly as `SafetyDashboard` builds them: `selectSafetyViewInputs` and today's support,
 *   keyed on the day.
 * - THIS MONTH's month: `usePlanMonth`'s run, its month 1 — Daily's `pr1`, the same expression; and whether this month's
 *   move brings Coinbase within its limit at support (`planMoveBringsCbWithin`, as SimpleModeView and Daily tell the
 *   Dashboard — v1.4).
 * - The Cycle Clock's leg, re-read once a minute and when the app is shown again (`useNow`).
 * - The market's last hour (`useBtcHistory('1H')`, the Dashboard chart's 1H) and the live price each second
 *   (`useLivePrice({ perSecond: true })`: while the Engine is open the feed carries Coinbase's per-second channel — BL64).
 */
export function useEngineFacts(): EngineFacts {
  const todayISO = todayLocalISO();
  const support = useMemo(() => supportToday(todayISO), [todayISO]);
  const base = useStore(useShallow(selectSafetyViewInputs));
  const priceMode = useStore((s) => s.btcPriceMode);
  const safety = useMemo<SafetyViewInputs>(() => ({ ...base, supportToday: support }), [base, support]);

  const pm = usePlanMonth();
  const month = pm.run.sim.rows[1] ?? pm.run.sim.last;
  const moveBringsCbWithin = planMoveBringsCbWithin(pm.run.placement);

  const { candles } = useBtcHistory('1H');
  const live = useLivePrice({ perSecond: true });

  const now = useNow(60_000);
  const cycle = useMemo(() => {
    const leg = cycleLegAt(now);
    const view = cycleLegView(now);
    return leg !== null && view !== null ? { leg, view } : null;
  }, [now]);

  const livePrice = live?.price ?? null;
  const liveAt = live?.at ?? null;
  const isStale = live !== null && now - live.at > STALE_MS;
  const feed: FeedState = priceMode === 'manual' ? 'manual' : livePrice === null ? 'off' : isStale ? 'stale' : 'live';
  return useMemo(
    () => ({ safety, month, moveBringsCbWithin, cycle, candles, feed, livePrice, liveAt }),
    [safety, month, moveBringsCbWithin, cycle, candles, feed, livePrice, liveAt],
  );
}
