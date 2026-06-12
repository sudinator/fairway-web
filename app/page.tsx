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
  girStats, firStats, pct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound,
} from "@/lib/golf";
import { buildCustomCourse, Course } from "@/lib/courses";
import { btn, inputStyle, Eyebrow, StatCard, ClassicCard, NumPicker, ScoreEntryCard, ScoreViewCard } from "@/components/ui";
import Tournaments from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell } from "@/components/manage";

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
  const [profile, setProfile] = useState<any>(null);
  const [tab, setTab] = useState<"dashboard" | "rounds" | "games" | "courses" | "profile">("dashboard");
  const [stage, setStage] = useState<null | "setup" | { round: Round }>(null);
  const [viewing, setViewing] = useState<Round | null>(null);

  const user = session.user;
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
  const index = profile?.handicap_index ?? null;

  // Load (or create) this user's profile: display name, handicap index, GHIN number.
  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (data) {
      setProfile(data);
      // Heartbeat: record that this user is active now (and backfill email if missing).
      supabase.from("profiles").update({ last_active: new Date().toISOString(), email: user.email }).eq("id", user.id).then(() => {});
      return;
    }
    // First login — create a profile row.
    const fallbackName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
    const { data: created } = await supabase.from("profiles")
      .insert({ id: user.id, display_name: fallbackName, email: user.email, last_active: new Date().toISOString() }).select().maybeSingle();
    setProfile(created || { id: user.id, display_name: fallbackName, handicap_index: null, ghin_number: null, is_admin: false });
  }, [user.id, user.email, user.user_metadata]);
  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveIndex = async (idx: number | null) => {
    setProfile((p: any) => ({ ...p, handicap_index: idx }));
    await supabase.from("profiles").update({ handicap_index: idx }).eq("id", user.id);
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
        <NotificationBell user={user} />
        <button style={{ ...btn(false), fontSize: 12 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button style={btn(true)} onClick={() => { setStage("setup"); setViewing(null); }}>＋ New round</button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: `1px solid ${C.greenMid}`, flexWrap: "wrap" }}>
        {(["dashboard", "rounds", "games", "courses"] as const).map((k) => (
          <button key={k} onClick={() => { setTab(k); setStage(null); setViewing(null); }}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
              color: tab === k && !inFlow ? C.gold : C.sage,
              borderBottom: tab === k && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
            }}>{k === "dashboard" ? "Dashboard" : k === "rounds" ? "Rounds" : k === "games" ? "Games" : "Courses"}</button>
        ))}
        <button onClick={() => { setTab("profile"); setStage(null); setViewing(null); }}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
            color: tab === "profile" && !inFlow ? C.gold : C.sage,
            borderBottom: tab === "profile" && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
          }}>Profile{profile?.is_admin ? " ★" : ""}</button>
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
        ) : tab === "courses" ? (
          <CoursesLibrary user={user} />
        ) : tab === "profile" ? (
          <ProfilePanel profile={profile} user={user} onSaved={loadProfile} />
        ) : tab === "games" ? (
          <Tournaments session={session} />
        ) : loading ? (
          <div style={{ color: C.sage, textAlign: "center", padding: 40 }}>Loading your rounds…</div>
        ) : tab === "dashboard" ? (
          <Dashboard rounds={rounds} name={displayName} onOpen={setViewing} currentIndex={index} saveIndex={saveIndex} />
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
  // favorites
  const [favorites, setFavorites] = useState<{ id: string; name: string; location: string; data: Course }[]>([]);
  const [favSaving, setFavSaving] = useState(false);
  const [favMsg, setFavMsg] = useState<string | null>(null);
  // tee override
  const [editingTee, setEditingTee] = useState(false);
  const [loadedFavId, setLoadedFavId] = useState<string | null>(null);
  const [ratingText, setRatingText] = useState("");
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

  // Load this user's saved favorite courses (with their corrected data).
  const loadFavorites = async () => {
    const { data } = await supabase.from("favorite_courses").select("*").order("name");
    if (!data) return;
    setFavorites(data.map((f: any) => {
      const d = f.data || {};
      // Older favorites stored holes inside a tee; lift them to the course level.
      if ((!d.holes || !d.holes.length) && Array.isArray(d.tees)) {
        const teeWithHoles = d.tees.find((t: any) => t.holes && t.holes.length);
        if (teeWithHoles) {
          d.holes = teeWithHoles.holes;
          d.tees = d.tees.map((t: any) => ({ name: t.name, rating: t.rating, slope: t.slope, par: t.par }));
        }
      }
      return { id: f.id, name: f.name, location: f.location || "", data: d };
    }));
  };
  useEffect(() => { loadFavorites(); }, []);

  // Save the currently-picked course; if one with the same name exists, update it instead of duplicating.
  const saveFavorite = async () => {
    if (!picked) return;
    setFavSaving(true); setFavMsg(null);
    try {
      const { data: existing } = await supabase.from("favorite_courses").select("id").eq("name", picked.name).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("favorite_courses").update({ location: picked.location, data: picked }).eq("id", existing.id);
        if (error) throw error;
        setFavMsg("Updated in course library ★");
      } else {
        const { error } = await supabase.from("favorite_courses").insert({ name: picked.name, location: picked.location, data: picked });
        if (error) throw error;
        setFavMsg("Saved to course library ★");
      }
      await loadFavorites();
    } catch (e: any) {
      setFavMsg("Couldn't save: " + (e.message || "error"));
    } finally {
      setFavSaving(false);
    }
  };

  // Update the favorite that's currently loaded with the latest edits.
  const updateFavorite = async () => {
    if (!picked || !loadedFavId) return;
    setFavSaving(true); setFavMsg(null);
    try {
      const { error } = await supabase.from("favorite_courses")
        .update({ name: picked.name, location: picked.location, data: picked })
        .eq("id", loadedFavId);
      if (error) throw error;
      setFavMsg("Favorite updated ★");
      await loadFavorites();
    } catch (e: any) {
      setFavMsg("Couldn't update: " + (e.message || "error"));
    } finally {
      setFavSaving(false);
    }
  };

  // Remove a favorite course.
  const deleteFavorite = async (id: string) => {
    try {
      await supabase.from("favorite_courses").delete().eq("id", id);
      if (loadedFavId === id) setLoadedFavId(null);
      await loadFavorites();
    } catch (e: any) {
      setFavMsg("Couldn't remove: " + (e.message || "error"));
    }
  };

  // Update a field on the currently-selected tee (for overriding rating/slope/name).
  const updateTee = (patch: Partial<{ name: string; rating: number; slope: number }>) => {
    if (!picked) return;
    const tees = picked.tees.map((t, i) => (i === teeIdx ? { ...t, ...patch } : t));
    setPicked({ ...picked, tees });
  };

  // Update a single hole's par or stroke index — these belong to the course (all tees share them).
  const updateHole = (holeIdx: number, patch: Partial<{ par: number; si: number | null }>) => {
    if (!picked) return;
    const holes = picked.holes.map((h, j) => (j === holeIdx ? { ...h, ...patch } : h));
    setPicked({ ...picked, holes });
  };

  // Add a brand-new tee (e.g. the one you actually played isn't listed) and select it.
  const addTee = () => {
    if (!picked) return;
    const template = picked.tees[teeIdx];
    const coursePar = picked.holes.reduce((s, h) => s + (h.par || 0), 0);
    const newTee = {
      name: "New tee",
      rating: template?.rating ?? 72,
      slope: template?.slope ?? 113,
      par: coursePar || template?.par || 72,
    };
    const tees = [...picked.tees, newTee];
    setPicked({ ...picked, tees });
    setTeeIdx(tees.length - 1);
    setEditingTee(true);
  };

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

  // Built-in "popular courses" suggestions were removed — rely on database search and the shared library.
  const starterMatches: Course[] = [];

  const tee = picked?.tees[teeIdx];
  const idxVal = idxStr.trim() === "" ? null : parseFloat(idxStr);
  const coursePar = picked ? picked.holes.reduce((s, h) => s + (h.par || 0), 0) : null;
  const realCH = tee && idxVal != null && coursePar ? courseHandicap(idxVal, tee.slope, tee.rating, coursePar) : null;

  // Keep the rating text box in sync with the selected tee (so decimals type freely).
  useEffect(() => {
    if (tee) setRatingText(tee.rating != null && !isNaN(tee.rating) ? String(tee.rating) : "");
  }, [teeIdx, editingTee, picked?.id]);

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
    const coursePar = picked.holes.reduce((s, h) => s + (h.par || 0), 0);
    const holes: Hole[] = picked.holes.map((h) => ({
      hole_number: h.n, par: h.par, stroke_index: h.si,
      strokes: null, putts: null, fairway: null, penalties: 0,
      recv: realCH != null ? strokesReceived(h.si, realCH) : 0,
    }));
    onReady({
      id: "", course: picked.name, tee_name: tee.name,
      rating: tee.rating, slope: tee.slope, course_par: coursePar,
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
          {favorites.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <Eyebrow>★ YOUR FAVORITES</Eyebrow>
              {favorites.map((f) => (
                <div key={f.id}
                  style={{ display: "flex", alignItems: "stretch", marginTop: 8, background: C.card, border: `1px solid ${C.gold}`, borderRadius: 10, overflow: "hidden" }}>
                  <button onClick={() => { setPicked(f.data); setTeeIdx(0); setLoadedFavId(f.id); setEditingTee(false); setFavMsg(null); }}
                    style={{ flex: 1, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "12px 14px" }}>
                    <span style={{ color: C.gold, fontWeight: 800 }}>★ </span>
                    <span style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{f.name}</span>
                    {f.location ? <span style={{ color: C.faint, fontSize: 13 }}> · {f.location}</span> : null}
                  </button>
                  <button title="Remove from favorites"
                    onClick={() => { if (confirm(`Remove "${f.name}" from favorites?`)) deleteFavorite(f.id); }}
                    style={{ background: "none", border: "none", borderLeft: `1px solid ${C.line}`, color: C.birdie, fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px" }}>
                    ✕
                  </button>
                </div>
              ))}
              <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
                Tap a favorite to load it. You can edit its tees/ratings below, or its pars &amp; stroke index on the scorecard, then update it.
              </div>
            </div>
          )}

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
              <input style={{ ...inputStyle, marginTop: 4 }} inputMode="decimal" placeholder="72.1" value={cRating}
                onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setCRating(v); }} />
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
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <label style={{ color: C.sage, fontSize: 12 }}>Tees</label>
              <button onClick={() => setEditingTee((v) => !v)}
                style={{ background: "none", border: "none", color: C.gold, fontSize: 12, fontWeight: 700, cursor: "pointer", padding: 0 }}>
                {editingTee ? "done editing" : "✎ override / add tee"}
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {picked.tees.map((t, i) => (
                <button key={i} onClick={() => setTeeIdx(i)} style={{ ...btn(i === teeIdx), padding: "8px 14px", fontSize: 13 }}>
                  {t.name} · {t.rating}/{t.slope}
                </button>
              ))}
              {editingTee && (
                <button onClick={addTee} style={{ ...btn(false), padding: "8px 14px", fontSize: 13, border: `1px dashed ${C.gold}` }}>＋ add tee</button>
              )}
            </div>

            {editingTee && tee && (
              <div style={{ background: C.green, borderRadius: 10, padding: 12, marginTop: 10 }}>
                <div style={{ color: C.sage, fontSize: 11, marginBottom: 8 }}>
                  <b style={{ color: C.cream }}>{tee.name}</b> tee — rating &amp; slope are specific to this tee (they change your course handicap).
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: 2, minWidth: 140 }}>
                    <label style={{ color: C.sage, fontSize: 11 }}>Tee name</label>
                    <input style={{ ...inputStyle, marginTop: 4 }} value={tee.name}
                      onChange={(e) => updateTee({ name: e.target.value })} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label style={{ color: C.sage, fontSize: 11 }}>Rating</label>
                    <input style={{ ...inputStyle, marginTop: 4 }} inputMode="decimal" placeholder="72.1"
                      value={ratingText}
                      onChange={(e) => {
                        // Allow digits and a single decimal point (e.g. "72.1") while typing.
                        const raw = e.target.value;
                        if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
                        setRatingText(raw);
                        const n = parseFloat(raw);
                        updateTee({ rating: isNaN(n) ? 0 : n });
                      }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 90 }}>
                    <label style={{ color: C.sage, fontSize: 11 }}>Slope</label>
                    <input style={{ ...inputStyle, marginTop: 4 }} inputMode="numeric" placeholder="130"
                      value={tee.slope ?? ""} onChange={(e) => updateTee({ slope: e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0 })} />
                  </div>
                </div>

                {picked.holes && picked.holes.length > 0 && (
                  <div style={{ marginTop: 14 }}>
                    <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>
                      Par &amp; stroke index — these are the same for every tee. Total par: <b style={{ color: C.cream }}>{coursePar}</b>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ borderCollapse: "collapse", width: "100%" }}>
                        <tbody>
                          <tr>
                            <td style={{ color: C.faint, fontSize: 10, padding: "2px 4px" }}>Hole</td>
                            {picked.holes.map((h) => <td key={h.n} style={{ color: C.faint, fontSize: 10, padding: "2px 4px", textAlign: "center" }}>{h.n}</td>)}
                          </tr>
                          <tr>
                            <td style={{ color: C.sage, fontSize: 10, padding: "2px 4px" }}>Par</td>
                            {picked.holes.map((h, j) => (
                              <td key={j} style={{ padding: 2 }}>
                                <input inputMode="numeric" value={h.par ?? ""}
                                  onChange={(e) => updateHole(j, { par: Math.max(3, Math.min(6, parseInt(e.target.value, 10) || 3)) })}
                                  style={{ ...inputStyle, padding: "3px 2px", width: 32, textAlign: "center", fontSize: 13 }} />
                              </td>
                            ))}
                          </tr>
                          <tr>
                            <td style={{ color: C.sage, fontSize: 10, padding: "2px 4px" }}>S.I.</td>
                            {picked.holes.map((h, j) => (
                              <td key={j} style={{ padding: 2 }}>
                                <input inputMode="numeric" value={h.si ?? ""}
                                  onChange={(e) => updateHole(j, { si: e.target.value === "" ? null : Math.max(1, Math.min(18, parseInt(e.target.value, 10) || 0)) || null })}
                                  style={{ ...inputStyle, padding: "3px 2px", width: 32, textAlign: "center", fontSize: 13 }} />
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}
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
          <div style={{ display: "flex", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
            <button style={btn(false)} onClick={() => { setPicked(null); setFavMsg(null); setLoadedFavId(null); }}>‹ Change course</button>
            {loadedFavId ? (
              <button style={{ ...btn(false), opacity: favSaving ? 0.5 : 1 }} disabled={favSaving} onClick={updateFavorite}>
                {favSaving ? "Updating…" : "★ Update this favorite"}
              </button>
            ) : (
              <button style={{ ...btn(false), opacity: favSaving ? 0.5 : 1 }} disabled={favSaving} onClick={saveFavorite}>
                {favSaving ? "Saving…" : "★ Save as favorite"}
              </button>
            )}
            <button style={btn(true)} onClick={start}>Continue to scorecard ›</button>
          </div>
          {favMsg && <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>{favMsg}</div>}
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
  const [favMsg, setFavMsg] = useState<string | null>(null);

  // Save the corrected par/stroke-index back as a favorite course for next time.
  const saveCorrectedFavorite = async () => {
    setFavMsg(null);
    const coursePar = holes.reduce((s, h) => s + h.par, 0);
    const course = {
      id: "corrected",
      name: round.course,
      location: round.tee_name || "",
      tees: [{
        name: round.tee_name || "Default",
        rating: round.rating ?? 72, slope: round.slope ?? 113, par: coursePar,
      }],
      holes: holes.map((h) => ({ n: h.hole_number, par: h.par, si: h.stroke_index })),
    };
    try {
      const { data: existing } = await supabase.from("favorite_courses").select("id").eq("name", round.course).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("favorite_courses").update({ location: round.tee_name || "", data: course }).eq("id", existing.id);
        if (error) throw error;
        setFavMsg("Course library updated ★");
      } else {
        const { error } = await supabase.from("favorite_courses").insert({ name: round.course, location: round.tee_name || "", data: course });
        if (error) throw error;
        setFavMsg("Saved to course library ★");
      }
    } catch (e: any) {
      setFavMsg("Couldn't save: " + (e.message || "error"));
    }
  };

  const setHole = (i: number, patch: Partial<Hole>) =>
    setHoles((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const live: Round = { ...round, holes };
  const anyPlayed = holes.some((h) => h.strokes);
  const gir = girStats([live]), fir = firStats([live]);

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

  return (
    <div>
      <div style={{ color: C.sage, fontSize: 13, marginBottom: 10 }}>
        {round.course}{round.tee_name ? ` · ${round.tee_name} tees (${round.rating}/${round.slope})` : ""}
        {round.course_handicap != null ? ` · course handicap ${round.course_handicap}` : " · no handicap — Stableford scored gross"}
      </div>
      <ScoreEntryCard
        holes={holes.map((h) => ({
          n: h.hole_number, par: h.par, si: h.stroke_index,
          strokes: h.strokes, putts: h.putts, fairway: h.fairway,
          recv: round.course_handicap != null ? strokesReceived(h.stroke_index, round.course_handicap) : 0,
        }))}
        hasHandicap={round.course_handicap != null}
        onSet={(i, patch) => setHole(i, patch)}
      />
      {err && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 16, flexWrap: "wrap" }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 700 }}>
          {anyPlayed ? `${strokesOf(live)} (${toParStr(diffOf(live))}) · ${ptsOf(live)} pts` : "Enter scores above"}
        </div>
        {anyPlayed && (
          <div style={{ color: C.sage, fontSize: 13 }}>
            GIR {pct(gir)} · FIR {pct(fir)} · {puttsOf(live)} putts
          </div>
        )}
        <div style={{ flex: 1 }} />
        <button style={btn(false)} onClick={saveCorrectedFavorite}>★ Save course</button>
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
        <button style={{ ...btn(true), opacity: anyPlayed && !saving ? 1 : 0.5 }} disabled={!anyPlayed || saving} onClick={save}>
          {saving ? "Saving…" : "Save round"}
        </button>
      </div>
      {favMsg && <div style={{ color: C.gold, fontSize: 12, marginTop: 8, textAlign: "right" }}>{favMsg}</div>}
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
      <div style={{ marginTop: 14 }}><ScoreViewCard round={round} /></div>
    </div>
  );
}

// ---------------- Dashboard ----------------
function Dashboard({ rounds, name, onOpen, currentIndex, saveIndex }: {
  rounds: Round[]; name: string; onOpen: (r: Round) => void;
  currentIndex: number | null; saveIndex: (i: number | null) => void;
}) {
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
  const byPar = avgByPar(done);
  const diffs = done.map(roundDifferential).filter((d): d is number => d != null);
  const avgDifferential = diffs.length ? diffs.reduce((s, d) => s + d, 0) / diffs.length : null;
  const hcp = runningHandicap(done);
  const threePutts = threePuttsPerRound(done);

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
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginBottom: 12, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 700 }}>RUNNING HANDICAP INDEX</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
            {hcp.index == null
              ? `Need at least 3 full 18-hole rounds (with rating & slope). You have ${hcp.total}.`
              : `Best ${hcp.used} of your last ${Math.min(hcp.total, 20)} differentials · WHS method`}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ textAlign: "right" }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 44, fontWeight: 800 }}>
            {hcp.index == null ? "—" : hcp.index.toFixed(1)}
          </div>
          {hcp.index != null && (
            currentIndex === hcp.index ? (
              <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>✓ in use as your handicap</div>
            ) : (
              <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12, marginTop: 4 }}
                onClick={() => saveIndex(hcp.index)}>
                Use as my handicap
              </button>
            )
          )}
        </div>
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <StatCard label="Rounds" value={done.length} />
        <StatCard label="Avg vs par" value={avgDiff == null ? "—" : (avgDiff >= 0 ? "+" : "") + avgDiff.toFixed(1)} />
        <StatCard label="Best round" value={best == null ? "—" : toParStr(best)} />
        <StatCard label="Avg differential" value={avgDifferential == null ? "—" : avgDifferential.toFixed(1)}
          sub={diffs.length ? `${diffs.length} full round${diffs.length === 1 ? "" : "s"} w/ rating·slope` : "needs 18 holes + rating/slope"} />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <StatCard label="Avg on par 3s" value={byPar.par3 == null ? "—" : byPar.par3.toFixed(2)} sub={byPar.par3 == null ? "" : (byPar.par3 - 3 >= 0 ? "+" : "") + (byPar.par3 - 3).toFixed(2) + " vs par"} />
        <StatCard label="Avg on par 4s" value={byPar.par4 == null ? "—" : byPar.par4.toFixed(2)} sub={byPar.par4 == null ? "" : (byPar.par4 - 4 >= 0 ? "+" : "") + (byPar.par4 - 4).toFixed(2) + " vs par"} />
        <StatCard label="Avg on par 5s" value={byPar.par5 == null ? "—" : byPar.par5.toFixed(2)} sub={byPar.par5 == null ? "" : (byPar.par5 - 5 >= 0 ? "+" : "") + (byPar.par5 - 5).toFixed(2) + " vs par"} />
        <StatCard label="Stableford avg" value={avgPts == null ? "—" : avgPts.toFixed(1)} sub="full rounds" />
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
        <StatCard label="GIR" value={pct(gir)} sub={gir.total ? `${gir.hit}/${gir.total} holes` : "needs putts"} />
        <StatCard label="Fairways hit" value={pct(fir)} sub={fir.total ? `${fir.hit}/${fir.total} par 4s/5s` : "tap FW"} />
        <StatCard label="Putts / hole" value={avgPutts == null ? "—" : avgPutts.toFixed(2)} />
        <StatCard label="3+ putts / round" value={threePutts == null ? "—" : threePutts.toFixed(1)} sub="three-putt holes" />
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
