import { useState, useRef, useMemo } from 'react';
import { useStore } from '../../store/useStore';
import styles from './ConverterMain.module.css';

const SATS_PER_BTC = 100_000_000;

type ActiveField = 'sats' | 'btc' | 'usd';

function fmtSats(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtBtc(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '');
}

function fmtUsdLocal(n: number): string {
  if (n < 0.01) return '$' + n.toFixed(6);
  if (n < 1)    return '$' + n.toFixed(4);
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

interface ConverterFieldProps {
  label: string;
  unit: string;
  prefix?: string;
  active: boolean;
  displayValue: string;
  rawValue:     string;
  onFocus: () => void;
  onBlurField?: () => void;
  onChange: (v: string) => void;
}

function ConverterField({ label, unit, prefix, active, displayValue, rawValue, onFocus, onBlurField, onChange }: ConverterFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className={`${styles.field} ${active ? styles.fieldActive : ''}`}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldInputRow}>
        {prefix && <span className={styles.fieldPrefix}>{prefix}</span>}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          className={styles.fieldInput}
          value={isFocused ? rawValue : displayValue}
          onFocus={() => { setIsFocused(true); onFocus(); }}
          onBlur={() => { setIsFocused(false); onBlurField?.(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') inputRef.current?.blur(); }}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className={styles.fieldUnit}>{unit}</span>
      </div>
    </div>
  );
}

export function ConverterMain() {
  const btcPrice = useStore((s) => s.btcPrice);
  const setStoredActiveField = useStore((s) => s.setConverterActiveField);
  const setStoredRawValue    = useStore((s) => s.setConverterRawValue);

  const [activeField, setActiveField] = useState<ActiveField>(
    () => useStore.getState().converterActiveField
  );
  const [rawValue, setRawValue] = useState<string>(
    () => useStore.getState().converterRawValue
  );

  const updateActiveField = (field: ActiveField) => {
    setActiveField(field);
    setStoredActiveField(field);
  };
  const updateRawValue = (value: string) => {
    setRawValue(value);
    setStoredRawValue(value);
  };

  const { sats, btc, usd } = useMemo(() => {
    const n = parseFloat(rawValue) || 0;
    if (activeField === 'sats') {
      return { sats: n, btc: n / SATS_PER_BTC, usd: (n / SATS_PER_BTC) * btcPrice };
    }
    if (activeField === 'btc') {
      return { sats: n * SATS_PER_BTC, btc: n, usd: n * btcPrice };
    }
    return { sats: (n / btcPrice) * SATS_PER_BTC, btc: n / btcPrice, usd: n };
  }, [activeField, rawValue, btcPrice]);

  return (
    <div className={styles.main}>
      <div className={styles.header}>
        <h2 className={styles.title}>Satoshi Converter</h2>
        <p className={styles.subtitle}>
          1 BTC = 100,000,000 satoshis. Edit any field to convert.
        </p>
      </div>

      <div className={styles.converterCard}>
        <ConverterField
          label="SATOSHIS"
          unit="SATS"
          prefix="丰"
          active={activeField === 'sats'}
          rawValue={rawValue}
          displayValue={fmtSats(sats)}
          onFocus={() => { updateActiveField('sats'); updateRawValue(String(Math.round(sats))); }}
          onChange={(v) => updateRawValue(v)}
        />

        <div className={styles.divider}><span className={styles.dividerIcon}>⇅</span></div>

        <ConverterField
          label="BITCOIN"
          unit="BTC"
          prefix="₿"
          active={activeField === 'btc'}
          rawValue={rawValue}
          displayValue={fmtBtc(btc)}
          onFocus={() => { updateActiveField('btc'); updateRawValue(String(btc)); }}
          onChange={(v) => updateRawValue(v)}
        />

        <div className={styles.divider}><span className={styles.dividerIcon}>⇅</span></div>

        <ConverterField
          label="US DOLLAR"
          unit="USD"
          prefix="$"
          active={activeField === 'usd'}
          rawValue={rawValue}
          displayValue={fmtUsdLocal(usd).replace(/^\$/, '')}
          onFocus={() => { updateActiveField('usd'); updateRawValue(String(usd)); }}
          onChange={(v) => updateRawValue(v)}
        />
      </div>

      <div className={styles.tableCard}>
        <h3 className={styles.tableTitle}>Satoshi to USD Rates (Live)</h3>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Satoshis</th>
              <th>Bitcoin</th>
              <th>US Dollar</th>
            </tr>
          </thead>
          <tbody>
            {[1, 10, 100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000].map((s) => (
              <tr key={s} onClick={() => { updateActiveField('sats'); updateRawValue(String(s)); }}>
                <td>{s.toLocaleString()} {s === 1 ? 'Satoshi' : 'Satoshis'}</td>
                <td>{(s / SATS_PER_BTC).toFixed(8)} BTC</td>
                <td>{fmtUsdLocal((s / SATS_PER_BTC) * btcPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
