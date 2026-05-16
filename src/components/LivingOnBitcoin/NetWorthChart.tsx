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

function computeYTicks(minValue: number, maxValue: number): number[] {
  const niceSteps = [
    2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
    200_000, 400_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
  ];

  const anchorAtZero = minValue < maxValue * 0.25;
  const effectiveMin = anchorAtZero ? 0 : minValue;
  const range = maxValue - effectiveMin;

  const step = niceSteps.find((s) => {
    const count = Math.ceil(range / s);
    return count >= 5 && count <= 12;
  }) ?? 5_000_000;

  const minTick = anchorAtZero
    ? 0
    : Math.floor(minValue / step) * step;
  const maxTick = Math.ceil(maxValue / step) * step;

  const ticks: number[] = [];
  for (let v = minTick; v <= maxTick; v += step) ticks.push(v);
  return ticks;
}

export function NetWorthChart({ noBtcResult, sellToLive, smartBloc, maxLeverage, inflationRate }: Props) {
  const data = buildChartData(noBtcResult, sellToLive, smartBloc, maxLeverage);

  const allStrategies = [noBtcResult, sellToLive, smartBloc, maxLeverage];
  const minNetWorth = Math.min(
    ...allStrategies.flatMap((s) => s.monthlyData.map((d) => d.netWorthReal))
  );
  const maxNetWorth = Math.max(
    ...allStrategies.flatMap((s) => s.monthlyData.map((d) => d.netWorthReal))
  );
  const yTicks = computeYTicks(minNetWorth, maxNetWorth);

  const timeHorizonMonths = data.length - 1;

  const xInterval =
    timeHorizonMonths <= 12  ? 0  :
    timeHorizonMonths <= 24  ? 1  :
    timeHorizonMonths <= 36  ? 2  :
    timeHorizonMonths <= 60  ? 5  :
    timeHorizonMonths <= 96  ? 8  :
    11;

  const useMoFormat = timeHorizonMonths <= 24;

  const xTickFormatter = (month: number): string => {
    if (month === 0) return 'Start';
    if (useMoFormat) return `Mo ${month}`;
    return `Yr ${(month / 12).toFixed(1)}`;
  };

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
            tickFormatter={xTickFormatter}
            interval={xInterval}
            tick={{ fontSize: 9, fill: '#555555' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            ticks={yTicks}
            domain={[yTicks[0], yTicks[yTicks.length - 1]]}
            tickFormatter={(v: number) => '$' + Math.round(v).toLocaleString()}
            tick={{ fontSize: 9, fill: '#555555' }}
            axisLine={false}
            tickLine={false}
            width={80}
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
