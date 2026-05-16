import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ReferenceLine,
} from 'recharts';
import { useSimulation } from '../../hooks/useSimulation';
import styles from './LTVSafetyChart.module.css';

export function LTVSafetyChart() {
  const { blocData } = useSimulation();

  const chartData = blocData.map((b) => ({
    month: b.month,
    ltv:      b.ltv      * 100,
    crashLTV: b.crashLTV * 100,
  }));

  return (
    <div className={styles.container}>
      <span className={styles.title}>LTV Safety</span>
      <span className={styles.sub}>Working LTV and simulated 80% crash LTV over time</span>

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
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            width={36}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-focus)',
              borderRadius: '8px',
              fontSize: '11px',
            }}
            formatter={(value: number) => [`${value.toFixed(1)}%`]}
            labelFormatter={(label: number) => `Month ${label}`}
          />
          <ReferenceLine y={15}  stroke="var(--green)" strokeDasharray="4 2" label={{ value: '15% ceiling', fontSize: 8, fill: 'var(--green)', position: 'insideTopRight' }} />
          <ReferenceLine y={70}  stroke="var(--amber)" strokeDasharray="4 2" label={{ value: '70% margin call', fontSize: 8, fill: 'var(--amber)', position: 'insideTopRight' }} />
          <ReferenceLine y={85}  stroke="var(--red)"   strokeDasharray="4 2" label={{ value: '85% liquidation', fontSize: 8, fill: 'var(--red)', position: 'insideTopRight' }} />
          <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} />
          <Line
            type="monotone"
            dataKey="ltv"
            name="Working LTV"
            stroke="#378ADD"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="crashLTV"
            name="80% Crash LTV"
            stroke="var(--amber)"
            strokeWidth={1.5}
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
