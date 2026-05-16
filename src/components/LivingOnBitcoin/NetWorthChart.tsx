import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import type { StrategyResult } from '../../simulation/types';
import { fmtUSD } from '../../utils/format';
import styles from './NetWorthChart.module.css';

interface Props {
  noBtcResult: StrategyResult;
  sellToLive: StrategyResult;
  smartBloc: StrategyResult;
  maxLeverage: StrategyResult;
  inflationRate: number;
}

function buildChartData(
  noBtcResult: StrategyResult,
  sellToLive: StrategyResult,
  smartBloc: StrategyResult,
  maxLeverage: StrategyResult,
) {
  const len = noBtcResult.monthlyData.length;
  return Array.from({ length: len }, (_, i) => ({
    month: i,
    maxLeverage: maxLeverage.monthlyData[i]?.netWorthReal ?? 0,
    smartBloc:   smartBloc.monthlyData[i]?.netWorthReal   ?? 0,
    sellToLive:  sellToLive.monthlyData[i]?.netWorthReal  ?? 0,
    noBtc:       noBtcResult.monthlyData[i]?.netWorthReal ?? 0,
  }));
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className={styles.tooltip}>
      <div className={styles.tooltipMonth}>{label === 0 ? 'Start' : `Mo ${label}`}</div>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className={styles.tooltipRow}>
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span>{fmtUSD(entry.value)}</span>
        </div>
      ))}
    </div>
  );
};

export function NetWorthChart({ noBtcResult, sellToLive, smartBloc, maxLeverage, inflationRate }: Props) {
  const data = buildChartData(noBtcResult, sellToLive, smartBloc, maxLeverage);

  const tickFormatter = (m: number) => m === 0 ? 'Start' : `Mo ${m}`;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div className={styles.title}>Net Worth Over Time</div>
        <div className={styles.subtitle}>real, adjusted for {inflationRate.toFixed(1)}% inflation</div>
      </div>

      <div className={styles.legend}>
        <LegendItem color="#E8836A" label="Max Leverage" dashed={false} />
        <LegendItem color="#4ECB82" label="Smart BLOC" dashed={false} />
        <LegendItem color="#888888" label="Sell to Live" dashed={false} />
        <LegendItem color="#555555" label="No Bitcoin" dashed={true} />
      </div>

      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={data} margin={{ top: 4, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#1E2028" vertical={false} />
          <XAxis
            dataKey="month"
            tickFormatter={tickFormatter}
            tick={{ fontSize: 9, fill: '#555555' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => v >= 1_000_000 ? '$' + (v / 1_000_000).toFixed(1) + 'M' : v >= 1_000 ? '$' + Math.round(v / 1_000) + 'k' : '$' + v}
            tick={{ fontSize: 9, fill: '#555555' }}
            axisLine={false}
            tickLine={false}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="maxLeverage"
            name="Max Leverage"
            stroke="#E8836A"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="smartBloc"
            name="Smart BLOC"
            stroke="#4ECB82"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="sellToLive"
            name="Sell to Live"
            stroke="#888888"
            strokeWidth={1.5}
            dot={false}
            activeDot={{ r: 3 }}
          />
          <Line
            type="monotone"
            dataKey="noBtc"
            name="No Bitcoin"
            stroke="#555555"
            strokeWidth={1.5}
            strokeDasharray="5 3"
            dot={false}
            activeDot={{ r: 3 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function LegendItem({ color, label, dashed }: { color: string; label: string; dashed: boolean }) {
  return (
    <div className={styles.legendItem}>
      <svg width="18" height="10">
        <line
          x1="0" y1="5" x2="18" y2="5"
          stroke={color}
          strokeWidth={dashed ? 1.5 : 2}
          strokeDasharray={dashed ? '5 3' : undefined}
        />
      </svg>
      <span style={{ color }}>{label}</span>
    </div>
  );
}
