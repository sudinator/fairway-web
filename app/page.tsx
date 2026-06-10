"use client";

import React, { useEffect, useState, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, BarChart, Bar, Cell,
} from "recharts";
import { createClient } from "@/lib/supabase";
import {
  C, Round, Hole, courseHandicap, strokesReceived, stablefordPts,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate,
  girStats, firStats, pct, holeBuckets,
} from "@/lib/golf";
import { STARTER_COURSES, buildCustomCourse, Course } from "@/lib/courses";
import { btn, inputStyle, Eyebrow, StatCard, ClassicCard } from "@/components/ui";

const supabase = createClient();

// ---------------- Auth gate ----------------
export default function Page() {
  const [session, setSession] = useState<any>(undefined); // undefined = loading
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined)
    return <Shell><div style={{ color: C.sage, textAlign: "center", paddingTop: 100 }}>Loading…</div></Shell>;
  if (!session) return <Shell><Login /></Shell>;
  return <Shell><Home session={session} /></Shell>;
}

function Login() {
  const signIn = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
  };
  return (
    <div style={{ maxWidth: 420, margin: "80px auto", padding: 24, textAlign: "center" }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 42, fontWeight: 700 }}>Fairway Card</div>
      <div style={{ color: C.sage, fontSize: 15, marginTop: 8 }}>Track your scores, handicap & stats.</div>
      <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, marginTop: 30 }}>
        <button onClick={signIn}
          style={{ ...btn(true), width: "100%", display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "14px" }}>
          <span style={{ background: "#fff", borderRadius: 4, width: 22, height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#4285F4", fontWeight: 900 }}>G</span>
          Continue with Google
        </button>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 16, lineHeight: 1.5 }}>
          One tap to sign in. Your rounds are private to you — no one else can see them.
        </div>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: "100vh", background: C.green }}>{children}</div>;
}

// ---------------- Home (logged in) ----------------
function Home({ session }: { session: any }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState<number | null>(null);
  const [tab, setTab] = useState<"dashboard" | "rounds">("dashboard");
  const [stage, setStage] = useState<null | "setup" | { round: Round }>(null);
  const [viewing, setViewing] = useState<Round | null>(null);

  const user = session.user;
  const displayName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";

  // Load this user's handicap index from localStorage (per-device, simple)
  useEffect(() => {
    const saved = localStorage.getItem("fc-index-" + user.id);
    if (saved) setIndex(parseFloat(saved));
  }, [user.id]);
  const saveIndex = (idx: number | null) => {
    setIndex(idx);
    if (idx == null) localStorage.removeItem("fc-index-" + user.id);
    else localStorage.setItem("fc-index-" + user.id, String(idx));
  };

  const loadRounds = useCallback(async () => {
    setLoading(true);
    const { data: rs } = await supabase
      .from("rounds").select("*").order("played_at", { ascending: false });
    if (!rs) { setRounds([]); setLoading(false); return; }
    const ids = rs.map((r) => r.id);
    const { data: hs } = await supabase
      .from("holes").select("*").in("round_id", ids.length ? ids : ["none"]);
    const byRound: Record<string, Hole[]> = {};
    (hs || []).forEach((h: any) => {
      (byRound[h.round_id] ||= []).push(h);
    });
    const merged: Round[] = rs.map((r: any) => {
      const holes = (byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number)
        .map((h) => ({ ...h, recv: strokesReceived(h.stroke_index, r.course_handicap) }));
      return { ...r, holes };
    });
    setRounds(merged);
    setLoading(false);
  }, []);

  useEffect(() => { loadRounds(); }, [loadRounds]);

  const deleteRound = async (id: string) => {
    await supabase.from("rounds").delete().eq("id", id);
    await loadRounds();
  };

  const inFlow = stage || viewing;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 700 }}>Fairway Card</div>
        <div style={{ color: C.sage, fontSize: 13 }}>{displayName}{index != null ? ` · HCP ${index}` : ""}</div>
        <div style={{ flex: 1 }} />
        <button style={{ ...btn(false), fontSize: 12 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button style={btn(true)} onClick={() => { setStage("setup"); setViewing(null); }}>＋ New round</button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: `1px solid ${C.greenMid}` }}>
        {(["dashboard", "rounds"] as const).map((k) => (
          <button key={k} onClick={() => { setTab(k); setStage(null); setViewing(null); }}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
              color: tab === k && !inFlow ? C.gold : C.sage,
              borderBottom: tab === k && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
            }}>{k === "dashboard" ? "Dashboard" : "Rounds"}</button>
        ))}
      </div>

      <div style={{ marginTop: 20 }}>
        {stage === "setup" ? (
          <RoundSetup index={index} saveIndex={saveIndex} onCancel={() => setStage(null)}
            onReady={(round) => setStage({ round })} />
        ) : stage && "round" in stage ? (
          <RoundEditor round={stage.round} onCancel={() => setStage(null)}
            onSaved={async () => { await loadRounds(); setStage(null); setTab("rounds"); }} />
        ) : viewing ? (
          <RoundDetail round={viewing} onBack={() => setViewing(null)}
            onEdit={() => { setStage({ round: viewing }); setViewing(null); }}
            onDelete={async () => { await deleteRound(viewing.id); setViewing(null); }} />
        ) : loading ? (
          <div style={{ color: C.sage, textAlign: "center", padding: 40 }}>Loading your rounds…</div>
        ) : tab === "dashboard" ? (
          <Dashboard rounds={rounds} name={displayName} onOpen={setViewing} />
        ) : (
          <RoundsList rounds={rounds} onOpen={setViewing} />
        )}
      </div>
    </div>
  );
}

// ---------------- Round setup ----------------
function RoundSetup({ index, saveIndex, onReady, onCancel }: {
  index: number | null;
  saveIndex: (i: number | null) => void;
  onReady: (r: Round) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Course | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState(index != null ? String(index) : "");
  const [showCustom, setShowCustom] = useState(false);
  // live search state
  const [searching, setSearching] = useState(false);
  const [loadingId, setLoadingId] = useState<number | null>(null);
  const [results, setResults] = useState<{ id: number; name: string; location: string }[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  // custom course fields
  const [cName, setCName] = useState("");
  const [cLoc, setCLoc] = useState("");
  const [cPar, setCPar] = useState("72");
  const [cRating, setCRating] = useState("");
  const [cSlope, setCSlope] = useState("");

  // Search the online golf course database (falls back to starter list on error).
  const runSearch = async () => {
    if (!q.trim()) return;
    setSearching(true); setSearchErr(null); setResults(null);
    try {
      const res = await fetch(`/api/courses?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.courses || []);
    } catch (e: any) {
      setSearchErr(e.message || "Couldn't reach the course database.");
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // When a search result is tapped, pull its full tee + hole data.
  const pickFromApi = async (id: number) => {
    setLoadingId(id); setSearchErr(null);
    try {
      const res = await fetch(`/api/courses?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Course load failed");
      const c = data.course;
      if (!c.tees || !c.tees.length) { setSearchErr("That course has no tee data — try another or add it manually."); return; }
      setPicked(c); setTeeIdx(0);
    } catch (e: any) {
      setSearchErr(e.message || "Couldn't load that course.");
    } finally {
      setLoadingId(null);
    }
  };

  // Starter-list matches (shown before any search, and as a fallback).
  const starterMatches = q.trim().length
    ? STARTER_COURSES.filter((c) =>
        (c.name + " " + c.location).toLowerCase().includes(q.trim().toLowerCase()))
    : STARTER_COURSES;

  const tee = picked?.tees[teeIdx];
  const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
  const realCH = tee && idxVal != null ? courseHandicap(idxVal, tee.slope, tee.rating, tee.par) : null;

  const makeCustom = () => {
    const c = buildCustomCourse(
      cName.trim() || "My course", cLoc.trim(),
      parseInt(cPar) || 72, parseFloat(cRating) || 72, parseFloat(cSlope) || 113
    );
    setPicked(c); setTeeIdx(0); setShowCustom(false);
  };

  const start = () => {
    if (!picked || !tee) return;
    if (idxVal != null && idxVal !== index) saveIndex(idxVal);
    const holes: Hole[] = picked.holes.map((h) => ({
      hole_number: h.n, par: h.par, stroke_index: h.si,
      strokes: null, putts: null, fairway: null, penalties: 0,
      recv: realCH != null ? strokesReceived(h.si, realCH) : 0,
    }));
    onReady({
      id: "", course: picked.name, tee_name: tee.name,
      rating: tee.rating, slope: tee.slope, course_par: tee.par,
      handicap_index: idxVal, course_handicap: realCH,
      played_at: new Date().toISOString().slice(0, 10),
      holes,
    });
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <Eyebrow>NEW ROUND · STEP 1 OF 2</Eyebrow>

      {!picked && !showCustom && (
        <>
          <div style={{ marginTop: 14 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Search for your course (≈30,000 courses worldwide)</label>
            <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
              <input style={inputStyle} value={q} placeholder="Type a course name…"
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && q.trim() && runSearch()} />
              <button style={{ ...btn(true), whiteSpace: "nowrap", opacity: q.trim() ? 1 : 0.5 }}
                disabled={!q.trim() || searching} onClick={runSearch}>
                {searching ? "Searching…" : "Search"}
              </button>
            </div>
          </div>

          {searchErr && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{searchErr}</div>}

          {/* Live database results */}
          {results && results.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <Eyebrow>DATABASE RESULTS</Eyebrow>
              {results.map((c) => (
                <button key={c.id} onClick={() => pickFromApi(c.id)} disabled={loadingId != null}
                  style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, cursor: "pointer", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px", opacity: loadingId != null && loadingId !== c.id ? 0.5 : 1 }}>
                  <span style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                  {c.location ? <span style={{ color: C.faint, fontSize: 13 }}> · {c.location}</span> : null}
                  {loadingId === c.id ? <span style={{ color: C.gold, fontSize: 12 }}> · loading…</span> : null}
                </button>
              ))}
            </div>
          )}

          {results && results.length === 0 && !searchErr && (
            <div style={{ color: C.sage, fontSize: 13, marginTop: 10 }}>No courses found in the database for that name.</div>
          )}

          {/* Starter list — shown before searching, or as a fallback */}
          {(!results || results.length === 0) && starterMatches.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Eyebrow>{results ? "OR PICK FROM BUILT-IN" : "POPULAR COURSES"}</Eyebrow>
              {starterMatches.map((c) => (
                <button key={c.id} onClick={() => { setPicked(c); setTeeIdx(0); }}
                  style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, cursor: "pointer", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}>
                  <span style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{c.name}</span>
                  <span style={{ color: C.faint, fontSize: 13 }}> · {c.location}</span>
                </button>
              ))}
            </div>
          )}

          <button style={{ ...btn(false), marginTop: 14 }} onClick={() => setShowCustom(true)}>＋ Add a course manually</button>
        </>
      )}

      {showCustom && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
          <Eyebrow>ADD YOUR COURSE</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
            Enter the details from the physical scorecard. Rating &amp; slope are printed on it (look for numbers like 72.1 / 130).
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
            <div style={{ flex: 2, minWidth: 200 }}>
              <label style={{ color: C.sage, fontSize: 12 }}>Course name</label>
              <input style={{ ...inputStyle, marginTop: 4 }} value={cName} onChange={(e) => setCName(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 140 }}>
              <label style={{ color: C.sage, fontSize: 12 }}>Location</label>
              <input style={{ ...inputStyle, marginTop: 4 }} value={cLoc} onChange={(e) => setCLoc(e.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ flex: 1, minWidth: 90 }}>
              <label style={{ color: C.sage, fontSize: 12 }}>Par</label>
              <input style={{ ...inputStyle, marginTop: 4 }} inputMode="numeric" value={cPar} onChange={(e) => setCPar(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>
              <label style={{ color: C.sage, fontSize: 12 }}>Rating</label>
              <input style={{ ...inputStyle, marginTop: 4 }} inputMode="decimal" placeholder="72.1" value={cRating} onChange={(e) => setCRating(e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>
              <label style={{ color: C.sage, fontSize: 12 }}>Slope</label>
              <input style={{ ...inputStyle, marginTop: 4 }} inputMode="numeric" placeholder="130" value={cSlope} onChange={(e) => setCSlope(e.target.value)} />
            </div>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 8 }}>
            Pars are auto-laid-out to your total; you can fine-tune each hole on the next screen.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button style={btn(false)} onClick={() => setShowCustom(false)}>Back</button>
            <button style={{ ...btn(true), opacity: cName.trim() ? 1 : 0.5 }} disabled={!cName.trim()} onClick={makeCustom}>Use this course</button>
          </div>
        </div>
      )}

      {picked && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 16 }}>{picked.name}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{picked.location}</div>
          <div style={{ marginTop: 12 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Tees</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {picked.tees.map((t, i) => (
                <button key={i} onClick={() => setTeeIdx(i)} style={{ ...btn(i === teeIdx), padding: "8px 14px", fontSize: 13 }}>
                  {t.name} · {t.rating}/{t.slope}
                </button>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Your handicap index (optional — needed for Stableford)</label>
            <input style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }} inputMode="decimal" placeholder="14.2" value={idxStr} onChange={(e) => setIdxStr(e.target.value)} />
          </div>
          {realCH != null && (
            <div style={{ color: C.gold, fontWeight: 800, marginTop: 12, fontSize: 15 }}>
              Course handicap: {realCH} {realCH >= 0 ? `(you get ${realCH} stroke${realCH === 1 ? "" : "s"})` : "(plus handicap)"}
              <div style={{ color: C.sage, fontWeight: 400, fontSize: 11, marginTop: 4 }}>
                index × (slope ÷ 113) + (rating − par), rounded
              </div>
            </div>
          )}
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button style={btn(false)} onClick={() => setPicked(null)}>‹ Change course</button>
            <button style={btn(true)} onClick={start}>Continue to scorecard ›</button>
          </div>
        </div>
      )}

      <div style={{ marginTop: 18 }}>
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------- Round editor ----------------
function RoundEditor({ round, onSaved, onCancel }: { round: Round; onSaved: () => void; onCancel: () => void }) {
  const [holes, setHoles] = useState<Hole[]>(round.holes);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const setHole = (i: number, patch: Partial<Hole>) =>
    setHoles((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  const num = (v: string, max: number) =>
    v === "" ? null : (Math.max(0, Math.min(max, parseInt(v, 10) || 0)) || null);

  const live: Round = { ...round, holes };
  const anyPlayed = holes.some((h) => h.strokes);
  const gir = girStats([live]), fir = firStats([live]);

  const cycleFw = (i: number, h: Hole) => {
    if (h.par < 4) return;
    const next = h.fairway == null ? "hit" : h.fairway === "hit" ? "miss" : null;
    setHole(i, { fairway: next });
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      // Insert the round; user_id is filled automatically by the DB default (auth.uid()).
      const { data: r, error: e1 } = await supabase.from("rounds").insert({
        course: round.course, tee_name: round.tee_name,
        rating: round.rating, slope: round.slope, course_par: round.course_par,
        handicap_index: round.handicap_index, course_handicap: round.course_handicap,
        played_at: round.played_at,
      }).select().single();
      if (e1 || !r) throw e1 || new Error("Could not save round");

      const rows = holes.map((h) => ({
        round_id: r.id, hole_number: h.hole_number, par: h.par,
        stroke_index: h.stroke_index, strokes: h.strokes, putts: h.putts,
        fairway: h.fairway, penalties: h.penalties || 0,
      }));
      const { error: e2 } = await supabase.from("holes").insert(rows);
      if (e2) throw e2;
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Save failed. Check your connection and try again.");
      setSaving(false);
    }
  };

  const Nine = ({ from, to, label }: { from: number; to: number; label: string }) => (
    <div style={{ background: C.card, borderRadius: 12, padding: 12, flex: 1, minWidth: 380, overflowX: "auto" }}>
      <div style={{ color: C.faint, fontSize: 11, letterSpacing: 2, fontWeight: 700, marginBottom: 6 }}>{label}</div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Hole", "Par", "S.I.", "Str", "Score", "Putts", "FW", "Pen", "Pts"].map((h) => (
              <th key={h} style={{ color: C.faint, fontSize: 9, letterSpacing: 1, textAlign: "center", padding: "3px 4px" }}>{h.toUpperCase()}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {holes.slice(from, to).map((h, idx) => {
            const i = from + idx;
            const pts = stablefordPts(h.strokes, h.par, h.recv || 0);
            return (
              <tr key={i} style={{ borderTop: `1px solid ${C.line}` }}>
                <td style={{ padding: 5, fontWeight: 700, color: C.ink, textAlign: "center" }}>{h.hole_number}</td>
                <td style={{ padding: 3 }}>
                  <select value={h.par} onChange={(e) => setHole(i, { par: +e.target.value, fairway: +e.target.value < 4 ? null : h.fairway })}
                    style={{ ...inputStyle, padding: "5px 6px", width: 52, fontSize: 14 }}>
                    {[3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </td>
                <td style={{ padding: 3, textAlign: "center", color: C.faint, fontSize: 12 }}>{h.stroke_index ?? "–"}</td>
                <td style={{ padding: 3, textAlign: "center" }}>
                  <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}>{h.recv ? "●".repeat(Math.min(h.recv, 3)) : ""}</span>
                </td>
                <td style={{ padding: 3 }}>
                  <input inputMode="numeric" value={h.strokes ?? ""} placeholder="–"
                    onChange={(e) => setHole(i, { strokes: num(e.target.value, 20) })}
                    style={{ ...inputStyle, padding: "5px 4px", width: 46, textAlign: "center", fontSize: 15 }} />
                </td>
                <td style={{ padding: 3 }}>
                  <input inputMode="numeric" value={h.putts ?? ""} placeholder="–"
                    onChange={(e) => setHole(i, { putts: num(e.target.value, 9) })}
                    style={{ ...inputStyle, padding: "5px 4px", width: 46, textAlign: "center", fontSize: 15 }} />
                </td>
                <td style={{ padding: 3, textAlign: "center" }}>
                  <button onClick={() => cycleFw(i, h)} disabled={h.par < 4}
                    style={{
                      border: `1px solid ${C.line}`, borderRadius: 8, width: 38, height: 32, cursor: h.par < 4 ? "default" : "pointer",
                      background: h.fairway === "hit" ? "#DDF0DF" : h.fairway === "miss" ? "#F6DEDB" : C.card,
                      color: h.fairway === "hit" ? C.greenMid : h.fairway === "miss" ? C.birdie : C.faint, fontWeight: 800,
                    }}>
                    {h.par < 4 ? "—" : h.fairway === "hit" ? "✓" : h.fairway === "miss" ? "✗" : "·"}
                  </button>
                </td>
                <td style={{ padding: 3 }}>
                  <input inputMode="numeric" value={h.penalties || ""} placeholder="0"
                    onChange={(e) => setHole(i, { penalties: e.target.value === "" ? 0 : Math.max(0, Math.min(9, parseInt(e.target.value, 10) || 0)) })}
                    style={{ ...inputStyle, padding: "5px 4px", width: 42, textAlign: "center", fontSize: 15 }} />
                </td>
                <td style={{ padding: 3, textAlign: "center", fontWeight: 800, color: (pts ?? 0) >= 3 ? C.birdie : pts === 0 ? C.faint : C.ink }}>{pts ?? "·"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  return (
    <div>
      <div style={{ color: C.sage, fontSize: 13, marginBottom: 10 }}>
        {round.course}{round.tee_name ? ` · ${round.tee_name} tees (${round.rating}/${round.slope})` : ""}
        {round.course_handicap != null ? ` · course handicap ${round.course_handicap}` : " · no handicap — Stableford scored gross"}
        {"  ·  FW: tap to cycle ✓ hit / ✗ miss (par 4s & 5s)"}
      </div>
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Nine from={0} to={Math.min(9, holes.length)} label="FRONT NINE" />
        {holes.length > 9 && <Nine from={9} to={18} label="BACK NINE" />}
      </div>
      {err && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 700 }}>
          {anyPlayed ? `${strokesOf(live)} (${toParStr(diffOf(live))}) · ${ptsOf(live)} pts` : "Enter scores above"}
        </div>
        {anyPlayed && (
          <div style={{ color: C.sage, fontSize: 13 }}>
            GIR {pct(gir)} · FIR {pct(fir)} · {puttsOf(live)} putts · {pensOf(live)} penalt{pensOf(live) === 1 ? "y" : "ies"}
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
        <button style={{ ...btn(true), opacity: anyPlayed && !saving ? 1 : 0.5 }} disabled={!anyPlayed || saving} onClick={save}>
          {saving ? "Saving…" : "Save round"}
        </button>
      </div>
    </div>
  );
}

// ---------------- Round detail ----------------
function RoundDetail({ round, onBack, onEdit, onDelete }: {
  round: Round; onBack: () => void; onEdit: () => void; onDelete: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button style={btn(false)} onClick={onBack}>‹ Back</button>
        <div>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>
            {round.course}{round.tee_name ? ` · ${round.tee_name}` : ""}
          </div>
          <div style={{ color: C.sage, fontSize: 13 }}>
            {fmtDate(round.played_at)} · {strokesOf(round)} ({toParStr(diffOf(round))}) · {ptsOf(round)} pts
            {round.course_handicap != null ? ` · CH ${round.course_handicap}` : ""} · GIR {pct(girStats([round]))} · FW {pct(firStats([round]))} · {puttsOf(round)} putts · {pensOf(round)} pen
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <button style={{ ...btn(false), background: "#7A2F28" }}
          onClick={() => { if (confirm("Delete this round?")) onDelete(); }}>Delete</button>
      </div>
      <div style={{ marginTop: 14 }}><ClassicCard round={round} /></div>
    </div>
  );
}

// ---------------- Dashboard ----------------
function Dashboard({ rounds, name, onOpen }: { rounds: Round[]; name: string; onOpen: (r: Round) => void }) {
  const done = rounds.filter((r) => played(r).length > 0);
  const sorted = [...done].sort((a, b) => +new Date(a.played_at) - +new Date(b.played_at));
  const avgDiff = done.length ? done.reduce((s, r) => s + diffOf(r), 0) / done.length : null;
  const best = done.length ? Math.min(...done.map(diffOf)) : null;
  const allHoles = done.flatMap(played);
  const withPutts = allHoles.filter((h) => h.putts != null);
  const avgPutts = withPutts.length ? withPutts.reduce((s, h) => s + (h.putts || 0), 0) / withPutts.length : null;
  const gir = girStats(done), fir = firStats(done);
  const pens = done.reduce((s, r) => s + pensOf(r), 0);
  const fulls = done.filter((r) => played(r).length >= 14);
  const avgPts = fulls.length ? fulls.reduce((s, r) => s + ptsOf(r), 0) / fulls.length : null;
  const buckets = holeBuckets(done);

  const trend = sorted.map((r, i) => ({ i: i + 1, name: fmtDate(r.played_at), diff: diffOf(r), pts: ptsOf(r), course: r.course }));
  const distData = [
    { name: "Eagle+", v: buckets.eagle, c: "#7A2E86" },
    { name: "Birdie", v: buckets.birdie, c: C.birdie },
    { name: "Par", v: buckets.par, c: C.greenMid },
    { name: "Bogey", v: buckets.bogey, c: C.bogey },
    { name: "Dbl+", v: buckets.double, c: "#6B6B6B" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard label="Rounds" value={done.length} />
        <StatCard label="Avg vs par" value={avgDiff == null ? "—" : (avgDiff >= 0 ? "+" : "") + avgDiff.toFixed(1)} />
        <StatCard label="Best round" value={best == null ? "—" : toParStr(best)} />
        <StatCard label="Stableford avg" value={avgPts == null ? "—" : avgPts.toFixed(1)} sub="full rounds" />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <StatCard label="GIR" value={pct(gir)} sub={gir.total ? `${gir.hit}/${gir.total} holes` : "needs putts"} />
        <StatCard label="Fairways hit" value={pct(fir)} sub={fir.total ? `${fir.hit}/${fir.total} par 4s/5s` : "tap FW"} />
        <StatCard label="Putts / hole" value={avgPutts == null ? "—" : avgPutts.toFixed(2)} />
        <StatCard label="Penalties" value={done.length ? (pens / done.length).toFixed(1) : "—"} sub="per round" />
      </div>

      {trend.length >= 2 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
          <Eyebrow>SCORING TREND</Eyebrow>
          <div style={{ height: 200, marginTop: 10 }}>
            <ResponsiveContainer>
              <LineChart data={trend} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="i" tick={{ fill: C.sage, fontSize: 11 }} axisLine={{ stroke: C.greenMid }} tickLine={false} />
                <YAxis tick={{ fill: C.sage, fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }}
                  formatter={(v: any, k: any) => [k === "diff" ? toParStr(v) : v, k === "diff" ? "vs par" : "Stableford pts"]}
                  labelFormatter={(l: any, p: any) => (p && p[0] ? `${p[0].payload.course} · ${p[0].payload.name}` : l)} />
                <ReferenceLine y={0} stroke={C.gold} strokeDasharray="4 4" />
                <Line type="monotone" dataKey="diff" stroke={C.cream} strokeWidth={2} dot={{ fill: C.gold, r: 3 }} />
                <Line type="monotone" dataKey="pts" stroke={C.gold} strokeWidth={1.5} strokeDasharray="5 3" dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Solid = strokes vs par (lower better) · Dashed = Stableford points (higher better)</div>
        </div>
      )}

      {allHoles.length > 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 16 }}>
          <Eyebrow>HOLE OUTCOMES · {allHoles.length} HOLES</Eyebrow>
          <div style={{ height: 150, marginTop: 10 }}>
            <ResponsiveContainer>
              <BarChart data={distData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fill: C.sage, fontSize: 11 }} axisLine={{ stroke: C.greenMid }} tickLine={false} />
                <YAxis tick={{ fill: C.sage, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12 }} formatter={(v: any) => [v, "holes"]} />
                <Bar dataKey="v" radius={[4, 4, 0, 0]}>
                  {distData.map((d, i) => <Cell key={i} fill={d.c} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <Eyebrow>RECENT ROUNDS</Eyebrow>
        {done.length === 0 && (
          <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 10, color: C.sage, textAlign: "center" }}>
            No rounds yet, {name}. Tap "New round" to enter your first scorecard.
          </div>
        )}
        {[...done].sort((a, b) => +new Date(b.played_at) - +new Date(a.played_at)).slice(0, 5).map((r) => <RoundRow key={r.id} r={r} onOpen={onOpen} />)}
      </div>
    </div>
  );
}

function RoundsList({ rounds, onOpen }: { rounds: Round[]; onOpen: (r: Round) => void }) {
  if (!rounds.length)
    return <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, color: C.sage, textAlign: "center" }}>No rounds yet. Tap "New round" to add one.</div>;
  return <div>{[...rounds].sort((a, b) => +new Date(b.played_at) - +new Date(a.played_at)).map((r) => <RoundRow key={r.id} r={r} onOpen={onOpen} />)}</div>;
}

function RoundRow({ r, onOpen }: { r: Round; onOpen: (r: Round) => void }) {
  return (
    <div onClick={() => onOpen(r)}
      style={{ background: C.card, borderRadius: 12, padding: "13px 16px", marginTop: 10, display: "flex", alignItems: "center", cursor: "pointer", gap: 10, flexWrap: "wrap" }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{r.course}{r.tee_name ? ` · ${r.tee_name}` : ""}</div>
        <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
          {fmtDate(r.played_at)} · {played(r).length}/{r.holes.length} holes · GIR {pct(girStats([r]))} · FW {pct(firStats([r]))} · {puttsOf(r)} putts{pensOf(r) ? ` · ${pensOf(r)} pen` : ""}
        </div>
      </div>
      <div style={{ textAlign: "right" }}>
        <span style={{ color: C.ink, fontSize: 20, fontWeight: 800, fontFamily: "Georgia, serif" }}>{strokesOf(r)}</span>
        <span style={{ color: C.green, fontWeight: 700, marginLeft: 8 }}>{toParStr(diffOf(r))}</span>
      </div>
      <div style={{ background: C.cream, borderRadius: 8, padding: "4px 10px", color: C.green, fontWeight: 800, fontSize: 13 }}>{ptsOf(r)} pts</div>
    </div>
  );
}
