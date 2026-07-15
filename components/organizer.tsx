"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { autoSplitFlights, flightForIndex, flightRangeLabel, type FlightBand } from "@/lib/flights";
import { Avatar } from "@/components/ui";

// ---- Desktop-only Organizer console. Opens an existing game (created on any device) and lets
// the organizer set it up on a wide screen: flights now (Phase 1), matchups/field next. It reads
// and writes the same games/game_players rows the phone uses — no separate source of truth.

type GP = {
  id: string;
  user_id: string | null;
  is_guest: boolean;
  display_name: string;
  avatar_url: string | null;
  handicap_index: number | null;
  flight: string | null;
  tee_group: number | null;
  course_handicap: number | null;
};
type Game = {
  id: string;
  name: string;
  course: string | null;
  played_at: string | null;
  game_type: string;
  allowance_pct: number | null;
  flight_mode: string | null;
  flights: FlightBand[] | null;
};

const FLIGHT_COLOR: Record<string, string> = { A: "#5AA9E6", B: C.gold, C: "#8FE0B0", D: "#E0915B", E: "#B39DDB", F: "#F48FB1" };
const flightColor = (k: string | null) => (k ? FLIGHT_COLOR[k] || C.sage : C.sage);
const initials = (n: string) => (n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("");

type Step = "details" | "field" | "flights" | "matchups";

export function OrganizerConsole({ gameId }: { gameId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [game, setGame] = useState<Game | null>(null);
  const [players, setPlayers] = useState<GP[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("flights"); // land on the value: flights
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState(3);
  const [hcpDraft, setHcpDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoadErr(null);
    const { data: g, error: ge } = await supabase.from("games").select("*").eq("id", gameId).single();
    if (ge || !g) { setLoadErr("Couldn't load that game. Check the link, or that you're signed in as an organizer."); setLoading(false); return; }
    const { data: ps } = await supabase.from("game_players").select("*").eq("game_id", gameId).order("display_name", { ascending: true });
    setGame(g as any);
    setPlayers(((ps as any[]) || []) as GP[]);
    if ((g as any).flight_mode === "oneoff" && Array.isArray((g as any).flights) && (g as any).flights.length) setCount((g as any).flights.length);
    setLoading(false);
  }, [gameId, supabase]);
  useEffect(() => { load(); }, [load]);

  const flightsSupported = !!game && (game.game_type === "stroke" || game.game_type === "stableford");
  const flightsOn = !!game && game.flight_mode === "oneoff";
  const indexes = useMemo(() => players.map((p) => p.handicap_index), [players]);
  const needIdx = useMemo(() => players.filter((p) => p.handicap_index == null), [players]);
  // The live band definitions: persisted when flights are on, else a preview from the current field.
  const bands = useMemo<FlightBand[]>(() => {
    if (flightsOn && Array.isArray(game!.flights) && game!.flights.length) return game!.flights as FlightBand[];
    return autoSplitFlights(indexes, count);
  }, [flightsOn, game, indexes, count]);

  // ---- mutations ----
  const persistAssignments = async (assign: Record<string, string | null>, bandsToWrite?: FlightBand[]) => {
    setBusy(true);
    try {
      if (bandsToWrite) await supabase.from("games").update({ flight_mode: "oneoff", flights: bandsToWrite }).eq("id", gameId);
      await Promise.all(Object.entries(assign).map(([pid, key]) => supabase.from("game_players").update({ flight: key }).eq("id", pid)));
      await load();
    } finally { setBusy(false); }
  };
  const enableOrRebalance = async () => {
    if (needIdx.length) return;
    const b = autoSplitFlights(indexes, count);
    const assign: Record<string, string | null> = {};
    players.forEach((p) => { assign[p.id] = flightForIndex(p.handicap_index, b); });
    await persistAssignments(assign, b);
  };
  const changeCount = async (n: number) => {
    setCount(n);
    if (flightsOn && !needIdx.length) {
      const b = autoSplitFlights(indexes, n);
      const assign: Record<string, string | null> = {};
      players.forEach((p) => { assign[p.id] = flightForIndex(p.handicap_index, b); });
      await persistAssignments(assign, b);
    }
  };
  const assignOne = async (pid: string, key: string | null) => {
    setPlayers((ps) => ps.map((p) => (p.id === pid ? { ...p, flight: key } : p))); // optimistic
    setBusy(true);
    try { await supabase.from("game_players").update({ flight: key }).eq("id", pid); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await supabase.from("games").update({ flight_mode: "off", flights: null }).eq("id", gameId);
      await Promise.all(players.map((p) => supabase.from("game_players").update({ flight: null }).eq("id", p.id)));
      await load();
    } finally { setBusy(false); }
  };
  const setIndex = async (p: GP, val: number) => {
    setBusy(true);
    try {
      await supabase.from("game_players").update({ handicap_index: val }).eq("id", p.id);
      if (p.user_id) { try { await supabase.from("profiles").update({ handicap_index: val }).eq("id", p.user_id); } catch { /* non-blocking */ } }
      setHcpDraft((d) => { const nx = { ...d }; delete nx[p.id]; return nx; });
      await load();
    } finally { setBusy(false); }
  };

  if (loading) return <Center>Loading game…</Center>;
  if (loadErr || !game) return <Center>{loadErr || "Game not found."}</Center>;

  const fmtLabel = game.game_type === "stroke" ? "Stroke play" : game.game_type === "stableford" ? "Net Stableford" : game.game_type;
  const dateLabel = game.played_at ? new Date(game.played_at + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "";

  const Chip = ({ p, showPills }: { p: GP; showPills: boolean }) => (
    <div style={S.chip}>
      <Avatar src={p.avatar_url} name={p.display_name} size={30} />
      <div style={{ minWidth: 0 }}>
        <div style={S.chipName}>{p.display_name}{p.is_guest ? <span style={{ color: C.faint, fontWeight: 600 }}> · guest</span> : ""}</div>
        <div style={{ color: p.handicap_index == null ? C.birdie : C.faint, fontSize: 11 }}>
          {p.handicap_index == null ? "no index" : `idx ${p.handicap_index}`}
        </div>
      </div>
      {showPills && flightsOn && p.handicap_index != null ? (
        <div style={{ marginLeft: "auto", display: "flex", gap: 3, flexWrap: "wrap" }}>
          {bands.map((b) => (
            <button key={b.key} onClick={() => assignOne(p.id, b.key)} title={`Move to Flight ${b.key}`}
              style={{ ...S.pill, background: p.flight === b.key ? flightColor(b.key) : "transparent", color: p.flight === b.key ? "#06251A" : C.cream, borderColor: flightColor(b.key) }}>{b.key}</button>
          ))}
        </div>
      ) : p.flight ? (
        <span style={{ marginLeft: "auto", ...S.tag, background: flightColor(p.flight) }}>{p.flight}</span>
      ) : null}
    </div>
  );

  return (
    <div style={S.wrap}>
      <div style={S.console}>
        {/* top bar */}
        <div style={S.top}>
          <span style={S.brand}>Organizer</span>
          <span style={S.gctx}><b style={{ color: C.cream }}>{game.name}</b>{game.course ? ` · ${game.course}` : ""}{dateLabel ? ` · ${dateLabel}` : ""} · {fmtLabel}</span>
          <span style={{ flex: 1 }} />
          {busy ? <span style={{ color: C.sage, fontSize: 12 }}>Saving…</span> : null}
          <a href="/" style={S.saveBtn}>Done</a>
        </div>
        {/* steps */}
        <div style={S.steps}>
          {(["details", "field", "flights", "matchups"] as Step[]).map((s, i) => (
            <button key={s} onClick={() => setStep(s)} style={{ ...S.step, ...(step === s ? S.stepOn : {}) }}>
              <span style={{ opacity: 0.6, marginRight: 6 }}>{i + 1}</span>{s === "details" ? "Details" : s === "field" ? "Field" : s === "flights" ? "Flights" : "Matchups"}
            </button>
          ))}
        </div>
        {/* body */}
        <div style={S.body}>
          {/* field rail */}
          <div style={S.rail}>
            <div style={S.railHdr}><h3 style={S.railH3}>Field · {players.length}</h3>
              {needIdx.length ? <span style={{ color: C.birdie, fontSize: 11, fontWeight: 700 }}>{needIdx.length} need index</span> : <span style={{ color: C.sage, fontSize: 11 }}>all set</span>}
            </div>
            {players.map((p) => (
              <div key={p.id}>
                <Chip p={p} showPills={step === "flights"} />
                {p.handicap_index == null && step === "flights" ? (
                  <div style={{ display: "flex", gap: 6, margin: "-2px 0 8px", paddingLeft: 4 }}>
                    <input type="number" step="0.1" inputMode="decimal" placeholder="index"
                      value={hcpDraft[p.id] ?? ""}
                      onChange={(e) => setHcpDraft((d) => ({ ...d, [p.id]: e.target.value }))}
                      style={S.idxInput} />
                    <button disabled={busy || Number.isNaN(parseFloat(hcpDraft[p.id] ?? "")) || parseFloat(hcpDraft[p.id] ?? "") < 0 || parseFloat(hcpDraft[p.id] ?? "") > 54}
                      onClick={() => setIndex(p, parseFloat(hcpDraft[p.id]!))} style={S.setBtn}>Set</button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {/* canvas */}
          <div style={S.canvas}>
            {step === "flights" ? (
              !flightsSupported ? (
                <Note>Flights apply to individual stroke or Stableford games. This game is {fmtLabel}.</Note>
              ) : (
                <>
                  <div style={S.toolbar}>
                    <div style={{ display: "flex", gap: 6 }}>
                      {[2, 3, 4].map((n) => (
                        <button key={n} onClick={() => changeCount(n)} disabled={busy} style={{ ...S.tbtn, ...(count === n ? S.tbtnGold : {}) }}>{n} flights</button>
                      ))}
                    </div>
                    <button onClick={enableOrRebalance} disabled={busy || needIdx.length > 0} style={{ ...S.tbtn, ...S.tbtnGold, opacity: needIdx.length ? 0.4 : 1 }}>
                      {flightsOn ? "↺ Rebalance evenly" : "Enable flights"}
                    </button>
                    {flightsOn ? <button onClick={turnOff} disabled={busy} style={S.tbtn}>Turn off</button> : null}
                    <span style={{ color: C.sage, fontSize: 12, marginLeft: "auto", maxWidth: 320, textAlign: "right" }}>
                      {needIdx.length ? `Set an index for ${needIdx.length} player${needIdx.length === 1 ? "" : "s"} in the field (left) first.` : "Click a player's A/B/C to move them. Each flight has its own winner."}
                    </span>
                  </div>

                  {!flightsOn ? (
                    <Note>Preview of {count} even bands from the current field. Press <b>Enable flights</b> to apply — then move anyone by clicking their band letter.</Note>
                  ) : null}

                  <div style={{ ...S.cols, gridTemplateColumns: `repeat(${Math.min(bands.length, 4)}, 1fr)` }}>
                    {bands.map((b, i) => {
                      const inFlight = players.filter((p) => p.flight === b.key);
                      return (
                        <div key={b.key} style={S.col}>
                          <div style={S.colHdr}>
                            <span style={{ width: 11, height: 11, borderRadius: 4, background: flightColor(b.key) }} />
                            <span style={S.colTtl}>Flight {b.key}</span>
                            <span style={S.colSub}>index {flightRangeLabel(bands, i)}<br />{inFlight.length} player{inFlight.length === 1 ? "" : "s"}</span>
                          </div>
                          {flightsOn ? inFlight.map((p) => <Chip key={p.id} p={p} showPills />) : (
                            players.filter((p) => flightForIndex(p.handicap_index, bands) === b.key).map((p) => <Chip key={p.id} p={p} showPills={false} />)
                          )}
                          {flightsOn ? <div style={S.drop}>click a chip's “{b.key}” to move here</div> : null}
                        </div>
                      );
                    })}
                  </div>
                  {flightsOn ? (
                    <div style={{ marginTop: 14 }}>
                      {players.filter((p) => !p.flight).length ? (
                        <div style={{ ...S.col, borderColor: "rgba(184,58,46,.4)" }}>
                          <div style={S.colHdr}><span style={S.colTtl}>Unassigned</span><span style={S.colSub}>{players.filter((p) => !p.flight).length}</span></div>
                          {players.filter((p) => !p.flight).map((p) => <Chip key={p.id} p={p} showPills />)}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )
            ) : step === "details" ? (
              <div style={{ maxWidth: 460 }}>
                <Row k="Game" v={game.name} />
                <Row k="Course" v={game.course || "—"} />
                <Row k="Date" v={dateLabel || "—"} />
                <Row k="Format" v={fmtLabel} />
                <Row k="Allowance" v={`${game.allowance_pct ?? 100}%`} />
                <Row k="Field" v={`${players.length} players`} />
                <Row k="Flights" v={flightsOn ? `${bands.length} bands` : "off"} />
                <Note>Editing details and building the field/create flow from the console arrives in the next phase. For now the game is created on the phone; the console organizes it.</Note>
              </div>
            ) : step === "field" ? (
              <Note>Full field management (add / remove members and guests, set indexes here) is the next phase. For now, set any missing indexes from the field list on the left while on the Flights step, and add players from the phone.</Note>
            ) : (
              <Note>Matchups — tee groups, foursomes and 1-v-1 pairings — is the next phase of the console. The columns will work just like Flights: click a player to drop them into a group.</Note>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => (
  <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: C.green, color: C.cream, fontSize: 15, padding: 24, textAlign: "center" }}>{children}</div>
);
const Note = ({ children }: { children: React.ReactNode }) => (
  <div style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "14px 16px", color: C.sage, fontSize: 13, lineHeight: 1.5, maxWidth: 640 }}>{children}</div>
);
const Row = ({ k, v }: { k: string; v: string }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,.08)" }}>
    <span style={{ color: C.sage, fontSize: 13 }}>{k}</span><span style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>{v}</span>
  </div>
);

const S: Record<string, React.CSSProperties> = {
  wrap: { minHeight: "100vh", background: "#08140f", padding: 22, display: "flex", justifyContent: "center" },
  console: { width: "100%", maxWidth: 1160, background: C.green, borderRadius: 16, overflow: "hidden", border: "1px solid rgba(255,255,255,.06)", boxShadow: "0 20px 70px rgba(0,0,0,.5)", alignSelf: "flex-start" },
  top: { display: "flex", alignItems: "center", gap: 14, padding: "14px 18px", background: "rgba(8,20,15,.5)", borderBottom: "1px solid rgba(255,255,255,.08)" },
  brand: { fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 17, color: C.cream },
  gctx: { color: C.sage, fontSize: 13 },
  saveBtn: { fontSize: 13, fontWeight: 800, color: C.cream, background: C.greenLight, border: "1px solid rgba(255,255,255,.15)", borderRadius: 9, padding: "8px 16px", cursor: "pointer", textDecoration: "none" },
  steps: { display: "flex", gap: 4, padding: "10px 16px 0", background: "rgba(8,20,15,.25)" },
  step: { fontSize: 13, fontWeight: 700, color: C.sage, padding: "9px 16px", borderRadius: "10px 10px 0 0", cursor: "pointer", border: "none", background: "transparent" },
  stepOn: { color: "#06251A", background: C.cream, fontWeight: 800 },
  body: { display: "grid", gridTemplateColumns: "300px 1fr", minHeight: 520 },
  rail: { background: "rgba(8,20,15,.28)", borderRight: "1px solid rgba(255,255,255,.08)", padding: 14, maxHeight: "78vh", overflowY: "auto" },
  railHdr: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  railH3: { fontSize: 11, letterSpacing: 3, fontWeight: 700, textTransform: "uppercase", color: C.gold, marginTop: 16, marginBottom: 8 },
  chip: { display: "flex", alignItems: "center", gap: 9, background: C.card, borderRadius: 11, padding: "8px 10px", marginBottom: 8, boxShadow: "0 1px 0 rgba(0,0,0,.04)" },
  chipName: { color: C.ink, fontWeight: 700, fontSize: 13, lineHeight: 1.1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  tag: { fontSize: 11, fontWeight: 800, color: "#06251A", borderRadius: 6, padding: "2px 7px" },
  pill: { fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "2px 7px", border: "1.5px solid", cursor: "pointer" },
  idxInput: { width: 74, background: C.greenMid, border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "5px 8px", color: C.cream, fontSize: 12, textAlign: "center" },
  setBtn: { fontSize: 12, fontWeight: 800, background: C.gold, color: "#06251A", border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer" },
  canvas: { padding: "16px 18px", maxHeight: "78vh", overflowY: "auto" },
  toolbar: { display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" },
  tbtn: { fontSize: 13, fontWeight: 700, background: C.greenLight, border: "1px solid rgba(255,255,255,.14)", color: C.cream, borderRadius: 9, padding: "8px 13px", cursor: "pointer" },
  tbtnGold: { background: C.gold, color: "#06251A", borderColor: "transparent", fontWeight: 800 },
  cols: { display: "grid", gap: 14 },
  col: { background: "rgba(8,20,15,.22)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 13, padding: 12, minHeight: 260 },
  colHdr: { display: "flex", alignItems: "center", gap: 8, marginBottom: 10 },
  colTtl: { fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15, color: C.cream },
  colSub: { color: C.sage, fontSize: 11, marginLeft: "auto", textAlign: "right", lineHeight: 1.3 },
  drop: { border: "1.5px dashed rgba(255,255,255,.16)", borderRadius: 10, padding: 9, textAlign: "center", color: C.faint, fontSize: 11, marginTop: 6 },
};
