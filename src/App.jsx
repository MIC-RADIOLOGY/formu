import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, createContext, useContext, useCallback } from "react";
import {
  Home, ListFilter, Target, Wallet, BarChart3, Bell, Settings as SettingsIcon,
  TrendingUp, X, ShieldAlert, Flame, Moon, Sun,
  ArrowUpRight, ArrowDownRight, Plus, Trash2, RefreshCw, AlertTriangle
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell
} from "recharts";
import { fetchMatches } from "./lib/oddsApi";
import { enrichWithStandings, buildMatchIdIndex, fetchHeadToHead } from "./lib/footballData";
import { supabase, listBets, addBet as addBetRemote, updateBetResult, deleteBet as deleteBetRemote, subscribeToBets } from "./lib/supabase";

/* ---------------------------------------------------------------
   TOKENS
--------------------------------------------------------------- */
const T = {
  bg: "#0F1417",
  bg2: "#0B0F12",
  surface: "#171D21",
  surface2: "#1D2429",
  line: "#262E33",
  text: "#EDEFEF",
  muted: "#8A9296",
  green: "#2FBF71",
  amber: "#E8A33D",
  red: "#E2574C",
  blue: "#5B8CFF",
};

/* ---------------------------------------------------------------
   LIVE MATCH DATA (The Odds API)
   MATCHES used to be a hardcoded mock array. It's now fetched live -
   see MatchesProvider/useMatches below, and src/lib/oddsApi.js for
   the fetch + normalization logic.
--------------------------------------------------------------- */
const LEAGUES = ["All", "EPL", "La Liga", "Serie A", "Bundesliga"];

const MatchesContext = createContext(null);

function MatchesProvider({ children }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [matchIdIndex, setMatchIdIndex] = useState(new Map());
  const [h2hCache, setH2hCache] = useState({}); // { [oddsApiMatchId]: string }

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setH2hCache({});
    fetchMatches()
      .then((matches) => enrichWithStandings(matches))
      .then((matches) => {
        setMatches(matches);
        // Build the id index in the background - not needed until a match is opened.
        buildMatchIdIndex(matches).then(setMatchIdIndex).catch((err) => {
          console.warn("[MatchesProvider] couldn't build football-data id index:", err.message);
        });
        return matches;
      })
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /** Lazily fetch + cache head-to-head summary for one match, by our match id. */
  const getHeadToHead = useCallback(
    async (matchId) => {
      if (h2hCache[matchId] !== undefined) return h2hCache[matchId];
      const footballDataId = matchIdIndex.get(matchId);
      if (!footballDataId) {
        const fallback = "Head-to-head not available for this fixture.";
        setH2hCache((prev) => ({ ...prev, [matchId]: fallback }));
        return fallback;
      }
      try {
        const summary = await fetchHeadToHead(footballDataId);
        setH2hCache((prev) => ({ ...prev, [matchId]: summary }));
        return summary;
      } catch (err) {
        const fallback = `Couldn't load head-to-head: ${err.message}`;
        setH2hCache((prev) => ({ ...prev, [matchId]: fallback }));
        return fallback;
      }
    },
    [matchIdIndex, h2hCache]
  );

  return (
    <MatchesContext.Provider value={{ matches, loading, error, refresh, getHeadToHead }}>
      {children}
    </MatchesContext.Provider>
  );
}

function useMatches() {
  const ctx = useContext(MatchesContext);
  if (!ctx) throw new Error("useMatches must be used inside <MatchesProvider>");
  return ctx;
}

/** Small reusable banner for loading / error / empty states around match lists. */
function MatchesStatus({ loading, error, onRetry, count }) {
  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, color: T.muted, fontSize: 13,
        padding: "10px 0"
      }}>
        <RefreshCw size={14} className="icon-spin" style={{ animation: "spin 1s linear infinite" }} />
        Loading live odds…
      </div>
    );
  }
  if (error) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8, color: T.red, fontSize: 13,
        background: `${T.red}14`, border: `1px solid ${T.red}44`, borderRadius: 8,
        padding: "10px 12px", marginBottom: 12
      }}>
        <AlertTriangle size={14} />
        <span style={{ flex: 1 }}>{error}</span>
        <button onClick={onRetry} className="press-btn" style={{
          background: "none", border: `1px solid ${T.red}66`, color: T.red, borderRadius: 6,
          padding: "3px 8px", fontSize: 12, cursor: "pointer"
        }}>Retry</button>
      </div>
    );
  }
  if (count === 0) {
    return <div style={{ color: T.muted, fontSize: 13, padding: "10px 0" }}>No matches found right now.</div>;
  }
  return null;
}

const ALERTS = [
  { id: 1, type: "odds", text: "Arsenal vs Brentford: home odds dropped 1.65 → 1.55", time: "12m ago" },
  { id: 2, type: "value", text: "Strong value bet found: Fiorentina to win vs Lecce", time: "40m ago" },
  { id: 3, type: "lineup", text: "Union Berlin: captain ruled out, confirmed suspended", time: "1h ago" },
  { id: 4, type: "kickoff", text: "Real Sociedad vs Girona kicks off in 45 minutes", time: "just now" },
];

const LEAGUE_STATS = [
  { league: "Serie A", winRate: 68 },
  { league: "EPL", winRate: 61 },
  { league: "Bundesliga", winRate: 54 },
  { league: "La Liga", winRate: 49 },
];

const MONTHLY_PL = [
  { month: "Mar", pl: 12 }, { month: "Apr", pl: -8 }, { month: "May", pl: 24 },
  { month: "Jun", pl: 6 }, { month: "Jul", pl: -14 }, { month: "Aug", pl: 31 },
];

const CONFIDENCE_ACCURACY = [
  { bucket: "80%+", accuracy: 74 },
  { bucket: "60-79%", accuracy: 61 },
  { bucket: "40-59%", accuracy: 48 },
];

/* ---------------------------------------------------------------
   HELPERS
--------------------------------------------------------------- */
const implied = (odds) => Math.round((1 / odds) * 1000) / 10;
const confColor = (c) => (c >= 70 ? T.green : c >= 50 ? T.amber : T.muted);
const confLabel = (c) => (c >= 70 ? "High" : c >= 50 ? "Medium" : "Avoid");
const valueGap = (m) => {
  const modelP = m.pred.home;
  const impliedP = implied(m.odds.home);
  return Math.round((modelP - impliedP) * 10) / 10;
};
const isValue = (m) => valueGap(m) >= 8;

/* ---------------------------------------------------------------
   COUNT-UP (micro-interaction: numbers animate in)
--------------------------------------------------------------- */
function useCountUp(target, duration = 700, decimals = 0) {
  const [val, setVal] = useState(0);
  const raf = useRef();
  useEffect(() => {
    const start = performance.now();
    const from = 0;
    function tick(now) {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return decimals ? val.toFixed(decimals) : Math.round(val);
}

/* ---------------------------------------------------------------
   SIGNATURE: outcome probability bar (fills in on mount)
--------------------------------------------------------------- */
function OutcomeBar({ pred, home, away, compact, delay = 0 }) {
  const [filled, setFilled] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFilled(true), 60 + delay);
    return () => clearTimeout(t);
  }, [delay]);
  const w = (v) => (filled ? v : 0);
  return (
    <div style={{ width: "100%" }}>
      <div style={{
        display: "flex", height: compact ? 6 : 10, borderRadius: 3, overflow: "hidden",
        border: `1px solid ${T.line}`, background: T.bg2
      }}>
        <div style={{ width: `${w(pred.home)}%`, background: T.green, transition: "width 0.7s cubic-bezier(.16,1,.3,1)" }} />
        <div style={{ width: `${w(pred.draw)}%`, background: T.line, transition: "width 0.7s cubic-bezier(.16,1,.3,1) .05s" }} />
        <div style={{ width: `${w(pred.away)}%`, background: T.red, transition: "width 0.7s cubic-bezier(.16,1,.3,1) .1s" }} />
      </div>
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5, fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: T.muted }}>
          <span style={{ color: T.green }}>{home} {pred.home}%</span>
          <span>D {pred.draw}%</span>
          <span style={{ color: T.red }}>{away} {pred.away}%</span>
        </div>
      )}
    </div>
  );
}

function ConfidencePill({ c }) {
  const col = confColor(c);
  return (
    <span className="pulse-ring" style={{
      position: "relative",
      fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, fontWeight: 600,
      color: col, border: `1px solid ${col}55`, background: `${col}1A`,
      borderRadius: 20, padding: "3px 9px", whiteSpace: "nowrap"
    }}>
      {c}% · {confLabel(c)}
    </span>
  );
}

function ValueTag({ m }) {
  if (!isValue(m)) return null;
  return (
    <span className="shimmer" style={{
      fontFamily: "'Barlow Condensed', sans-serif", fontSize: 12, fontWeight: 700,
      letterSpacing: 0.5, color: "#0F1417", background: T.green,
      borderRadius: 4, padding: "2px 8px", textTransform: "uppercase",
      position: "relative", overflow: "hidden"
    }}>
      Value
    </span>
  );
}

/* ---------------------------------------------------------------
   NAV
--------------------------------------------------------------- */
const TABS = [
  { id: "dashboard", label: "Today", icon: Home },
  { id: "matches", label: "Matches", icon: ListFilter },
  { id: "value", label: "Value", icon: Target },
  { id: "tracker", label: "Tracker", icon: Wallet },
  { id: "stats", label: "Stats", icon: BarChart3 },
  { id: "alerts", label: "Alerts", icon: Bell },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

/* ---------------------------------------------------------------
   MATCH CARD
--------------------------------------------------------------- */
function MatchCard({ m, onOpen, index = 0 }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="card-in"
      style={{ animationDelay: `${index * 60}ms` }}
      onClick={() => onOpen(m)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <div
        style={{
          background: hover ? T.surface2 : T.surface,
          border: `1px solid ${hover ? T.blue + "66" : T.line}`, borderRadius: 10,
          padding: 14, cursor: "pointer",
          transform: hover ? "translateY(-3px)" : "translateY(0)",
          boxShadow: hover ? "0 10px 24px -8px #00000066" : "0 0 0 rgba(0,0,0,0)",
          transition: "all .22s cubic-bezier(.16,1,.3,1)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 0.5 }}>
            {m.league} · {m.kickoff}
          </span>
          <ValueTag m={m} />
        </div>
        <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 600, color: T.text, marginBottom: 10, letterSpacing: 0.2 }}>
          {m.home} <span style={{ color: T.muted, fontWeight: 400 }}>vs</span> {m.away}
        </div>
        <OutcomeBar pred={m.pred} home={m.home.split(" ")[0]} away={m.away.split(" ")[0]} delay={index * 60} />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12 }}>
          <div style={{ display: "flex", gap: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: T.muted }}>
            <span>1 <b style={{ color: T.text }}>{m.odds.home.toFixed(2)}</b></span>
            <span>X <b style={{ color: T.text }}>{m.odds.draw.toFixed(2)}</b></span>
            <span>2 <b style={{ color: T.text }}>{m.odds.away.toFixed(2)}</b></span>
          </div>
          <ConfidencePill c={m.confidence} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   MATCH DETAIL DRAWER
--------------------------------------------------------------- */
function MatchDetail({ m, onClose }) {
  const { getHeadToHead } = useMatches();
  const [visible, setVisible] = useState(false);
  const [h2hText, setH2hText] = useState(null);

  useEffect(() => {
    if (m) requestAnimationFrame(() => requestAnimationFrame(() => setVisible(true)));
    else setVisible(false);
  }, [m]);

  useEffect(() => {
    if (!m) { setH2hText(null); return; }
    let cancelled = false;
    setH2hText(null); // show loading state while fetching this match's h2h
    getHeadToHead(m.id).then((summary) => {
      if (!cancelled) setH2hText(summary);
    });
    return () => { cancelled = true; };
  }, [m, getHeadToHead]);

  if (!m) return null;
  const gap = valueGap(m);

  const close = () => {
    setVisible(false);
    setTimeout(onClose, 220);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 50, display: "flex", justifyContent: "flex-end",
        background: visible ? "#00000099" : "#00000000",
        transition: "background .25s ease",
      }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(480px, 100%)", height: "100%", background: T.bg,
          borderLeft: `1px solid ${T.line}`, overflowY: "auto", padding: 22,
          transform: visible ? "translateX(0)" : "translateX(24px)",
          opacity: visible ? 1 : 0,
          transition: "transform .28s cubic-bezier(.16,1,.3,1), opacity .22s ease",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: T.muted, textTransform: "uppercase" }}>
            {m.league} · {m.kickoff}
          </span>
          <button onClick={close} className="icon-btn" style={{ background: "none", border: "none", color: T.muted, cursor: "pointer" }}>
            <X size={20} />
          </button>
        </div>
        <h2 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 30, fontWeight: 700, color: T.text, margin: "6px 0 16px" }}>
          {m.home} vs {m.away}
        </h2>

        <OutcomeBar pred={m.pred} home={m.home} away={m.away} />

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 18 }}>
          <StatBox label="Team A win" value={m.pred.home} suffix="%" />
          <StatBox label="Draw" value={m.pred.draw} suffix="%" />
          <StatBox label="Team B win" value={m.pred.away} suffix="%" />
        </div>

        <Section title="Verdict">
          <div style={{
            background: isValue(m) ? `${T.green}14` : T.surface, border: `1px solid ${isValue(m) ? T.green + "55" : T.line}`,
            borderRadius: 8, padding: 12, fontSize: 13, color: T.text, lineHeight: 1.5,
            transition: "background .3s ease"
          }}>
            Book odds for {m.home}: <b style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{m.odds.home.toFixed(2)}</b> · Implied probability: <b style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{implied(m.odds.home)}%</b><br />
            Model probability: <b style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{m.pred.home}%</b> · Gap: <b style={{ color: gap >= 8 ? T.green : T.muted, fontFamily: "'IBM Plex Mono', monospace" }}>{gap > 0 ? "+" : ""}{gap}%</b>
            <div style={{ marginTop: 6, fontWeight: 600, color: isValue(m) ? T.green : T.muted }}>
              {isValue(m) ? "Possible value bet" : "No meaningful edge found"}
            </div>
          </div>
        </Section>

        <Section title="Reason for pick">
          <ul style={{ margin: 0, paddingLeft: 18, color: T.text, fontSize: 13, lineHeight: 1.7 }}>
            {m.reasons.map((r, i) => (
              <li key={i} className="fade-in-row" style={{ animationDelay: `${120 + i * 70}ms` }}>{r}</li>
            ))}
          </ul>
        </Section>

        <Section title="Form (last 5)">
          <Row label={m.home} value={m.form.home} mono />
          <Row label={m.away} value={m.form.away} mono />
        </Section>

        <Section title="Home / away record">
          <Row label={m.home} value={m.record.home} />
          <Row label={m.away} value={m.record.away} />
        </Section>

        <Section title="Head-to-head">
          <div style={{ fontSize: 13, color: h2hText ? T.text : T.muted }}>
            {h2hText ?? "Loading head-to-head…"}
          </div>
        </Section>

        <Section title="Goals per game">
          <Row label={`${m.home} scored / conceded`} value={`${m.goals.homeFor ?? "—"} / ${m.goals.homeAgainst ?? "—"}`} mono />
          <Row label={`${m.away} scored / conceded`} value={`${m.goals.awayFor ?? "—"} / ${m.goals.awayAgainst ?? "—"}`} mono />
        </Section>

        <Section title="Injuries & suspensions">
          <div style={{ fontSize: 13, color: T.text }}>{m.injuries}</div>
        </Section>

        <Section title="Bookmaker odds">
          <div style={{ display: "flex", gap: 10, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
            <OddsChip label="1" val={m.odds.home} />
            <OddsChip label="X" val={m.odds.draw} />
            <OddsChip label="2" val={m.odds.away} />
          </div>
        </Section>
      </div>
    </div>
  );
}

function StatBox({ label, value, suffix = "" }) {
  const n = useCountUp(value, 600);
  return (
    <div style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 8px", textAlign: "center" }}>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, fontWeight: 700, color: T.text }}>{n}{suffix}</div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: 2, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</div>
    </div>
  );
}
function Section({ title, children }) {
  return (
    <div style={{ marginTop: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.6, color: T.muted, marginBottom: 8, fontWeight: 600 }}>{title}</div>
      {children}
    </div>
  );
}
function Row({ label, value, mono }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${T.line}`, fontSize: 13 }}>
      <span style={{ color: T.muted }}>{label}</span>
      <span style={{ color: T.text, fontFamily: mono ? "'IBM Plex Mono', monospace" : "inherit" }}>{value}</span>
    </div>
  );
}
function OddsChip({ label, val }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        flex: 1, background: hover ? T.surface2 : T.surface, border: `1px solid ${hover ? T.blue + "55" : T.line}`,
        borderRadius: 8, padding: "8px 0", textAlign: "center",
        transform: hover ? "translateY(-2px)" : "none", transition: "all .18s ease"
      }}
    >
      <div style={{ color: T.muted, fontSize: 11 }}>{label}</div>
      <div style={{ color: T.text, fontWeight: 700 }}>{val.toFixed(2)}</div>
    </div>
  );
}

/* ---------------------------------------------------------------
   DASHBOARD
--------------------------------------------------------------- */
function Dashboard({ onOpen }) {
  const { matches, loading, error, refresh } = useMatches();
  const top = [...matches].sort((a, b) => b.confidence - a.confidence).slice(0, 3);
  const valueBets = matches.filter(isValue);
  return (
    <div>
      <PageTitle title="Today" subtitle="What the model likes right now" />
      <MatchesStatus loading={loading} error={error} onRetry={refresh} count={matches.length} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 22 }}>
        <MiniStat label="Matches today" value={matches.length} />
        <MiniStat label="Value bets found" value={valueBets.length} accent={T.green} />
        <MiniStat label="Avg. confidence" value={matches.length ? Math.round(matches.reduce((s, m) => s + m.confidence, 0) / matches.length) : 0} suffix="%" />
      </div>

      <SectionHeader title="Top predicted winners" />
      <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
        {top.map((m, i) => <MatchCard key={m.id} m={m} onOpen={onOpen} index={i} />)}
      </div>

      <SectionHeader title="Best value bets" />
      <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
        {valueBets.length ? valueBets.map((m, i) => <MatchCard key={m.id} m={m} onOpen={onOpen} index={i} />) : (
          <EmptyNote text="No value bets found right now. Check back after odds update." />
        )}
      </div>

      <SectionHeader title="Odds movement" />
      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        <OddsMoveRow team="Arsenal (home)" from={1.65} to={1.55} index={0} />
        <OddsMoveRow team="Union Berlin (home)" from={2.60} to={2.90} index={1} />
        <OddsMoveRow team="Wolves (away)" from={3.40} to={3.10} index={2} />
      </div>
    </div>
  );
}
function OddsMoveRow({ team, from, to, index = 0 }) {
  const up = to > from;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  const col = up ? T.red : T.green;
  return (
    <div className="fade-in-row" style={{
      animationDelay: `${index * 70}ms`,
      display: "flex", justifyContent: "space-between", alignItems: "center", background: T.surface,
      border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 12px"
    }}>
      <span style={{ fontSize: 13, color: T.text }}>{team}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 4, fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: col }}>
        {from.toFixed(2)} <Icon size={14} className="nudge" /> {to.toFixed(2)}
      </span>
    </div>
  );
}
function MiniStat({ label, value, accent, suffix = "" }) {
  const n = useCountUp(value, 800);
  return (
    <div className="card-in" style={{
      background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 14,
      transition: "border-color .2s ease"
    }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 700, color: accent || T.text }}>{n}{suffix}</div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{label}</div>
    </div>
  );
}
function EmptyNote({ text }) {
  return (
    <div style={{ border: `1px dashed ${T.line}`, borderRadius: 10, padding: 18, textAlign: "center", color: T.muted, fontSize: 13 }}>
      {text}
    </div>
  );
}
function SectionHeader({ title, right }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
      <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: 0.3 }}>{title}</div>
      {right}
    </div>
  );
}
function PageTitle({ title, subtitle }) {
  return (
    <div className="fade-in-row" style={{ marginBottom: 20 }}>
      <h1 style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 34, fontWeight: 700, color: T.text, margin: 0, letterSpacing: 0.3 }}>{title}</h1>
      {subtitle && <div style={{ color: T.muted, fontSize: 13, marginTop: 2 }}>{subtitle}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------
   MATCHES PAGE
--------------------------------------------------------------- */
function MatchesPage({ onOpen }) {
  const { matches, loading, error, refresh } = useMatches();
  const [league, setLeague] = useState("All");
  const [minConf, setMinConf] = useState(0);
  const filtered = matches.filter((m) => (league === "All" || m.league === league) && m.confidence >= minConf);

  return (
    <div>
      <PageTitle title="Matches" subtitle={`${filtered.length} fixtures`} />
      <MatchesStatus loading={loading} error={error} onRetry={refresh} count={filtered.length} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        {LEAGUES.map((l) => (
          <button key={l} onClick={() => setLeague(l)} className="chip-btn" style={{
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "6px 12px", borderRadius: 20,
            border: `1px solid ${league === l ? T.blue : T.line}`, background: league === l ? `${T.blue}22` : "transparent",
            color: league === l ? T.blue : T.muted, cursor: "pointer", transition: "all .15s ease"
          }}>{l}</button>
        ))}
        <select value={minConf} onChange={(e) => setMinConf(Number(e.target.value))} style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, padding: "6px 10px", borderRadius: 20,
          border: `1px solid ${T.line}`, background: T.surface, color: T.text, marginLeft: "auto", cursor: "pointer"
        }}>
          <option value={0}>Any confidence</option>
          <option value={50}>50%+</option>
          <option value={70}>70%+</option>
        </select>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {filtered.map((m, i) => <MatchCard key={m.id} m={m} onOpen={onOpen} index={i} />)}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   VALUE BETS PAGE
--------------------------------------------------------------- */
function ValuePage({ onOpen }) {
  const { matches, loading, error, refresh } = useMatches();
  const rows = matches.map((m) => ({ m, gap: valueGap(m) })).filter((r) => r.gap >= 4).sort((a, b) => b.gap - a.gap);
  return (
    <div>
      <PageTitle title="Value bets" subtitle="Where the model disagrees with the market" />
      <MatchesStatus loading={loading} error={error} onRetry={refresh} count={rows.length} />
      <div style={{ display: "grid", gap: 8 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 0.8fr 1fr 1fr 0.8fr 0.8fr", gap: 8, padding: "0 12px", fontSize: 11, color: T.muted, textTransform: "uppercase" }}>
          <span>Match</span><span>Market</span><span>Odds</span><span>Implied</span><span>Model</span><span>Gap</span><span>Risk</span>
        </div>
        {rows.map(({ m, gap }, i) => {
          const risk = m.confidence >= 70 ? "Low" : m.confidence >= 50 ? "Medium" : "High";
          const riskCol = risk === "Low" ? T.green : risk === "Medium" ? T.amber : T.red;
          return (
            <ValueRow key={m.id} m={m} gap={gap} risk={risk} riskCol={riskCol} index={i} onOpen={onOpen} />
          );
        })}
      </div>
    </div>
  );
}
function ValueRow({ m, gap, risk, riskCol, index, onOpen }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={() => onOpen(m)}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      className="fade-in-row"
      style={{
        animationDelay: `${index * 55}ms`,
        display: "grid", gridTemplateColumns: "2fr 1fr 0.8fr 1fr 1fr 0.8fr 0.8fr", gap: 8, alignItems: "center",
        background: hover ? T.surface2 : T.surface, border: `1px solid ${hover ? T.blue + "55" : T.line}`,
        borderRadius: 8, padding: "12px", cursor: "pointer", fontSize: 13,
        transform: hover ? "translateX(2px)" : "none", transition: "all .18s ease"
      }}
    >
      <span style={{ color: T.text }}>{m.home} v {m.away}</span>
      <span style={{ color: T.muted }}>1X2 · Home</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.text }}>{m.odds.home.toFixed(2)}</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.muted }}>{implied(m.odds.home)}%</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.text }}>{m.pred.home}%</span>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.green, fontWeight: 700 }}>+{gap}%</span>
      <span style={{ color: riskCol, fontSize: 12 }}>{risk}</span>
    </div>
  );
}

/* ---------------------------------------------------------------
   TRACKER PAGE
--------------------------------------------------------------- */
function TrackerPage() {
  const [bets, setBets] = useState([]);
  const [form, setForm] = useState({ match: "", stake: "", odds: "" });
  const [justAdded, setJustAdded] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const configured = !!supabase;

  const load = useCallback(() => {
    if (!configured) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    listBets()
      .then((rows) => setBets(rows.map((b) => ({ ...b, stake: Number(b.stake), odds: Number(b.odds) }))))
      .catch((err) => setError(err.message || String(err)))
      .finally(() => setLoading(false));
  }, [configured]);

  useEffect(() => {
    load();
    // Keep bets in sync across tabs/devices via Supabase Realtime.
    const unsubscribe = subscribeToBets(() => load());
    return unsubscribe;
  }, [load]);

  const withPL = bets.map((b) => ({
    ...b,
    pl: b.result === "win" ? +(b.stake * b.odds - b.stake).toFixed(2) : b.result === "loss" ? -b.stake : 0,
  }));
  const balance = withPL.reduce((s, b) => s + b.pl, 0);
  const settled = withPL.filter((b) => b.result !== "pending");
  const wins = settled.filter((b) => b.result === "win").length;
  const winRate = settled.length ? Math.round((wins / settled.length) * 100) : 0;

  let streak = 0, streakType = null;
  for (let i = settled.length - 1; i >= 0; i--) {
    if (streakType === null) { streakType = settled[i].result; streak = 1; }
    else if (settled[i].result === streakType) streak++;
    else break;
  }

  const addBet = async () => {
    if (!form.match || !form.stake || !form.odds || !configured) return;
    setSaving(true);
    try {
      const created = await addBetRemote({
        match: form.match,
        stake: Number(form.stake),
        odds: Number(form.odds),
      });
      setBets((prev) => [...prev, { ...created, stake: Number(created.stake), odds: Number(created.odds) }]);
      setForm({ match: "", stake: "", odds: "" });
      setJustAdded(created.id);
      setTimeout(() => setJustAdded(null), 900);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setSaving(false);
    }
  };
  const setResult = async (id, result) => {
    setBets((prev) => prev.map((b) => (b.id === id ? { ...b, result } : b))); // optimistic
    try {
      await updateBetResult(id, result);
    } catch (err) {
      setError(err.message || String(err));
      load(); // revert to server state on failure
    }
  };
  const removeBet = async (id) => {
    setBets((prev) => prev.filter((b) => b.id !== id)); // optimistic
    try {
      await deleteBetRemote(id);
    } catch (err) {
      setError(err.message || String(err));
      load();
    }
  };

  return (
    <div>
      <PageTitle title="Bet tracker" subtitle="Record stakes and follow performance" />
      {!configured && (
        <div style={{
          color: T.amber, background: `${T.amber}14`, border: `1px solid ${T.amber}44`, borderRadius: 8,
          padding: "10px 12px", marginBottom: 16, fontSize: 13
        }}>
          Supabase isn't configured yet — add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env
          (see .env.example and supabase/schema.sql) to persist bets.
        </div>
      )}
      {error && (
        <div style={{
          color: T.red, background: `${T.red}14`, border: `1px solid ${T.red}44`, borderRadius: 8,
          padding: "10px 12px", marginBottom: 16, fontSize: 13
        }}>{error}</div>
      )}
      {loading && configured && <div style={{ color: T.muted, fontSize: 13, marginBottom: 16 }}>Loading bets…</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10, marginBottom: 20 }}>
        <MiniStat label="Balance" value={balance} accent={balance >= 0 ? T.green : T.red} suffix="" />
        <MiniStat label="Win rate" value={winRate} suffix="%" />
        <div className="card-in" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 14 }}>
          <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 28, fontWeight: 700, color: streakType === "win" ? T.green : streakType === "loss" ? T.red : T.text }}>
            {streak ? `${streak}${streakType === "win" ? "W" : "L"}` : "—"}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>Current streak</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <input placeholder="Match" value={form.match} onChange={(e) => setForm({ ...form, match: e.target.value })} style={inputStyle(160)} className="input-focus" />
        <input placeholder="Stake" type="number" value={form.stake} onChange={(e) => setForm({ ...form, stake: e.target.value })} style={inputStyle(90)} className="input-focus" />
        <input placeholder="Odds" type="number" step="0.01" value={form.odds} onChange={(e) => setForm({ ...form, odds: e.target.value })} style={inputStyle(90)} className="input-focus" />
        <button onClick={addBet} disabled={!configured || saving} className="press-btn" style={{
          display: "flex", alignItems: "center", gap: 6, background: T.blue, color: "#fff", border: "none",
          borderRadius: 8, padding: "8px 14px", fontSize: 13, fontWeight: 600,
          cursor: !configured || saving ? "not-allowed" : "pointer", opacity: !configured || saving ? 0.6 : 1
        }}><Plus size={14} /> {saving ? "Saving…" : "Add bet"}</button>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        {withPL.slice().reverse().map((b, i) => (
          <div key={b.id} className={justAdded === b.id ? "pop-in" : "fade-in-row"} style={{
            animationDelay: justAdded === b.id ? "0ms" : `${i * 40}ms`,
            display: "flex", justifyContent: "space-between", alignItems: "center", background: T.surface,
            border: `1px solid ${T.line}`, borderRadius: 8, padding: "10px 12px", fontSize: 13
          }}>
            <span style={{ color: T.text, flex: 1 }}>{b.match}</span>
            <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: T.muted, width: 90 }}>${b.stake} @ {b.odds.toFixed(2)}</span>
            {b.result === "pending" ? (
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => setResult(b.id, "win")} className="press-btn" style={pillBtn(T.green)}>Win</button>
                <button onClick={() => setResult(b.id, "loss")} className="press-btn" style={pillBtn(T.red)}>Loss</button>
              </div>
            ) : (
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 700, color: b.pl >= 0 ? T.green : T.red, width: 70, textAlign: "right" }}>
                {b.pl >= 0 ? "+" : ""}{b.pl.toFixed(2)}
              </span>
            )}
            <button onClick={() => removeBet(b.id)} className="icon-btn" style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", marginLeft: 8 }}>
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
function inputStyle(w) {
  return {
    width: w, background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8,
    padding: "8px 10px", color: T.text, fontSize: 13, outline: "none", transition: "border-color .15s ease"
  };
}
function pillBtn(color) {
  return {
    fontSize: 11, fontWeight: 700, color, background: `${color}1A`, border: `1px solid ${color}55`,
    borderRadius: 6, padding: "4px 10px", cursor: "pointer"
  };
}

/* ---------------------------------------------------------------
   STATS PAGE
--------------------------------------------------------------- */
function StatsPage() {
  return (
    <div>
      <PageTitle title="Stats" subtitle="How the model is performing" />

      <SectionHeader title="Best performing leagues (win rate)" />
      <ChartCard>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={LEAGUE_STATS}>
            <CartesianGrid stroke={T.line} vertical={false} />
            <XAxis dataKey="league" stroke={T.muted} fontSize={11} tickLine={false} axisLine={{ stroke: T.line }} />
            <YAxis stroke={T.muted} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ fill: T.surface2 }} contentStyle={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="winRate" radius={[4, 4, 0, 0]} animationDuration={900} animationEasing="ease-out">
              {LEAGUE_STATS.map((_, i) => <Cell key={i} fill={T.green} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <SectionHeader title="Monthly profit / loss" />
      <ChartCard>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={MONTHLY_PL}>
            <CartesianGrid stroke={T.line} vertical={false} />
            <XAxis dataKey="month" stroke={T.muted} fontSize={11} tickLine={false} axisLine={{ stroke: T.line }} />
            <YAxis stroke={T.muted} fontSize={11} tickLine={false} axisLine={false} />
            <Tooltip cursor={{ stroke: T.line }} contentStyle={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 12 }} />
            <Line type="monotone" dataKey="pl" stroke={T.blue} strokeWidth={2} dot={{ r: 3 }} animationDuration={1000} animationEasing="ease-out" />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <SectionHeader title="Confidence vs outcome accuracy" />
      <ChartCard>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={CONFIDENCE_ACCURACY} layout="vertical">
            <CartesianGrid stroke={T.line} horizontal={false} />
            <XAxis type="number" stroke={T.muted} fontSize={11} tickLine={false} axisLine={{ stroke: T.line }} />
            <YAxis dataKey="bucket" type="category" stroke={T.muted} fontSize={11} tickLine={false} axisLine={false} width={60} />
            <Tooltip cursor={{ fill: T.surface2 }} contentStyle={{ background: T.surface2, border: `1px solid ${T.line}`, borderRadius: 8, fontSize: 12 }} />
            <Bar dataKey="accuracy" radius={[0, 4, 4, 0]} fill={T.amber} animationDuration={900} animationEasing="ease-out" />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <SectionHeader title="Most accurate prediction types" />
      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        <Row label="Home win (favorite)" value="71% accuracy" />
        <Row label="Away win (underdog)" value="46% accuracy" />
        <Row label="Draw" value="38% accuracy" />
      </div>
    </div>
  );
}
function ChartCard({ children }) {
  return (
    <div className="card-in" style={{ background: T.surface, border: `1px solid ${T.line}`, borderRadius: 10, padding: 12, marginBottom: 22 }}>
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------
   ALERTS PAGE
--------------------------------------------------------------- */
function AlertsPage() {
  const iconFor = (type) => (
    type === "odds" ? TrendingUp : type === "value" ? Target : type === "lineup" ? ShieldAlert : Flame
  );
  return (
    <div>
      <PageTitle title="Alerts" subtitle="Recent notifications" />
      <div style={{ display: "grid", gap: 8 }}>
        {ALERTS.map((a, i) => {
          const Icon = iconFor(a.type);
          return (
            <div key={a.id} className="fade-in-row" style={{ animationDelay: `${i * 70}ms`, display: "flex", gap: 10, alignItems: "flex-start", background: T.surface, border: `1px solid ${T.line}`, borderRadius: 8, padding: 12 }}>
              <div style={{ background: T.surface2, borderRadius: 8, padding: 8, color: T.blue }}><Icon size={16} /></div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, color: T.text }}>{a.text}</div>
                <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{a.time}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------
   SETTINGS PAGE
--------------------------------------------------------------- */
function SettingsPage() {
  const [risk, setRisk] = useState("Medium");
  const [minOdds, setMinOdds] = useState(1.5);
  const [currency, setCurrency] = useState("USD");
  const [dark, setDark] = useState(true);
  const [leagues, setLeagues] = useState(["EPL", "Serie A"]);

  const toggleLeague = (l) => setLeagues((prev) => prev.includes(l) ? prev.filter((x) => x !== l) : [...prev, l]);

  return (
    <div>
      <PageTitle title="Settings" subtitle="Tune how Formline works for you" />

      <Section title="Preferred leagues">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {LEAGUES.filter((l) => l !== "All").map((l) => (
            <button key={l} onClick={() => toggleLeague(l)} className="chip-btn" style={{
              fontSize: 12, padding: "6px 12px", borderRadius: 20,
              border: `1px solid ${leagues.includes(l) ? T.blue : T.line}`,
              background: leagues.includes(l) ? `${T.blue}22` : "transparent",
              color: leagues.includes(l) ? T.blue : T.muted, cursor: "pointer", transition: "all .15s ease"
            }}>{l}</button>
          ))}
        </div>
      </Section>

      <Section title="Minimum odds">
        <input type="range" min="1.1" max="5" step="0.1" value={minOdds} onChange={(e) => setMinOdds(Number(e.target.value))} style={{ width: "100%", accentColor: T.blue }} />
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: T.text }}>{minOdds.toFixed(1)}</div>
      </Section>

      <Section title="Risk level">
        <div style={{ display: "flex", gap: 8 }}>
          {["Low", "Medium", "High"].map((r) => (
            <button key={r} onClick={() => setRisk(r)} className="press-btn" style={{
              flex: 1, padding: "8px 0", borderRadius: 8, fontSize: 13,
              border: `1px solid ${risk === r ? T.blue : T.line}`,
              background: risk === r ? `${T.blue}22` : T.surface,
              color: risk === r ? T.blue : T.muted, cursor: "pointer", transition: "all .15s ease"
            }}>{r}</button>
          ))}
        </div>
      </Section>

      <Section title="Currency">
        <select value={currency} onChange={(e) => setCurrency(e.target.value)} style={{ ...inputStyle(140), padding: "8px 10px", cursor: "pointer" }}>
          <option>USD</option><option>EUR</option><option>GBP</option><option>ZAR</option>
        </select>
      </Section>

      <Section title="Appearance">
        <button onClick={() => setDark(!dark)} className="press-btn" style={{
          display: "flex", alignItems: "center", gap: 8, background: T.surface, border: `1px solid ${T.line}`,
          borderRadius: 8, padding: "8px 14px", color: T.text, cursor: "pointer", fontSize: 13
        }}>
          <span className="icon-spin">{dark ? <Moon size={15} /> : <Sun size={15} />}</span> {dark ? "Dark mode" : "Light mode"}
        </button>
      </Section>

      <Section title="Notification time">
        <input type="time" defaultValue="08:00" style={inputStyle(140)} className="input-focus" />
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------
   TAB BAR (sliding underline indicator)
--------------------------------------------------------------- */
function TabBar({ tab, setTab }) {
  const refs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const el = refs.current[tab];
    if (el) setIndicator({ left: el.offsetLeft, width: el.offsetWidth });
  }, [tab]);

  return (
    <div style={{ position: "relative", display: "flex", gap: 4, overflowX: "auto" }}>
      <div style={{
        position: "absolute", bottom: 0, height: 2, background: T.blue, borderRadius: 2,
        left: indicator.left, width: indicator.width,
        transition: "left .28s cubic-bezier(.16,1,.3,1), width .28s cubic-bezier(.16,1,.3,1)"
      }} />
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = tab === t.id;
        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[t.id] = el)}
            onClick={() => setTab(t.id)}
            className="tab-btn"
            style={{
              display: "flex", alignItems: "center", gap: 6, background: "none", border: "none",
              color: active ? T.text : T.muted,
              padding: "8px 10px", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap",
              fontWeight: active ? 600 : 400, transition: "color .2s ease"
            }}
          >
            <Icon size={14} /> {t.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------
   ROOT APP
--------------------------------------------------------------- */
export default function FormlineApp() {
  return (
    <MatchesProvider>
      <FormlineShell />
    </MatchesProvider>
  );
}

function FormlineShell() {
  const [tab, setTab] = useState("dashboard");
  const [openMatch, setOpenMatch] = useState(null);

  const page = useMemo(() => {
    switch (tab) {
      case "dashboard": return <Dashboard onOpen={setOpenMatch} />;
      case "matches": return <MatchesPage onOpen={setOpenMatch} />;
      case "value": return <ValuePage onOpen={setOpenMatch} />;
      case "tracker": return <TrackerPage />;
      case "stats": return <StatsPage />;
      case "alerts": return <AlertsPage />;
      case "settings": return <SettingsPage />;
      default: return null;
    }
  }, [tab]);

  return (
    <div style={{
      background: `radial-gradient(1200px 600px at 50% -10%, #14202088 0%, ${T.bg} 55%)`,
      minHeight: "100vh", color: T.text, fontFamily: "'Inter', sans-serif"
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        input:focus, select:focus, button:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 1px; }
        ::selection { background: ${T.blue}55; }

        @keyframes cardIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .card-in { animation: cardIn .45s cubic-bezier(.16,1,.3,1) both; }

        @keyframes fadeInRow {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .fade-in-row { animation: fadeInRow .4s ease both; }

        @keyframes popIn {
          0% { opacity: 0; transform: scale(.96); }
          60% { opacity: 1; transform: scale(1.01); }
          100% { opacity: 1; transform: scale(1); }
        }
        .pop-in { animation: popIn .35s cubic-bezier(.34,1.56,.64,1) both; }

        @keyframes pageFade {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .page-fade { animation: pageFade .3s ease both; }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .press-btn { transition: transform .12s ease, filter .12s ease; }
        .press-btn:active { transform: scale(.94); filter: brightness(0.92); }

        .chip-btn:hover { filter: brightness(1.2); }
        .chip-btn:active { transform: scale(.96); }

        .icon-btn { transition: color .15s ease, transform .15s ease; border-radius: 6px; }
        .icon-btn:hover { color: ${T.text} !important; transform: scale(1.1); }

        .tab-btn { position: relative; }
        .tab-btn:hover { color: ${T.text} !important; }

        .input-focus:focus { border-color: ${T.blue} !important; }

        @keyframes shimmerMove {
          0% { transform: translateX(-120%); }
          100% { transform: translateX(220%); }
        }
        .shimmer::after {
          content: ""; position: absolute; top: 0; left: 0; width: 40%; height: 100%;
          background: linear-gradient(120deg, transparent, #ffffff88, transparent);
          animation: shimmerMove 2.2s ease-in-out infinite;
        }

        @keyframes nudgeMove {
          0%, 100% { transform: translateX(0); }
          50% { transform: translateX(2px); }
        }
        .nudge { animation: nudgeMove 1.6s ease-in-out infinite; }

        .icon-spin { display: inline-flex; transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
        button:hover .icon-spin { transform: rotate(-18deg); }

        @keyframes logoPulse {
          0%, 100% { box-shadow: 0 0 0 0 ${T.green}66; }
          50% { box-shadow: 0 0 0 5px ${T.green}00; }
        }
        .logo-dot { animation: logoPulse 2.4s ease-in-out infinite; }

        ::-webkit-scrollbar { height: 6px; width: 6px; }
        ::-webkit-scrollbar-thumb { background: ${T.line}; border-radius: 4px; }
      `}</style>

      <div style={{ borderBottom: `1px solid ${T.line}`, position: "sticky", top: 0, background: `${T.bg}ee`, backdropFilter: "blur(8px)", zIndex: 10 }}>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "14px 16px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <div className="logo-dot" style={{ width: 8, height: 8, borderRadius: 2, background: T.green }} />
            <span style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: 20, fontWeight: 700, letterSpacing: 0.5 }}>FORMLINE</span>
          </div>
          <TabBar tab={tab} setTab={setTab} />
        </div>
      </div>

      <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 16px 60px" }}>
        <div key={tab} className="page-fade">
          {page}
        </div>
      </div>

      <MatchDetail m={openMatch} onClose={() => setOpenMatch(null)} />
    </div>
  );
}
