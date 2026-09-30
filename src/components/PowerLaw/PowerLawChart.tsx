import { useCallback, useMemo } from 'react';
import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Customized,
} from 'recharts';
import { fmtUSD } from '../../utils/format';
import { PricePoint, BandPoint } from '../../hooks/usePowerLawData';
import {
  timeTicks, tickDensity, fmtTimeTick, logTicks, priceTickFormatter, type Domain, type Scales, type View,
} from '../../lib/chartZoom';
import { useChartZoom } from '../../hooks/useChartZoom';
import { ChartZoomFrame } from '../ui/ChartZoomFrame';

const ONE_DAY = 86_400_000;
/** The price axis's full extent (unchanged); chart zoom narrows it inside. */
const PRICE_DOMAIN: Domain = [0.01, 100_000_000];
/** Dates × log price — the chart-zoom scales (a module constant, so the hook's inputs stay stable). */
const TIME_LOG: Scales = { x: 'linear', y: 'log' };

interface ChartRow {
  timestamp: number;
  price?:   number;
  fair?:    number;
  floor?:   number;
  ceiling?: number;
}

interface TooltipPayloadItem {
  dataKey: string;
  value: number;
  color: string;
}

interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: number;
}

function PowerLawTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload || !label) return null;
  const date = new Date(label);
  const mo   = date.toLocaleString('default', { month: 'short' });
  const yr   = date.getFullYear();

  const get = (key: string) => payload.find((p) => p.dataKey === key)?.value;

  return (
    <div style={{
      background: '#1a1d24',
      border: '1px solid #2a2d38',
      borderRadius: 6,
      padding: '8px 12px',
      fontSize: 11,
      color: '#ccc',
      lineHeight: 1.8,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{mo} {yr}</div>
      {get('ceiling') != null && <div>Resistance: <strong style={{ color: '#E85A4F' }}>{fmtUSD(get('ceiling')!)}</strong></div>}
      {get('fair')    != null && <div>Fair Value: <strong>{fmtUSD(get('fair')!)}</strong></div>}
      {get('floor')   != null && <div>Support:    <strong style={{ color: '#4ECB82' }}>{fmtUSD(get('floor')!)}</strong></div>}
      {get('price')   != null && <div style={{ height: '6px' }} />}
      {get('price')   != null && <div>BTC Price:  <strong style={{ color: '#E8836A' }}>{fmtUSD(get('price')!)}</strong></div>}
    </div>
  );
}

function fmtY(v: number): string {
  if (v >= 1_000_000) return '$' + (v / 1_000_000).toFixed(0) + 'M';
  if (v >= 1_000)     return '$' + (v / 1_000).toFixed(0) + 'k';
  if (v >= 1)         return '$' + v.toFixed(0);
  return '$' + v.toFixed(2);
}

interface Props {
  historical: PricePoint[];
  bands: BandPoint[];
}

export function PowerLawChart({ historical, bands }: Props) {
  const chartData = useMemo<ChartRow[]>(() => {
    const sortedHist = [...historical].sort((a, b) => a.timestamp - b.timestamp);

    return bands
      .map((band) => {
        let lo = 0, hi = sortedHist.length - 1, best: PricePoint | undefined;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          if (!best || Math.abs(sortedHist[mid].timestamp - band.timestamp) <
                       Math.abs(best.timestamp - band.timestamp)) {
            best = sortedHist[mid];
          }
          if (sortedHist[mid].timestamp < band.timestamp) lo = mid + 1;
          else hi = mid - 1;
        }
        const price =
          best && Math.abs(best.timestamp - band.timestamp) <= 4 * ONE_DAY
            ? best.price
            : undefined;

        return {
          timestamp: band.timestamp,
          fair:    band.fair,
          floor:   band.floor,
          ceiling: band.ceiling,
          price,
        };
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [historical, bands]);

  // The full extent — the unzoomed view. Chart zoom narrows the axes; it never touches `chartData`.
  const fullView = useMemo((): View => ({
    x: chartData.length >= 2 ? [chartData[0].timestamp, chartData[chartData.length - 1].timestamp] : [0, ONE_DAY],
    y: PRICE_DOMAIN,
  }), [chartData]);
  const zoom = useChartZoom(fullView, TIME_LOG);
  // Explicit UTC year starts (the auto ticks sat at arbitrary weeks, labelled in local time).
  const xAxis = useMemo(() => timeTicks(zoom.view.x, tickDensity(zoom.plotWidth)), [zoom.view.x, zoom.plotWidth]);
  const yTicks = useMemo(() => logTicks(zoom.view.y), [zoom.view.y]);
  const fmtPrice = useMemo(() => priceTickFormatter(yTicks, fmtY), [yTicks]);
  const fmtDate = useCallback((t: number, i: number) => fmtTimeTick(t, xAxis.unit, i), [xAxis.unit]);

  return (
    <ChartZoomFrame zoom={zoom}>
      <ResponsiveContainer width="100%" height={520}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, bottom: 40, left: 10 }}>
          <XAxis
            dataKey="timestamp"
            scale="time"
            type="number"
            domain={zoom.view.x}
            ticks={xAxis.ticks}
            allowDataOverflow
            tickFormatter={fmtDate}
            tick={{ fontSize: 10, fill: '#666' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            scale="log"
            domain={zoom.view.y}
            ticks={yTicks}
            allowDataOverflow
            tickFormatter={fmtPrice}
            tick={{ fontSize: 10, fill: '#666' }}
            axisLine={false}
            tickLine={false}
            width={70}
          />
          <Tooltip content={<PowerLawTooltip />} active={zoom.dragging ? false : undefined} />

          <Line
            dataKey="ceiling"
            stroke="#E85A4F"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="fair"
            stroke="#CCCCCC"
            strokeWidth={1.5}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="floor"
            stroke="#4ECB82"
            strokeWidth={1.5}
            strokeDasharray="4 2"
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
          <Line
            dataKey="price"
            stroke="#E8836A"
            strokeWidth={2}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />

          <ReferenceLine
            x={Date.now()}
            stroke="#444"
            strokeDasharray="3 3"
            label={{ value: 'Today', fill: '#666', fontSize: 10, position: 'insideTopRight' }}
          />
          <Customized component={zoom.probe} />
        </ComposedChart>
      </ResponsiveContainer>
    </ChartZoomFrame>
  );
}
