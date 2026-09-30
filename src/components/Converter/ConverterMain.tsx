import { useState, useRef, useMemo, useId } from 'react';
import { useStore } from '../../store/useStore';
import { SATS_PER_BTC, fmtUsdLocal, rateRows } from './converterView';
import styles from './ConverterMain.module.css';

type ActiveField = 'sats' | 'btc' | 'usd';

function fmtSats(n: number): string {
  return Math.round(n).toLocaleString();
}

function fmtBtc(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, '');
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
  // S2 (spec pbloc-spec-sats-rates-v1): a rates row fills the converter through the fields' OWN updates — the state and
  // the store together. A row that wrote only the store changed nothing on screen: this component reads the store only
  // in its useState initialisers above.
  const fillFromRate = (sats: number) => {
    updateActiveField('sats');
    updateRawValue(String(sats));
  };
  const rates = useMemo(() => rateRows(btcPrice), [btcPrice]);
  const ratesTitleId = useId();

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

      {/* The Satoshi Rates — its own card under the converter it feeds (spec pbloc-spec-sats-rates-v1; it was the
          sidebar's last section). The cells print rateRows' text; a row (tap, click, or Enter / Space) fills the
          converter. */}
      <section className={styles.ratesCard} aria-labelledby={ratesTitleId}>
        <h3 id={ratesTitleId} className={styles.ratesTitle}>Satoshi Rates</h3>
        <div className={styles.ratesScroll}>
          <table className={styles.ratesTable}>
            <thead>
              <tr>
                <th>Satoshis</th>
                <th>Bitcoin</th>
                <th>US Dollar</th>
              </tr>
            </thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.sats} role="button" tabIndex={0}
                  onClick={() => fillFromRate(r.sats)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fillFromRate(r.sats); } }}>
                  <td>{r.satsText}</td>
                  <td>{r.btcText}</td>
                  <td>{r.usdText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
