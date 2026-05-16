import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';
import { useSimulation } from '../../hooks/useSimulation';
import { fmtUSD } from '../../utils/format';
import styles from './NetEquityChart.module.css';

export function NetEquityChart() {
  const { blocData } = useSimulation();

  const chartData = blocData.map((b) => ({
    month: b.month,
    portfolio: b.portfolioValue,
    bloc: b.loc,
  }));

  return (
    <div className={styles.container}>
      <span className={styles.title}>Portfolio Value vs. BLOC Balance</span>
      <span className={styles.sub}>The growing gap between these lines is your net equity</span>

      <ResponsiveContainer width="100%" height={200}>
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
            tickFormatter={(v: number) => v >= 1_000_000 ? '$' + (v / 1_000_000).toFixed(1) + 'M' : v >= 1_000 ? '$' + Math.round(v / 1_000) + 'k' : '$' + v}
            width={52}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-focus)',
              borderRadius: '8px',
              fontSize: '11px',
            }}
            formatter={(value: number) => [fmtUSD(value)]}
            labelFormatter={(label: number) => `Month ${label}`}
          />
          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
          <Line
            type="monotone"
            dataKey="portfolio"
            name="Portfolio Value"
            stroke="var(--green)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="bloc"
            name="BLOC Balance"
            stroke="var(--red)"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
