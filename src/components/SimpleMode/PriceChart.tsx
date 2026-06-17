import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';
import { useBtcHistory, type ChartRange } from '../../hooks/useBtcHistory';
import { fmtUSD } from '../../utils/format';
import styles from './PriceChart.module.css';

const RANGES: ChartRange[] = ['1H', '1D', '1W'];

function fmtTime(t: number, range: ChartRange): string {
  const d = new Date(t);
  return range === '1W'
    ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

export function PriceChart() {
  const [range, setRange] = useState<ChartRange>('1D');
  const { candles, loading, error } = useBtcHistory(range);

  const hasData  = candles.length >= 2;
  const first    = hasData ? candles[0].price : 0;
  const last     = hasData ? candles[candles.length - 1].price : 0;
  const changePct = hasData && first > 0 ? ((last - first) / first) * 100 : 0;
  const up       = changePct >= 0;
  const color    = up ? 'var(--green)' : 'var(--red)';

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <div className={styles.readout}>
          {hasData ? (
            <>
              <span className={styles.price}>{fmtUSD(last)}</span>
              <span className={styles.change} style={{ color }}>
                {up ? '+' : ''}{changePct.toFixed(2)}% ({range})
              </span>
            </>
          ) : (
            <span className={styles.price}>BTC</span>
          )}
        </div>
        <div className={styles.pills}>
          {RANGES.map((r) => (
            <button
              key={r}
              className={`${styles.pill} ${r === range ? styles.pillActive : ''}`}
              onClick={() => setRange(r)}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.chartArea}>
        {hasData ? (
          <ResponsiveContainer width="100%" height={120}>
            <AreaChart data={candles} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%"   stopColor={color} stopOpacity={0.22} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="t" hide />
              <YAxis hide domain={[(min: number) => min * 0.999, (max: number) => max * 1.001]} />
              <Tooltip
                contentStyle={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '11px',
                }}
                labelFormatter={(t: number) => fmtTime(t, range)}
                formatter={(value: number) => [fmtUSD(value), 'BTC']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={color}
                strokeWidth={2}
                fill="url(#priceFill)"
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className={styles.placeholder}>
            {loading ? 'loading…' : error ? 'price history unavailable' : '—'}
          </div>
        )}
      </div>
    </div>
  );
}
