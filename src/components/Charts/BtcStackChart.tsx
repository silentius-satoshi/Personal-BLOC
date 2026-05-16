import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useSimulation } from '../../hooks/useSimulation';
import { useStore } from '../../store/useStore';
import { ScenarioPills } from '../ui/ScenarioPills';
import styles from './BtcStackChart.module.css';

function fmtBTC(n: number) {
  return `${n.toFixed(3)} BTC`;
}

function fmtPrice(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `$${Math.round(n / 1000)}k`;
  return `$${Math.round(n)}`;
}

export function BtcStackChart() {
  const { blocData, stsData } = useSimulation();
  const showFoldCC = useStore((s) => s.showFoldCC);

  const chartData = blocData.map((b, i) => ({
    month: b.month,
    bloc: showFoldCC ? b.comb : b.btc,
    sts: stsData[i]?.btc ?? 0,
  }));

  const bloc60 = chartData[60]?.bloc ?? 0;
  const sts60  = chartData[60]?.sts  ?? 0;
  const delta  = bloc60 - sts60;
  const price60 = blocData[60]?.btcPrice ?? 0;
  const fbtc60  = blocData[60]?.fbtc ?? 0;

  const title = showFoldCC
    ? '5-Year BTC Stack: Smart BLOC + Fold CC vs Save the Surplus'
    : '5-Year BTC Stack: Smart BLOC vs Save the Surplus';

  const blocLabel = showFoldCC ? 'Smart BLOC + Fold CC' : 'Smart BLOC';

  return (
    <div className={styles.container}>
      <div className={styles.titleRow}>
        <span className={styles.title}>{title}</span>
        <ScenarioPills />
      </div>

      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="month"
            tick={{ fontSize: 9, fill: 'var(--text-ghost)' }}
            tickLine={false}
            axisLine={false}
            ticks={[0, 12, 24, 36, 48, 60]}
            tickFormatter={(v: number) => `M${v}`}
          />
          <YAxis
            tick={{ fontSize: 9, fill: 'var(--text-ghost)' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v.toFixed(1)}`}
            width={36}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-focus)',
              borderRadius: '8px',
              fontSize: '11px',
            }}
            formatter={(value: number) => [fmtBTC(value)]}
            labelFormatter={(label: number) => `Month ${label}`}
          />
          <Legend
            wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
          />
          <Line
            type="monotone"
            dataKey="bloc"
            name={blocLabel}
            stroke="var(--green)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="sts"
            name="Save the Surplus"
            stroke="#444444"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>

      <div className={styles.summary}>
        At year 5, <strong style={{ color: 'var(--green)' }}>{blocLabel}</strong> accumulates{' '}
        <strong>{fmtBTC(bloc60)}</strong> vs.{' '}
        <strong>{fmtBTC(sts60)}</strong> for Save the Surplus. You're ahead by{' '}
        <strong style={{ color: 'var(--green)' }}>+{fmtBTC(delta)}</strong>{' '}
        (+{fmtPrice(delta * price60)} at year-5 prices).
        {showFoldCC && fbtc60 > 0 && (
          <> Fold CC contributes <strong style={{ color: 'var(--green)' }}>+{fmtBTC(fbtc60)}</strong> of that gain at zero cost.</>
        )}
      </div>
    </div>
  );
}
