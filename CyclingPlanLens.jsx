import React, { useState, useMemo, useEffect } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  ReferenceLine, ResponsiveContainer, Tooltip,
} from "recharts";

/* ─────────────────────────────────────────────────────────────
   Cycling Plan Lens — Strike ⇄ Coinbase refinance model
   Income buys bitcoin. Expenses draw the Strike line.
   Strike balance refinances to Coinbase at the lower rate.

   Thresholds are the facilities' own:
     Strike  50 draw cap · 65 warn · 70 call · 85 liquidation
     Coinbase 86 instant liquidation, no cure window
   Power law support: 0.42e-17 × days^5.82 (genesis 3 Jan 2009)
   ───────────────────────────────────────────────────────────── */

const T = {
  bg: "#0d0f12", card: "#15181d", card2: "#1b1f26",
  line: "rgba(255,255,255,.075)", line2: "rgba(255,255,255,.16)",
  txt: "#e6e9ee", mut: "#8b929e", faint: "#5b626d",
  gold: "#d9a441", goldDim: "rgba(217,164,65,.14)",
  green: "#6fce8f", amber: "#e0a83c", red: "#e06c75",
  blue: "#6f9fd8",
};
const MONO = "ui-monospace, 'IBM Plex Mono', 'SF Mono', Menlo, monospace";

/* Position constants — readings, not computed */
const P = {
  strikeCol: 0.96589757,
  strikeBal0: 14106.84,
  strikeApr: 0.13,
  cbCol: 1.7281,
  cbBal0: 62300.0,
  cbApr: 0.05,
};
const STRIKE_DRAW = 0.50;
const STRIKE_LIQ = 0.85;
const CB_LLTV = 0.86;
const POST_TRIGGER = 0.65;
const POST_TO = 0.55;
const RESUME_CAP = 0.60;

const DAYS_NOW = 6450;              // 1 Sep 2026 since genesis
const support = (m) => 0.42e-17 * Math.pow(DAYS_NOW + 30.4375 * m, 5.82);
const SUP0 = support(0);

const usd = (n) => "$" + Math.round(n).toLocaleString("en-US");
const btc = (n, d = 3) => n.toFixed(d) + " ₿";
const pct = (n) => (n * 100).toFixed(1) + "%";

const MONTH0 = new Date(2026, 8, 1);
const label = (m) => {
  const d = new Date(MONTH0.getFullYear(), MONTH0.getMonth() + m, 1);
  return d.toLocaleString("en-US", { month: "short" }) + "-" + String(d.getFullYear()).slice(2);
};

/* ── the simulation ───────────────────────────────────────── */
function simulate({ spot, income, expenses, path, mode, months = 24 }) {
  let cb = P.cbBal0, cbCol = P.cbCol;
  let strike = P.strikeBal0, reserve = 0;
  const out = [];

  const price = (m) => {
    const s = support(m);
    if (path === "flat") return spot;
    if (path === "ride") return spot * (s / SUP0);
    return Math.max(spot, s);                       // converge
  };

  const snap = (m, p, peak, switched) => {
    const sup = support(m);
    const gross = P.strikeCol + cbCol + reserve;
    const debt = cb + strike;
    const cbLtv = cb / (cbCol * p);
    const cbLiq = cb / (CB_LLTV * cbCol);
    const sLtv = peak / (P.strikeCol * p);
    const line = P.strikeCol * p * STRIKE_DRAW;
    return {
      m, label: label(m), price: p, sup, mult: p / sup,
      cb, cbCol, cbLtv, cbLiq,
      cush: 1 - cbLiq / p, vsSup: 1 - cbLiq / sup,
      strike: peak, sLtv, sLiq: peak / (P.strikeCol * STRIKE_LIQ),
      line, avail: line - peak, over: peak > line,
      reserve, gross, debt, net: gross - debt / p, equity: gross * p - debt,
      switched,
      cbLtvPct: +(cbLtv * 100).toFixed(1),
      sLtvPct: +(sLtv * 100).toFixed(1),
      priceK: Math.round(p), liqK: Math.round(cbLiq), supK: Math.round(sup),
    };
  };

  out.push(snap(0, price(0), strike, false));

  for (let m = 1; m <= months; m++) {
    const p = price(m);
    cb *= 1 + P.cbApr / 12;
    strike += expenses;
    strike *= 1 + P.strikeApr / 12;
    const peak = strike;

    const belowSupport = p <= support(m) * 1.0001;
    const switched = mode === "switch" && belowSupport;

    if (switched) {
      reserve += income / p;
      if (cb / (cbCol * p) > POST_TRIGGER && reserve > 0) {
        const need = Math.max(0, cb / (POST_TO * p) - cbCol);
        const post = Math.min(need, reserve);
        cbCol += post; reserve -= post;
      }
    } else {
      cbCol += income / p;
      if (mode === "switch") {
        const room = Math.max(0, RESUME_CAP * cbCol * p - cb);
        const mv = Math.min(strike, room);
        cb += mv; strike -= mv;
      } else {
        cb += strike; strike = 0;
      }
    }
    out.push(snap(m, p, peak, switched));
  }
  return out;
}

/* ── controls ─────────────────────────────────────────────── */
function Slider({ label: lbl, value, onChange, min, max, step, fmt, note }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
        <span style={{ color: T.mut, fontSize: 12 }}>{lbl}</span>
        <span style={{ color: T.gold, fontSize: 14, fontVariantNumeric: "tabular-nums" }}>{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        style={{ width: "100%", accentColor: T.gold, height: 22 }}
      />
      {note && <div style={{ color: T.faint, fontSize: 10.5, marginTop: 3 }}>{note}</div>}
    </div>
  );
}

function Seg({ label: lbl, value, options, onChange }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ color: T.mut, fontSize: 12, marginBottom: 6 }}>{lbl}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {options.map((o) => {
          const on = o.v === value;
          return (
            <button key={o.v} onClick={() => onChange(o.v)} style={{
              flex: "1 1 0", minWidth: 84, minHeight: 40, padding: "8px 6px",
              borderRadius: 9, fontSize: 11.5, fontFamily: MONO, cursor: "pointer",
              background: on ? T.goldDim : "transparent",
              border: `1px solid ${on ? T.gold : T.line2}`,
              color: on ? T.gold : T.mut,
            }}>{o.l}</button>
          );
        })}
      </div>
    </div>
  );
}

function Stat({ k, v, c, sub }) {
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 11, padding: "11px 12px" }}>
      <div style={{ color: T.faint, fontSize: 10.5, marginBottom: 5 }}>{k}</div>
      <div style={{ color: c || T.txt, fontSize: 17, fontVariantNumeric: "tabular-nums", letterSpacing: "-.01em" }}>{v}</div>
      {sub && <div style={{ color: T.faint, fontSize: 10, marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function bandColor(ltv, warn, act) {
  if (ltv >= act) return T.red;
  if (ltv >= warn) return T.amber;
  return T.green;
}

/* ── main ─────────────────────────────────────────────────── */
export default function CyclingPlanLens() {
  const [spot, setSpot] = useState(77000);
  const [income, setIncome] = useState(4300);
  const [expenses, setExpenses] = useState(4000);
  const [path, setPath] = useState("converge");
  const [mode, setMode] = useState("always");
  const [view, setView] = useState("ltv");
  const [month, setMonth] = useState(8);
  const [span, setSpan] = useState(12);
  const [wide, setWide] = useState(false);

  useEffect(() => {
    const f = () => setWide(window.innerWidth >= 900);
    f(); window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);

  const series = useMemo(
    () => simulate({ spot, income, expenses, path, mode }),
    [spot, income, expenses, path, mode]
  );

  const rows = series.slice(0, span + 1);
  const s = series[Math.min(month, span)];
  const now = series[0];

  const worst = rows.reduce((a, b) => (b.cbLtv > a.cbLtv ? b : a), rows[0]);
  const tightest = rows.reduce((a, b) => (b.vsSup < a.vsSup ? b : a), rows[0]);
  const breach = rows.find((r) => r.over);
  const surplus = income - expenses;

  const chartData = rows.map((r) => ({
    m: r.m, label: r.label,
    cbLtvPct: r.cbLtvPct, sLtvPct: r.sLtvPct,
    priceK: r.priceK, liqK: r.liqK, supK: r.supK,
  }));

  const cbC = bandColor(s.cbLtv, 0.65, CB_LLTV);
  const sC = bandColor(s.sLtv, 0.50, 0.70);

  const verdict = () => {
    if (breach) return { t: `Strike line is exhausted by ${breach.label}. The plan stops there — nothing left to draw for expenses.`, c: T.red };
    if (worst.cbLtv >= CB_LLTV) return { t: `Coinbase liquidates in ${worst.label} at ${pct(worst.cbLtv)}. This configuration does not survive.`, c: T.red };
    if (worst.cbLtv >= 0.75) return { t: `Coinbase peaks at ${pct(worst.cbLtv)} in ${worst.label} — inside the zone where new borrowing gets declined.`, c: T.amber };
    if (surplus < 0) return { t: `Expenses exceed income by ${usd(-surplus)}/mo. Debt grows faster than the stack every single month.`, c: T.amber };
    return { t: `Coinbase peaks at ${pct(worst.cbLtv)} in ${worst.label}. Liquidation stays ${pct(tightest.vsSup)} below the support line at its closest.`, c: T.green };
  };
  const v = verdict();

  return (
    <div style={{
      fontFamily: MONO, background: T.bg, color: T.txt,
      padding: "18px 14px 30px", minHeight: "100%",
      display: wide ? "grid" : "block",
      gridTemplateColumns: wide ? "minmax(0,1.25fr) minmax(0,1fr)" : undefined,
      gap: wide ? 24 : 0, alignItems: "start",
    }}>
      <div style={{ minWidth: 0 }}>
        {/* hero — the liquidation price, not the stack */}
        <div style={{ color: T.faint, fontSize: 10.5, letterSpacing: ".14em" }}>
          Coinbase liquidation price · {s.label}
        </div>
        <div style={{
          fontSize: 42, fontWeight: 600, letterSpacing: "-.025em", marginTop: 6,
          color: cbC, fontVariantNumeric: "tabular-nums",
        }}>
          {usd(s.cbLiq)}
        </div>
        <div style={{ color: T.mut, fontSize: 12.5, marginTop: 5, lineHeight: 1.6 }}>
          {pct(s.cush)} below spot of {usd(s.price)} · {pct(s.vsSup)} below the
          support line at {usd(s.sup)}
        </div>

        <div style={{
          marginTop: 14, padding: "10px 12px", borderRadius: 10,
          background: T.card, border: `1px solid ${v.c === T.green ? T.line : v.c}`,
          color: v.c === T.green ? T.mut : v.c, fontSize: 11.5, lineHeight: 1.6,
        }}>{v.t}</div>

        {/* month scrubber */}
        <div style={{ marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
            <span style={{ color: T.mut, fontSize: 12 }}>Month</span>
            <span style={{ color: T.txt, fontSize: 12 }}>
              {s.m} · {s.label}{s.switched ? " · switched" : ""}
            </span>
          </div>
          <input type="range" min={0} max={span} step={1} value={Math.min(month, span)}
            onChange={(e) => setMonth(+e.target.value)}
            style={{ width: "100%", accentColor: T.gold, height: 22 }} />
        </div>

        {/* stat grid */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))",
          gap: 9, marginTop: 14,
        }}>
          <Stat k="Coinbase debt" v={usd(s.cb)} sub={`${btc(s.cbCol)} collateral`} />
          <Stat k="Coinbase LTV" v={pct(s.cbLtv)} c={cbC} sub="86% liquidates instantly" />
          <Stat k="Strike balance" v={usd(s.strike)} sub={`${usd(Math.max(0, s.avail))} left on the line`} />
          <Stat k="Strike LTV" v={pct(s.sLtv)} c={sC} sub="50% draw cap · 85% liquidates" />
          <Stat k="Unpledged reserve" v={btc(s.reserve)} c={s.reserve > 0 ? T.gold : T.faint}
            sub={s.reserve > 0 ? usd(s.reserve * s.price) + " of dry powder" : "every coin is pledged"} />
          <Stat k="Net bitcoin" v={btc(s.net)} c={s.net >= now.net ? T.green : T.red}
            sub={`${s.net >= now.net ? "+" : ""}${(s.net - now.net).toFixed(3)} ₿ vs today`} />
        </div>

        {/* chart */}
        <div style={{ marginTop: 18 }}>
          <Seg label="" value={view} onChange={setView} options={[
            { v: "ltv", l: "Loan-to-value" },
            { v: "price", l: "Price & liquidation" },
          ]} />
          <div style={{ height: 236, background: T.card, borderRadius: 12, border: `1px solid ${T.line}`, padding: "12px 8px 4px 0" }}>
            {view === "ltv" ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                  <CartesianGrid stroke={T.line} vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: T.faint, fontSize: 10 }} stroke={T.line2} />
                  <YAxis tick={{ fill: T.faint, fontSize: 10 }} stroke={T.line2} width={40}
                    domain={[0, 95]} tickFormatter={(x) => x + "%"} />
                  <Tooltip
                    contentStyle={{ background: T.card2, border: `1px solid ${T.line2}`, borderRadius: 9, fontFamily: MONO, fontSize: 11 }}
                    labelStyle={{ color: T.mut }}
                    labelFormatter={(m) => "Month " + m + " · " + label(m)}
                    formatter={(val, name) => [val + "%", name]} />
                  <ReferenceLine y={86} stroke={T.red} strokeDasharray="4 4"
                    label={{ value: "Coinbase liquidation", fill: T.red, fontSize: 9.5, position: "insideTopLeft" }} />
                  <ReferenceLine y={50} stroke={T.blue} strokeDasharray="4 4"
                    label={{ value: "Strike draw cap", fill: T.blue, fontSize: 9.5, position: "insideBottomLeft" }} />
                  <ReferenceLine x={Math.min(month, span)} stroke={T.line2} />
                  <Line type="monotone" dataKey="cbLtvPct" name="Coinbase" stroke={T.gold}
                    strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="sLtvPct" name="Strike" stroke={T.blue}
                    strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 4, right: 12, bottom: 2, left: 4 }}>
                  <CartesianGrid stroke={T.line} vertical={false} />
                  <XAxis dataKey="m" tick={{ fill: T.faint, fontSize: 10 }} stroke={T.line2} />
                  <YAxis tick={{ fill: T.faint, fontSize: 10 }} stroke={T.line2} width={46}
                    domain={["auto", "auto"]} tickFormatter={(x) => "$" + Math.round(x / 1000) + "k"} />
                  <Tooltip
                    contentStyle={{ background: T.card2, border: `1px solid ${T.line2}`, borderRadius: 9, fontFamily: MONO, fontSize: 11 }}
                    labelStyle={{ color: T.mut }}
                    labelFormatter={(m) => "Month " + m + " · " + label(m)}
                    formatter={(val, name) => [usd(val), name]} />
                  <ReferenceLine x={Math.min(month, span)} stroke={T.line2} />
                  <Line type="monotone" dataKey="priceK" name="Bitcoin" stroke={T.txt}
                    strokeWidth={2} dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="supK" name="Support line" stroke={T.faint}
                    strokeWidth={1.5} strokeDasharray="4 4" dot={false} isAnimationActive={false} />
                  <Line type="monotone" dataKey="liqK" name="Liquidation" stroke={T.red}
                    strokeWidth={2} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* right column */}
      <div style={{ minWidth: 0, marginTop: wide ? 0 : 24 }}>
        <div style={{ background: T.card, borderRadius: 13, border: `1px solid ${T.line}`, padding: "15px 14px 6px" }}>
          <Slider label="Monthly income into bitcoin" value={income} onChange={setIncome}
            min={0} max={12000} step={100} fmt={usd}
            note="Bought on Strike, sent to Coinbase as collateral" />
          <Slider label="Monthly expenses on the line" value={expenses} onChange={setExpenses}
            min={0} max={12000} step={100} fmt={usd}
            note="Drawn from Strike, refinanced to Coinbase" />
          <div style={{
            marginBottom: 16, padding: "9px 11px", borderRadius: 9, background: T.card2,
            color: surplus >= 0 ? T.mut : T.amber, fontSize: 11.5, lineHeight: 1.55,
          }}>
            Surplus {usd(surplus)}/mo against roughly {usd((s.cb * P.cbApr + s.strike * P.strikeApr) / 12)}/mo
            of interest at month {s.m}.
          </div>
          <Slider label="Spot price today" value={spot} onChange={setSpot}
            min={30000} max={200000} step={500} fmt={usd}
            note={`Support line is ${usd(SUP0)} — spot is ${(spot / SUP0).toFixed(2)}× that`} />
          <Seg label="Price path" value={path} onChange={setPath} options={[
            { v: "converge", l: "To support" },
            { v: "ride", l: "Hold multiple" },
            { v: "flat", l: "Flat" },
          ]} />
          <Seg label="Refinancing" value={mode} onChange={setMode} options={[
            { v: "always", l: "Every month" },
            { v: "switch", l: "Stop at support" },
          ]} />
          <Seg label="Horizon" value={span} onChange={setSpan} options={[
            { v: 12, l: "12 months" },
            { v: 24, l: "24 months" },
          ]} />
        </div>

        {/* table */}
        <div style={{ marginTop: 16, background: T.card, borderRadius: 13, border: `1px solid ${T.line}`, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
              <thead>
                <tr style={{ color: T.faint, textAlign: "right" }}>
                  {["", "Price", "CB debt", "CB LTV", "Strike", "S LTV", "Reserve", "Liq"].map((h, i) => (
                    <th key={i} style={{
                      padding: "10px 7px", fontWeight: 400, fontSize: 10,
                      textAlign: i === 0 ? "left" : "right", borderBottom: `1px solid ${T.line}`,
                      position: "sticky", top: 0, background: T.card,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sel = r.m === Math.min(month, span);
                  return (
                    <tr key={r.m} onClick={() => setMonth(r.m)} style={{
                      cursor: "pointer", background: sel ? T.card2 : "transparent",
                      color: sel ? T.txt : T.mut,
                    }}>
                      <td style={{ padding: "7px", textAlign: "left", color: sel ? T.gold : T.faint, whiteSpace: "nowrap" }}>
                        {r.label}
                      </td>
                      <td style={{ padding: "7px", textAlign: "right" }}>{usd(r.price)}</td>
                      <td style={{ padding: "7px", textAlign: "right" }}>{usd(r.cb)}</td>
                      <td style={{ padding: "7px", textAlign: "right", color: bandColor(r.cbLtv, 0.65, CB_LLTV) }}>
                        {pct(r.cbLtv)}
                      </td>
                      <td style={{ padding: "7px", textAlign: "right" }}>{usd(r.strike)}</td>
                      <td style={{ padding: "7px", textAlign: "right", color: r.over ? T.red : bandColor(r.sLtv, 0.50, 0.70) }}>
                        {pct(r.sLtv)}
                      </td>
                      <td style={{ padding: "7px", textAlign: "right", color: r.reserve > 0 ? T.gold : T.faint }}>
                        {r.reserve.toFixed(3)}
                      </td>
                      <td style={{ padding: "7px", textAlign: "right" }}>{usd(r.cbLiq)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ color: T.faint, fontSize: 10.5, lineHeight: 1.7, marginTop: 14 }}>
          Opening position 0.966 ₿ on Strike against {usd(P.strikeBal0)}, 1.728 ₿ on Coinbase
          against {usd(P.cbBal0)}. Strike 13% APR, credit line set at 50% of posted collateral.
          Coinbase 5% APR, liquidates at 86% with no cure window. Support line
          0.42e-17 × days^5.82 from the 2009 genesis block — a model, not a floor.
          Strike LTV shown is the peak just before each refinance.
        </div>
      </div>
    </div>
  );
}
