"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
} from "@/lib/golf";
import { buildCustomCourse, Course, courseLabel, loadCoursesForGroup, linkCourseToGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

const supabase = createClient();

export function RoundSetup({ index, saveIndex, activeGroupId, activeGroupName, onReady, onCancel }: {
  index: number | null;
  saveIndex: (i: number | null) => void;
  activeGroupId: string;
  activeGroupName: string;
  onReady: (r: Round) => void;
  onCancel: () => void;
}) {
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Course | null>(null);
  const [teeIdx, setTeeIdx] = useState(0);
  const [idxStr, setIdxStr] = useState(index != null ? String(index) : "");
  const [showCustom, setShowCustom] = useState(false);
  const [playDate, setPlayDate] = useState(new Date().toISOString().slice(0, 10));
  const [grossMode, setGrossMode] = useState(false);
  const [grossStr, setGrossStr] = useState("");
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
  const [results, setResults] = useState<{ id: number; club?: string; name: string; location: string }[] | null>(null);
  const [searchErr, setSearchErr] = useState<string | null>(null);
  // custom course fields
  const [cName, setCName] = useState("");
  const [cLoc, setCLoc] = useState("");
  const [cPar, setCPar] = useState("72");
  const [cRating, setCRating] = useState("");
  const [cSlope, setCSlope] = useState("");

  // Load this group's courses (via the group_courses link table — shared records).
  const loadFavorites = async () => {
    const data = await loadCoursesForGroup(supabase, activeGroupId);
    if (!data) return;
    setFavorites(data.map((f: any) => {
      const d = f.data || {};
      if ((!d.holes || !d.holes.length) && Array.isArray(d.tees)) {
        const teeWithHoles = d.tees.find((t: any) => t.holes && t.holes.length);
        if (teeWithHoles) {
          d.holes = teeWithHoles.holes;
          d.tees = d.tees.map((t: any) => ({ name: t.name, rating: t.rating, slope: t.slope, par: t.par }));
        }
      }
      return {
        id: f.id,
        name: f.name,
        location: f.location || "",
        data: { ...d, club: d.club || f.facility || "", externalId: d.externalId || f.external_id || null, corrected: d.corrected || f.corrected || false },
      };
    }));
  };
  useEffect(() => { loadFavorites(); }, [activeGroupId]);

  // Save the currently-picked course; if one with the same name exists, update it instead of duplicating.
  const saveFavorite = async () => {
    if (!picked) return;
    const siErr = validateStrokeIndexes(picked.holes.map((h) => ({ n: h.n, si: h.si })));
    if (siErr) { setFavMsg("Can't save — " + siErr + " Fix it in the override panel or Courses tab."); return; }
    setFavSaving(true); setFavMsg(null);
    try {
      // Dedup priority: match the canonical golf-course-API id first (so the same
      // real course saved by anyone resolves to one row even if names differ);
      // fall back to exact name match for manually-typed courses with no API id.
      let existingId: string | undefined;
      if (picked.externalId) {
        const { data: byExt } = await supabase
          .from("favorite_courses").select("id").eq("external_id", picked.externalId).maybeSingle();
        existingId = byExt?.id;
      }
      if (!existingId) {
        const { data: byName } = await supabase
          .from("favorite_courses").select("id").eq("name", picked.name).maybeSingle();
        existingId = byName?.id;
      }
      let courseId = existingId;
      const row = {
        name: picked.name,
        facility: picked.club || null,
        external_id: picked.externalId || null,
        location: picked.location,
        data: picked,
      };
      if (courseId) {
        // Do not overwrite the global course record. Save this version for the
        // current group and submit it for admin review before other groups see it.
        const proposed = { ...picked, corrected: true };
        const { error: overrideErr } = await supabase.from("group_course_overrides").upsert({
          group_id: activeGroupId,
          course_id: courseId,
          name: picked.name,
          location: picked.location,
          data: proposed,
          updated_by: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "group_id,course_id" });
        if (overrideErr) throw overrideErr;
        const { data: authUser } = await supabase.auth.getUser();
        await supabase.from("course_change_requests").insert({
          course_id: courseId, group_id: activeGroupId, submitted_by: authUser.user?.id || null,
          proposed_name: picked.name, proposed_location: picked.location, proposed_data: proposed,
          reason: "Course correction saved from New Round setup.",
          change_summary: "Course correction saved from New Round setup. Review proposed course details against the current global course.",
          status: "pending",
        });
        setFavMsg("Saved to this group's course library ★ (global review pending)");
      } else {
        const { data: created, error } = await supabase.from("favorite_courses")
          .insert({ group_id: activeGroupId, ...row })
          .select("id").single();
        if (error || !created) throw error || new Error("save failed");
        courseId = created.id;
        setFavMsg("Saved to course library ★");
      }
      await linkCourseToGroup(supabase, activeGroupId, courseId!, null);
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
      const proposed = { ...picked, corrected: true };
      const { error } = await supabase.from("group_course_overrides").upsert({
        group_id: activeGroupId, course_id: loadedFavId, name: picked.name, location: picked.location, data: proposed, updated_by: null, updated_at: new Date().toISOString(),
      }, { onConflict: "group_id,course_id" });
      if (error) throw error;
      const { data: authUser } = await supabase.auth.getUser();
      await supabase.from("course_change_requests").insert({
        course_id: loadedFavId, group_id: activeGroupId, submitted_by: authUser.user?.id || null, proposed_name: picked.name, proposed_location: picked.location, proposed_data: proposed,
        reason: "Course correction saved from New Round setup.",
        change_summary: "Course correction saved from New Round setup. Review proposed course details against the current global course.",
        status: "pending",
      });
      setFavMsg("Updated for this group ★ (global review pending)");
      await loadFavorites();
    } catch (e: any) {
      setFavMsg("Couldn't update: " + (e.message || "error"));
    } finally {
      setFavSaving(false);
    }
  };

  // Remove a course from THIS group (unlink — the shared record stays).
  const deleteFavorite = async (id: string) => {
    try {
      await supabase.from("group_courses").delete().eq("group_id", activeGroupId).eq("course_id", id);
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
    const alloc = allocateStrokes(picked.holes.map((h) => ({ hole_number: h.n, stroke_index: h.si })), realCH);
    const holes: Hole[] = picked.holes.map((h) => ({
      hole_number: h.n, par: h.par, stroke_index: h.si,
      strokes: null, putts: null, fairway: null, penalties: 0,
      recv: alloc[h.n] || 0,
    }));
    onReady({
      id: "", group_id: activeGroupId, group_name: activeGroupName, course: courseLabel(picked), tee_name: tee.name,
      rating: tee.rating, slope: tee.slope, course_par: coursePar,
      handicap_index: idxVal, course_handicap: realCH,
      played_at: playDate,
      holes,
    });
  };

  const [grossSaving, setGrossSaving] = useState(false);
  const [grossErr, setGrossErr] = useState<string | null>(null);
  const startGross = async () => {
    if (!picked || !tee) return;
    const g = parseInt(grossStr, 10);
    if (!g || g < 18 || g > 200) { setGrossErr("Enter a valid total score (e.g. 86)."); return; }
    if (idxVal != null && idxVal !== index) saveIndex(idxVal);
    setGrossSaving(true); setGrossErr(null);
    const coursePar = picked.holes.reduce((s, h) => s + (h.par || 0), 0);
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase.from("rounds").insert({
      user_id: u.user!.id, group_id: activeGroupId, course: courseLabel(picked), tee_name: tee.name,
      rating: tee.rating, slope: tee.slope, course_par: coursePar,
      handicap_index: idxVal, course_handicap: realCH,
      played_at: playDate, gross_score: g,
    });
    setGrossSaving(false);
    if (error) { setGrossErr("Couldn't save: " + error.message); return; }
    await logActivity(supabase, { actor_id: u.user!.id, actor_name: u.user?.email || "A player", action: "round_completed", group_id: activeGroupId, summary: `Logged a round at ${courseLabel(picked)} (${g})` });
    onCancel(); // back to home; dashboard reloads
  };

  return (
    <div style={{ maxWidth: 600 }}>
      <Eyebrow>NEW ROUND · STEP 1 OF 2</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>Posting to group: <b style={{ color: C.gold }}>{activeGroupName}</b></div>

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
                    <span style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{courseLabel(f.data)}</span>
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
              {results.map((c) => {
                // Already in this group's library? (match canonical id). If so, show
                // a marker and load the SAVED copy (keeps any pars/SI edits) instead
                // of re-fetching + re-adding a duplicate.
                const existing = favorites.find((f) => f.data?.externalId && String(f.data.externalId) === String(c.id));
                return (
                  <button key={c.id}
                    onClick={() => {
                      if (existing) { setPicked(existing.data); setTeeIdx(0); setLoadedFavId(existing.id); setEditingTee(false); setFavMsg("Loaded from your library ★"); }
                      else pickFromApi(c.id);
                    }}
                    disabled={loadingId != null}
                    style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, cursor: "pointer", background: C.card, border: `1px solid ${existing ? C.gold : C.line}`, borderRadius: 10, padding: "12px 14px", opacity: loadingId != null && loadingId !== c.id ? 0.5 : 1 }}>
                    <span style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{courseLabel(c)}</span>
                    {c.location ? <span style={{ color: C.faint, fontSize: 13 }}> · {c.location}</span> : null}
                    {existing ? <span style={{ color: C.gold, fontSize: 12, fontWeight: 700 }}> · ✓ in your library</span> : null}
                    {loadingId === c.id ? <span style={{ color: C.gold, fontSize: 12 }}> · loading…</span> : null}
                    {existing?.data?.corrected ? (
                      <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
                        ⚑ Your group already has this course, with member-verified pars/stroke index. Tap to use that version — don't re-add it.
                      </div>
                    ) : null}
                  </button>
                );
              })}
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
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 16 }}>{courseLabel(picked)}</div>
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
                    {(() => {
                      const nine = (from: number, to: number, label: string) => {
                        const seg = picked.holes.slice(from, to);
                        if (seg.length === 0) return null;
                        return (
                          <div style={{ background: C.card, borderRadius: 10, padding: 10, flex: 1, minWidth: 240 }}>
                            <div style={{ color: C.green, fontSize: 11, letterSpacing: 2, fontWeight: 800, marginBottom: 6 }}>{label}</div>
                            <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, padding: "0 2px 5px", color: C.faint, fontSize: 9, letterSpacing: 1, fontWeight: 700, borderBottom: `1px solid ${C.line}` }}>
                              <div>HOLE</div><div style={{ textAlign: "center" }}>PAR</div><div style={{ textAlign: "center" }}>S.I.</div>
                            </div>
                            {seg.map((h, jj) => {
                              const j = from + jj;
                              return (
                                <div key={j} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, alignItems: "center", padding: "5px 2px", borderBottom: `1px solid ${C.line}` }}>
                                  <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.n}</div>
                                  <div style={{ textAlign: "center" }}>
                                    <input inputMode="numeric" value={h.par ?? ""}
                                      onChange={(e) => updateHole(j, { par: Math.max(3, Math.min(6, parseInt(e.target.value, 10) || 3)) })}
                                      style={{ ...inputStyle, padding: "5px 2px", width: "100%", maxWidth: 70, textAlign: "center", fontSize: 14 }} />
                                  </div>
                                  <div style={{ textAlign: "center" }}>
                                    <input inputMode="numeric" value={h.si ?? ""}
                                      onChange={(e) => updateHole(j, { si: e.target.value === "" ? null : Math.max(1, Math.min(18, parseInt(e.target.value, 10) || 0)) || null })}
                                      style={{ ...inputStyle, padding: "5px 2px", width: "100%", maxWidth: 70, textAlign: "center", fontSize: 14 }} />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      };
                      return (
                        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                          {nine(0, Math.min(9, picked.holes.length), "FRONT NINE")}
                          {picked.holes.length > 9 && nine(9, 18, "BACK NINE")}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Your handicap index (optional — needed for Stableford)</label>
            <input style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }} inputMode="decimal" placeholder="14.2" value={idxStr} onChange={(e) => setIdxStr(e.target.value)} />
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label style={{ color: C.sage, fontSize: 12 }}>Date played</label>
              <input type="date" max={new Date().toISOString().slice(0, 10)} style={{ ...inputStyle, marginTop: 6, maxWidth: 180 }}
                value={playDate} onChange={(e) => setPlayDate(e.target.value)} />
            </div>
            <div style={{ color: C.sage, fontSize: 12 }}>
              {playDate === new Date().toISOString().slice(0, 10) ? "Playing today" : "Logging a past round"}
            </div>
          </div>
          {realCH != null && (
            <div style={{ color: C.gold, fontWeight: 800, marginTop: 12, fontSize: 15 }}>
              Course handicap: {realCH} {realCH >= 0 ? `(you get ${realCH} stroke${realCH === 1 ? "" : "s"})` : "(plus handicap)"}
              <div style={{ color: C.sage, fontWeight: 400, fontSize: 11, marginTop: 4 }}>
                index × (slope ÷ 113) + (rating − par), rounded
              </div>
            </div>
          )}

          {/* Entry mode: full scorecard vs quick gross total */}
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button style={grossMode ? btn(false) : btn(true)} onClick={() => setGrossMode(false)}>Hole-by-hole</button>
              <button style={grossMode ? btn(true) : btn(false)} onClick={() => setGrossMode(true)}>Quick total score</button>
            </div>
            {grossMode ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: C.sage, fontSize: 12, marginBottom: 8 }}>
                  Enter your total (gross) strokes for the round. This counts toward your handicap and scoring average. You can add hole-by-hole detail to it later from the round.
                </div>
                <label style={{ color: C.sage, fontSize: 12 }}>Total score (par {picked.holes.reduce((s, h) => s + (h.par || 0), 0)})</label>
                <input inputMode="numeric" placeholder="86" value={grossStr}
                  onChange={(e) => setGrossStr(e.target.value.replace(/\D/g, ""))}
                  style={{ ...inputStyle, marginTop: 6, maxWidth: 140 }} />
                {grossErr && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 8 }}>{grossErr}</div>}
              </div>
            ) : (
              <div style={{ color: C.sage, fontSize: 12, marginTop: 10 }}>Enter each hole's score on the next screen.</div>
            )}
          </div>

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
            {grossMode ? (
              <button style={{ ...btn(true), opacity: grossSaving ? 0.5 : 1 }} disabled={grossSaving} onClick={startGross}>{grossSaving ? "Saving…" : "Save round"}</button>
            ) : (
              <button style={btn(true)} onClick={start}>Continue to scorecard ›</button>
            )}
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

