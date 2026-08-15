"use client";
import React, { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, Eyebrow, BottomSheet, Avatar } from "@/components/ui";
import {
  Contest, ContestEntry, ContestKind, ContestUnit,
  contestLeaderboard, contestDefaults, fmtContestValue, ftInToInches,
} from "@/lib/contests";

const supabase = createClient();

type P = { user_id: string | null; display_name: string; is_marker?: boolean | null; is_guest?: boolean | null };

const KIND_ICON: Record<string, string> = { ctp: "🎯", long_drive: "💪", straightest: "📏", custom: "🏁" };

export function ContestsSection({
  gameId, holesMeta, players, userId, myName, isOrganizer, isEnded,
}: {
  gameId: string;
  holesMeta: { n: number; par: number }[];
  players: P[];
  userId: string;
  myName: string;
  isOrganizer: boolean;
  isEnded: boolean;
}) {
  const [contests, setContests] = useState<Contest[]>([]);
  const [entries, setEntries] = useState<ContestEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(true);
  const [adding, setAdding] = useState(false);
  const [logCtx, setLogCtx] = useState<{ contest: Contest; hole: number } | null>(null);
  const [expand, setExpand] = useState<string | null>(null); // "contestId:hole"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const meMarks = players.some((p) => p.user_id === userId && p.is_marker);
  const canLogOthers = isOrganizer || meMarks;
  const par3s = useMemo(() => holesMeta.filter((h) => h.par === 3).map((h) => h.n), [holesMeta]);
  const allHoles = useMemo(() => holesMeta.map((h) => h.n), [holesMeta]);

  const load = async () => {
    const { data: cs, error: e1 } = await supabase.from("game_contests").select("*").eq("game_id", gameId);
    if (e1) { setErr(e1.message); setLoading(false); return; }
    const list = (cs || []) as Contest[];
    list.sort((a, b) => a.created_at! < b.created_at! ? -1 : 1);
    setContests(list);
    if (list.length) {
      const { data: es } = await supabase.from("game_contest_entries").select("*").in("contest_id", list.map((c) => c.id));
      setEntries((es || []) as ContestEntry[]);
    } else setEntries([]);
    setLoading(false);
  };
  useEffect(() => {
    load();
    const ch = supabase.channel(`contests-${gameId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_contest_entries" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "game_contests", filter: `game_id=eq.${gameId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [gameId]);

  const createContest = async (kind: ContestKind, holes: number[]) => {
    const d = contestDefaults(kind);
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("create_game_contest", {
      p_game: gameId, p_kind: kind, p_label: d.label, p_holes: holes, p_unit: d.unit, p_better: d.better,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setAdding(false); await load();
  };

  const removeContest = async (c: Contest) => {
    if (!confirm(`Remove "${c.label}"? Its entries are deleted too.`)) return;
    const { error } = await supabase.rpc("delete_game_contest", { p_contest: c.id });
    if (error) { setErr(error.message); return; }
    await load();
  };

  const voidEntry = async (e: ContestEntry) => {
    const { error } = await supabase.rpc("void_contest_entry", { p_entry: e.id, p_void: true });
    if (error) { setErr(error.message); return; }
    await load();
  };

  // hide entirely for non-organizers when there's nothing to show
  if (loading) return null;
  if (contests.length === 0 && !isOrganizer) return null;

  return (
    <div style={{ background: C.greenMid, borderRadius: 16, padding: 14, marginTop: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Eyebrow style={{ margin: 0, flex: 1 }}>SIDE CONTESTS</Eyebrow>
        {isOrganizer && !isEnded && (
          <button onClick={() => { setAdding(true); setErr(null); }} style={{ ...btn(false), fontSize: 12, padding: "6px 11px" }}>+ Add</button>
        )}
        {contests.length > 0 && (
          <button onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"}
            style={{ background: "none", border: "none", color: C.sage, fontSize: 18, cursor: "pointer", lineHeight: 1, padding: 4 }}>{open ? "▾" : "▸"}</button>
        )}
      </div>

      {err && <div style={{ color: "#ef9d90", fontSize: 12, marginTop: 8 }}>{err}</div>}

      {contests.length === 0 && isOrganizer && (
        <div style={{ color: C.sage, fontSize: 12.5, marginTop: 8, lineHeight: 1.5 }}>
          No side contests yet. Add closest-to-pin (all par-3s), a longest drive, or straightest drive — players and scorers can then log results from here.
        </div>
      )}

      {open && contests.map((c) => {
        const board = contestLeaderboard(c, entries);
        return (
          <div key={c.id} style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>{KIND_ICON[c.kind] || "🏁"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{c.label}</div>
                <div style={{ color: C.sage, fontSize: 11 }}>
                  {c.kind === "ctp" && c.holes.length > 1 ? `${c.holes.length} par-3s` : `Hole ${c.holes.join(", ")}`} · {c.better === "low" ? "closest wins" : "longest wins"}
                </div>
              </div>
              {isOrganizer && !isEnded && (
                <button onClick={() => removeContest(c)} aria-label="Remove contest"
                  style={{ background: "rgba(255,255,255,0.12)", border: "none", color: C.cream, width: 26, height: 26, borderRadius: 13, fontSize: 15, cursor: "pointer", lineHeight: 1 }}>×</button>
              )}
            </div>

            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {board.map((w) => {
                const key = `${c.id}:${w.hole}`;
                const expanded = expand === key;
                return (
                  <div key={w.hole} style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ color: C.sage, fontSize: 12, width: 34, flexShrink: 0 }}>#{w.hole}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        {w.best ? (
                          <span style={{ color: C.cream, fontSize: 13 }}>
                            <b style={{ fontFamily: "Georgia, serif", color: C.gold }}>{fmtContestValue(c.unit, w.best.value)}</b> — {w.best.player_name}
                          </span>
                        ) : <span style={{ color: C.sage, fontSize: 12.5 }}>no entries yet</span>}
                      </div>
                      {w.attempts.length > 1 && (
                        <button onClick={() => setExpand(expanded ? null : key)} style={{ background: "none", border: "none", color: C.sage, fontSize: 11, cursor: "pointer", padding: 2 }}>
                          {expanded ? "hide" : `${w.attempts.length} attempts`}
                        </button>
                      )}
                      {!isEnded && (
                        <button onClick={() => { setLogCtx({ contest: c, hole: w.hole }); setErr(null); }} style={{ ...btn(false), fontSize: 11.5, padding: "5px 10px" }}>Log</button>
                      )}
                    </div>
                    {expanded && (
                      <div style={{ marginTop: 4, paddingLeft: 42, display: "flex", flexDirection: "column", gap: 3 }}>
                        {w.attempts.map((a) => {
                          const canVoid = isOrganizer || a.recorded_by === userId;
                          return (
                            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
                              <span style={{ color: C.cream, fontFamily: "Georgia, serif", minWidth: 52 }}>{fmtContestValue(c.unit, a.value)}</span>
                              <span style={{ color: C.sage, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.player_name}</span>
                              {canVoid && !isEnded && (
                                <button onClick={() => voidEntry(a)} style={{ background: "none", border: "none", color: "#ef9d90", fontSize: 11, cursor: "pointer", padding: 2 }}>void</button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {adding && (
        <AddContestSheet par3s={par3s} allHoles={allHoles} busy={busy}
          onClose={() => setAdding(false)} onCreate={createContest} />
      )}
      {logCtx && (
        <LogEntrySheet ctx={logCtx} players={players} userId={userId} myName={myName} canLogOthers={canLogOthers}
          onClose={() => setLogCtx(null)}
          onDone={async () => { setLogCtx(null); await load(); }} setErr={setErr} />
      )}
    </div>
  );
}

// ---- organizer: add a contest ----
function AddContestSheet({ par3s, allHoles, busy, onClose, onCreate }: {
  par3s: number[]; allHoles: number[]; busy: boolean;
  onClose: () => void; onCreate: (kind: ContestKind, holes: number[]) => void;
}) {
  const [kind, setKind] = useState<ContestKind | null>(null);
  const [hole, setHole] = useState<number | null>(null);

  const kinds: { k: ContestKind; label: string; sub: string }[] = [
    { k: "ctp", label: "🎯 Closest to the pin", sub: par3s.length ? `all par-3s (${par3s.join(", ")})` : "no par-3s on this course" },
    { k: "long_drive", label: "💪 Longest drive", sub: "pick a hole" },
    { k: "straightest", label: "📏 Straightest drive", sub: "pick a hole" },
  ];
  const needsHole = kind === "long_drive" || kind === "straightest";
  const canCreate = kind === "ctp" ? par3s.length > 0 : needsHole ? hole != null : false;

  return (
    <BottomSheet onClose={onClose} maxWidth={460} panelStyle={{ background: C.greenMid }}
      header={<div style={{ padding: "14px 44px 10px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ color: C.cream, fontSize: 16, fontWeight: 800 }}>Add a side contest</div>
      </div>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {kinds.map((x) => (
          <button key={x.k} disabled={x.k === "ctp" && par3s.length === 0}
            onClick={() => { setKind(x.k); setHole(null); }}
            style={{ textAlign: "left", background: kind === x.k ? C.greenLight : "rgba(255,255,255,0.05)", border: `1px solid ${kind === x.k ? C.gold : "transparent"}`, borderRadius: 12, padding: "11px 13px", cursor: "pointer", opacity: x.k === "ctp" && par3s.length === 0 ? 0.5 : 1 }}>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: 14 }}>{x.label}</div>
            <div style={{ color: C.sage, fontSize: 11.5, marginTop: 1 }}>{x.sub}</div>
          </button>
        ))}
      </div>

      {needsHole && (
        <div style={{ marginTop: 14 }}>
          <div style={{ color: C.sage, fontSize: 12, marginBottom: 6 }}>On which hole?</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allHoles.map((h) => (
              <button key={h} onClick={() => setHole(h)}
                style={{ width: 38, height: 38, borderRadius: 10, border: `1px solid ${hole === h ? C.gold : "rgba(255,255,255,0.15)"}`, background: hole === h ? C.greenLight : "transparent", color: C.cream, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>{h}</button>
            ))}
          </div>
        </div>
      )}

      <button disabled={!canCreate || busy}
        onClick={() => onCreate(kind!, kind === "ctp" ? par3s : [hole!])}
        style={{ ...btn(true), width: "100%", marginTop: 16, opacity: !canCreate || busy ? 0.5 : 1 }}>
        {busy ? "Adding…" : "Add contest"}
      </button>
    </BottomSheet>
  );
}

// ---- log an attempt (self, or for another player if scorer/organizer) ----
function LogEntrySheet({ ctx, players, userId, myName, canLogOthers, onClose, onDone, setErr }: {
  ctx: { contest: Contest; hole: number };
  players: P[]; userId: string; myName: string; canLogOthers: boolean;
  onClose: () => void; onDone: () => void; setErr: (s: string | null) => void;
}) {
  const { contest, hole } = ctx;
  const isFtIn = contest.unit === "ft_in";
  const [feet, setFeet] = useState("");
  const [inches, setInches] = useState("");
  const [num, setNum] = useState(""); // yards / ft-from-center
  const [who, setWho] = useState<string>("me"); // "me" | user_id | "guest:<idx>"
  const [busy, setBusy] = useState(false);

  const guests = players.filter((p) => !p.user_id);
  const members = players.filter((p) => p.user_id && p.user_id !== userId);

  const save = async () => {
    const value = isFtIn ? ftInToInches(Number(feet) || 0, Number(inches) || 0) : Number(num);
    if (!isFtIn && (!num || Number.isNaN(value))) { setErr("Enter a number."); return; }
    if (isFtIn && !feet && !inches) { setErr("Enter feet and/or inches."); return; }
    let p_player: string | null = userId, p_guest: string | null = null, p_name = myName;
    if (who !== "me") {
      if (who.startsWith("guest:")) {
        const g = guests[Number(who.slice(6))];
        p_player = null; p_guest = null; p_name = g?.display_name || "Guest";
      } else {
        const m = members.find((x) => x.user_id === who);
        p_player = who; p_name = m?.display_name || "Player";
      }
    }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("log_contest_entry", {
      p_contest: contest.id, p_hole: hole, p_player, p_guest, p_player_name: p_name, p_value: value,
    });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onDone();
  };

  return (
    <BottomSheet onClose={onClose} maxWidth={420} panelStyle={{ background: C.greenMid }}
      header={<div style={{ padding: "14px 44px 10px 16px", borderBottom: "1px solid rgba(255,255,255,0.1)" }}>
        <div style={{ color: C.cream, fontSize: 16, fontWeight: 800 }}>{contest.label} — hole {hole}</div>
        <div style={{ color: C.sage, fontSize: 11.5, marginTop: 2 }}>{contest.better === "low" ? "Lowest wins" : "Longest wins"}</div>
      </div>}>
      {isFtIn ? (
        <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label style={{ flex: 1 }}>
            <div style={{ color: C.sage, fontSize: 11, marginBottom: 4 }}>Feet</div>
            <input inputMode="numeric" value={feet} onChange={(e) => setFeet(e.target.value.replace(/[^0-9]/g, ""))}
              style={inp} placeholder="0" />
          </label>
          <label style={{ flex: 1 }}>
            <div style={{ color: C.sage, fontSize: 11, marginBottom: 4 }}>Inches</div>
            <input inputMode="numeric" value={inches} onChange={(e) => setInches(e.target.value.replace(/[^0-9]/g, ""))}
              style={inp} placeholder="0" />
          </label>
        </div>
      ) : (
        <label>
          <div style={{ color: C.sage, fontSize: 11, marginBottom: 4 }}>{contest.unit === "yards" ? "Yards" : "Feet from center"}</div>
          <input inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ""))} style={inp} placeholder="0" />
        </label>
      )}

      <div style={{ marginTop: 14 }}>
        <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>Who?</div>
        <select value={who} onChange={(e) => setWho(e.target.value)} disabled={!canLogOthers}
          style={{ ...inp, opacity: canLogOthers ? 1 : 0.7 }}>
          <option value="me">Me ({myName})</option>
          {canLogOthers && members.map((m) => <option key={m.user_id!} value={m.user_id!}>{m.display_name}</option>)}
          {canLogOthers && guests.map((g, i) => <option key={`g${i}`} value={`guest:${i}`}>{g.display_name} (guest)</option>)}
        </select>
        {!canLogOthers && <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Only a scorer or the organizer can log for other players.</div>}
      </div>

      <button disabled={busy} onClick={save} style={{ ...btn(true), width: "100%", marginTop: 16 }}>{busy ? "Saving…" : "Log it"}</button>
    </BottomSheet>
  );
}

const inp: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: C.greenLight, border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 10, color: C.cream, fontSize: 16, padding: "10px 12px", outline: "none",
};

// ---- contextual chip shown inside the (light) hole score-entry modal ----
// Self-contained: fetches this game's contests that apply to `hole`, shows the current leader, and logs
// inline (no nested sheet). Styled for the light modal (dark text on a soft tint).
export function ContestHoleChip({ gameId, hole, players, userId, myName, canLogOthers }: {
  gameId: string; hole: number; players: P[]; userId: string; myName: string; canLogOthers: boolean;
}) {
  const [rows, setRows] = useState<{ contest: Contest; entries: ContestEntry[] }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const { data: cs } = await supabase.from("game_contests").select("*").eq("game_id", gameId);
    const apply = ((cs || []) as Contest[]).filter((c) => c.holes.includes(hole));
    if (!apply.length) { setRows([]); return; }
    const { data: es } = await supabase.from("game_contest_entries").select("*").in("contest_id", apply.map((c) => c.id));
    const all = (es || []) as ContestEntry[];
    setRows(apply.map((c) => ({ contest: c, entries: all.filter((e) => e.contest_id === c.id) })));
  };
  useEffect(() => { load(); }, [gameId, hole]);

  if (rows.length === 0) return null;

  return (
    <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 8 }}>
      {rows.map(({ contest, entries }) => {
        const board = contestLeaderboard(contest, entries).find((w) => w.hole === hole);
        const best = board?.best || null;
        const open = openId === contest.id;
        return (
          <div key={contest.id} style={{ background: "#EAF3EC", border: "1px solid #CFE3D4", borderRadius: 12, padding: "10px 12px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 16 }}>{KIND_ICON[contest.kind] || "🏁"}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#14351f", fontWeight: 800, fontSize: 13 }}>{contest.label}</div>
                <div style={{ color: "#4a6b54", fontSize: 11.5 }}>
                  {best ? <>best <b style={{ fontFamily: "Georgia, serif" }}>{fmtContestValue(contest.unit, best.value)}</b> — {best.player_name}</> : "no entries yet — be the first"}
                </div>
              </div>
              <button onClick={() => setOpenId(open ? null : contest.id)}
                style={{ background: "#14351f", color: "#EAF3EC", border: "none", borderRadius: 8, padding: "6px 11px", fontWeight: 800, fontSize: 12, cursor: "pointer" }}>
                {open ? "Close" : "Log ›"}
              </button>
            </div>
            {open && <InlineLog contest={contest} hole={hole} players={players} userId={userId} myName={myName} canLogOthers={canLogOthers}
              onSaved={async () => { setOpenId(null); await load(); }} />}
          </div>
        );
      })}
    </div>
  );
}

function InlineLog({ contest, hole, players, userId, myName, canLogOthers, onSaved }: {
  contest: Contest; hole: number; players: P[]; userId: string; myName: string; canLogOthers: boolean; onSaved: () => void;
}) {
  const isFtIn = contest.unit === "ft_in";
  const [feet, setFeet] = useState(""); const [inches, setInches] = useState(""); const [num, setNum] = useState("");
  const [who, setWho] = useState("me"); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  const guests = players.filter((p) => !p.user_id);
  const members = players.filter((p) => p.user_id && p.user_id !== userId);
  const li: React.CSSProperties = { width: "100%", boxSizing: "border-box", background: "#fff", border: "1px solid #CFE3D4", borderRadius: 8, color: "#14351f", fontSize: 16, padding: "8px 10px", outline: "none" };

  const save = async () => {
    const value = isFtIn ? ftInToInches(Number(feet) || 0, Number(inches) || 0) : Number(num);
    if (isFtIn ? (!feet && !inches) : (!num || Number.isNaN(value))) { setErr("Enter a value."); return; }
    let p_player: string | null = userId, p_guest: string | null = null, p_name = myName;
    if (who !== "me") {
      if (who.startsWith("guest:")) { p_player = null; p_guest = null; p_name = guests[Number(who.slice(6))]?.display_name || "Guest"; }
      else { p_player = who; p_name = members.find((m) => m.user_id === who)?.display_name || "Player"; }
    }
    setBusy(true); setErr(null);
    const { error } = await supabase.rpc("log_contest_entry", { p_contest: contest.id, p_hole: hole, p_player, p_guest, p_player_name: p_name, p_value: value });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    onSaved();
  };

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {isFtIn ? (
        <div style={{ display: "flex", gap: 8 }}>
          <input inputMode="numeric" value={feet} onChange={(e) => setFeet(e.target.value.replace(/[^0-9]/g, ""))} placeholder="feet" style={li} />
          <input inputMode="numeric" value={inches} onChange={(e) => setInches(e.target.value.replace(/[^0-9]/g, ""))} placeholder="inches" style={li} />
        </div>
      ) : (
        <input inputMode="numeric" value={num} onChange={(e) => setNum(e.target.value.replace(/[^0-9]/g, ""))} placeholder={contest.unit === "yards" ? "yards" : "feet from center"} style={li} />
      )}
      {canLogOthers && (members.length > 0 || guests.length > 0) && (
        <select value={who} onChange={(e) => setWho(e.target.value)} style={li}>
          <option value="me">Me ({myName})</option>
          {members.map((m) => <option key={m.user_id!} value={m.user_id!}>{m.display_name}</option>)}
          {guests.map((g, i) => <option key={`g${i}`} value={`guest:${i}`}>{g.display_name} (guest)</option>)}
        </select>
      )}
      {err && <div style={{ color: "#b3382c", fontSize: 12 }}>{err}</div>}
      <button disabled={busy} onClick={save} style={{ background: "#14351f", color: "#EAF3EC", border: "none", borderRadius: 8, padding: "9px 4px", fontWeight: 800, fontSize: 13, cursor: "pointer" }}>{busy ? "Saving…" : "Log it"}</button>
    </div>
  );
}
