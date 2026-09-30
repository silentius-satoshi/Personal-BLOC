import { useCallback, useId, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
  ResponsiveContainer,
  Customized,
} from 'recharts';
import { PricePoint, BandPoint } from '../../hooks/usePowerLawData';
import {
  timeTicks, tickDensity, fmtTimeTick, logTicks, priceTickFormatter, type Domain, type Scales, type View,
} from '../../lib/chartZoom';
import { useChartZoom } from '../../hooks/useChartZoom';
import { ChartZoomFrame } from '../ui/ChartZoomFrame';
import { PL_SERIES, powerLawTooltip, historyDrawn, legendEntries, type PlSeriesKey } from './powerLawView';
import styles from './PowerLawChart.module.css';

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

const isSeriesKey = (k: string): k is PlSeriesKey => PL_SERIES.some((s) => s.key === k);

/** The Decision chart's token tooltip. The head (the row's UTC date) and every row come from `powerLawTooltip`. */
function PowerLawTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length || typeof label !== 'number') return null;
  const values: Partial<Record<PlSeriesKey, number>> = {};
  for (const p of payload) if (isSeriesKey(p.dataKey)) values[p.dataKey] = p.value;
  const tip = powerLawTooltip(label, values);
  if (!tip) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipHead}>{tip.head}</div>
      {tip.rows.map((r) => (
        <div key={r.key} className={styles.tooltipRow}>
          <span style={{ color: r.color }}>{r.label}</span>
          <strong>{r.text}</strong>
        </div>
      ))}
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

  // A per-mount gradient id — PriceChart's `priceFill` is a document-global SVG id, so a literal one could collide.
  const uid = useId();
  const gradientId = `powerLawHistory${uid.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  // One "Today" per mount: a timestamp taken in the render would move on every re-render (every pan and pinch).
  const [todayT] = useState(() => Date.now());
  // The legend lists only what is drawn (P3): History once two rows carry a positive price, and the three bands.
  const legend = useMemo(() => legendEntries(historyDrawn(chartData)), [chartData]);
  const history = PL_SERIES.find((s) => s.key === 'price')!;
  const bandSeries = PL_SERIES.filter((s) => s.key !== 'price');

  return (
    <div className={styles.chart}>
      <div className={styles.chartBox} data-testid="powerlaw-chart-box">
        <ChartZoomFrame zoom={zoom}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={history.color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={history.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--line-2)" vertical={false} />
              <XAxis
                dataKey="timestamp"
                scale="time"
                type="number"
                domain={zoom.view.x}
                ticks={xAxis.ticks}
                allowDataOverflow
                tickFormatter={fmtDate}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                scale="log"
                domain={zoom.view.y}
                ticks={yTicks}
                allowDataOverflow
                tickFormatter={fmtPrice}
                tick={{ fontSize: 10, fill: 'var(--text-muted)' }}
                axisLine={false}
                tickLine={false}
                width={52}
              />
              <Tooltip content={<PowerLawTooltip />} active={zoom.dragging ? false : undefined} />

              {/* History first, so the bands draw over its fill. Never animated: an animated series would trail the
                  bands on every pan or pinch (P2). */}
              <Area
                dataKey="price"
                name={history.label}
                type="monotone"
                baseValue="dataMin"
                stroke={history.color}
                strokeWidth={1.5}
                fill={`url(#${gradientId})`}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
              {bandSeries.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={1.5}
                  strokeDasharray={s.dash === 'dashed' ? '4 2' : undefined}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}

              <ReferenceLine
                x={todayT}
                stroke="var(--text-faint)"
                strokeDasharray="2 2"
                label={{ value: 'Today', fill: 'var(--text-muted)', fontSize: 10, position: 'insideTopRight' }}
              />
              <Customized component={zoom.probe} />
            </ComposedChart>
          </ResponsiveContainer>
        </ChartZoomFrame>
      </div>
      <div className={styles.legend} data-testid="powerlaw-legend">
        {legend.map((s) => (
          <span key={s.key} className={styles.legendItem} style={{ color: s.color }}>
            <i className={`${styles.legendSwatch} ${s.dash === 'dashed' ? styles.legendDash : ''}`} />{s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading and error: the chart's own box at the chart's height, so the box keeps its place when the chart arrives.
 * The swatch line under it appears only then.
 */
export function PowerLawChartEmpty({ text }: { text: string }) {
  return <div className={styles.chartEmpty}>{text}</div>;
}
