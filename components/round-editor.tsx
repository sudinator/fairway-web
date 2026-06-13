"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
} from "@/lib/golf";
import { buildCustomCourse, linkCourseToGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

const supabase = createClient();

export function RoundEditor({ round, onSaved, onCancel }: { round: Round; onSaved: () => void; onCancel: () => void }) {
  const [holes, setHoles] = useState<Hole[]>(round.holes);

  // If this round has no per-hole data (a gross-only round gaining detail), build a hole layout.
  useEffect(() => {
    if (round.holes.length > 0) return;
    (async () => {
      // Try to pull the real par/S.I. from the saved course library.
      let favQuery = supabase.from("favorite_courses").select("data").eq("name", round.course);
      if (round.group_id) favQuery = favQuery.eq("group_id", round.group_id);
      const { data: fav } = await favQuery.maybeSingle();
      const courseHoles = (fav?.data?.holes || []) as { n: number; par: number; si: number | null }[];
      const base = courseHoles.length >= 9
        ? courseHoles
        : Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
      const alloc = allocateStrokes(base.map((h) => ({ hole_number: h.n, stroke_index: h.si })), round.course_handicap);
      setHoles(base.map((h) => ({
        hole_number: h.n, par: h.par, stroke_index: h.si,
        strokes: null, putts: null, fairway: null, penalties: 0,
        recv: alloc[h.n] || 0,
      })));
    })();
  }, [round.id]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [favMsg, setFavMsg] = useState<string | null>(null);
  // Auto-save: the round is created lazily on the first hole tap, then each hole
  // is written to the DB as you enter it — so a phone lock or refresh can't wipe scores.
  const [roundId, setRoundId] = useState<string>(round.id || "");
  const [autoSaveMsg, setAutoSaveMsg] = useState<string | null>(null);
  const creatingRef = React.useRef<Promise<string> | null>(null);
  const rowsEnsuredRef = React.useRef(false);

  // Ensure a round row + 18 (or N) blank hole rows exist; returns the round id.
  const ensureRound = useCallback(async (holeLayout: Hole[]): Promise<string> => {
    if (roundId) {
      // Round already exists (new round already auto-created, or a gross round gaining detail).
      // Make sure a row exists for every hole so per-hole updates land.
      if (!rowsEnsuredRef.current) {
        rowsEnsuredRef.current = true;
        const { data: existing } = await supabase.from("holes").select("hole_number").eq("round_id", roundId);
        const have = new Set((existing || []).map((r: any) => r.hole_number));
        const missing = holeLayout.filter((h) => !have.has(h.hole_number));
        if (missing.length) {
          await supabase.from("holes").insert(missing.map((h) => ({
            round_id: roundId, hole_number: h.hole_number, par: h.par,
            stroke_index: h.stroke_index, strokes: null, putts: null, fairway: null, penalties: 0,
          })));
        }
      }
      return roundId;
    }
    if (creatingRef.current) return creatingRef.current;
    const p = (async () => {
      const { data: u } = await supabase.auth.getUser();
      const { data: r, error: e1 } = await supabase.from("rounds").insert({
        user_id: u.user!.id,
        course: round.course, tee_name: round.tee_name,
        rating: round.rating, slope: round.slope, course_par: round.course_par,
        handicap_index: round.handicap_index, course_handicap: round.course_handicap,
        played_at: round.played_at, group_id: round.group_id || null,
      }).select().single();
      if (e1 || !r) throw e1 || new Error("Could not start round");
      // Pre-create a row per hole so each tap is a simple update (no constraints needed).
      const blankRows = holeLayout.map((h) => ({
        round_id: r.id, hole_number: h.hole_number, par: h.par,
        stroke_index: h.stroke_index, strokes: null, putts: null, fairway: null, penalties: 0,
      }));
      await supabase.from("holes").insert(blankRows);
      setRoundId(r.id);
      return r.id as string;
    })();
    creatingRef.current = p;
    return p;
  }, [roundId, round]);

  // Persist a single hole to the DB (auto-save).
  const persistHole = useCallback(async (h: Hole, layout: Hole[]) => {
    try {
      setAutoSaveMsg("Saving…");
      const rid = await ensureRound(layout);
      await supabase.from("holes").update({
        strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties || 0,
      }).eq("round_id", rid).eq("hole_number", h.hole_number);
      setAutoSaveMsg("Saved ✓");
      setTimeout(() => setAutoSaveMsg(null), 1200);
    } catch (e: any) {
      setAutoSaveMsg(null);
      setErr("Couldn't auto-save that hole — check your connection. Your other saved holes are safe.");
    }
  }, [ensureRound]);

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
    const siErr = validateStrokeIndexes(course.holes.map((h) => ({ n: h.n, si: h.si })));
    if (siErr) { setFavMsg("Can't save — " + siErr); return; }
    try {
      const { data: existing } = await supabase.from("favorite_courses").select("id").eq("name", round.course).maybeSingle();
      let courseId = existing?.id as string | undefined;
      if (courseId) {
        const { error } = await supabase.from("favorite_courses").update({ location: round.tee_name || "", data: course }).eq("id", courseId);
        if (error) throw error;
        setFavMsg("Course library updated ★");
      } else {
        const { data: created, error } = await supabase.from("favorite_courses")
          .insert({ group_id: round.group_id || null, name: round.course, location: round.tee_name || "", data: course })
          .select("id").single();
        if (error || !created) throw error || new Error("save failed");
        courseId = created.id;
        setFavMsg("Saved to course library ★");
      }
      if (round.group_id && courseId) await linkCourseToGroup(supabase, round.group_id, courseId, null);
    } catch (e: any) {
      setFavMsg("Couldn't save: " + (e.message || "error"));
    }
  };

  const setHole = (i: number, patch: Partial<Hole>) => {
    setHoles((hs) => {
      const next = hs.map((h, j) => (j === i ? { ...h, ...patch } : h));
      // Auto-save this hole to the DB (fire and forget).
      persistHole(next[i], next);
      return next;
    });
  };

  const live: Round = { ...round, holes };
  const anyPlayed = holes.some((h) => h.strokes);
  const gir = girStats([live]), fir = firStats([live]);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      // Holes are auto-saved as you tap, so by now the round + holes already exist.
      // Make sure the round exists (covers the rare case of tapping Save with no prior persist),
      // then write the current hole values once more to guarantee the latest state is stored.
      const rid = await ensureRound(holes);
      // If this was an existing gross-only round gaining detail, clear its gross_score.
      if (round.id) {
        await supabase.from("rounds").update({ gross_score: null, course_par: round.course_par }).eq("id", rid);
      }
      // Upsert-by-update every hole to be safe (rows were pre-created).
      for (const h of holes) {
        await supabase.from("holes").update({
          strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties || 0,
        }).eq("round_id", rid).eq("hole_number", h.hole_number);
      }
      try {
        const { data: u } = await supabase.auth.getUser();
        const total = holes.reduce((s, h) => s + (h.strokes || 0), 0);
        await logActivity(supabase, { actor_id: u.user!.id, actor_name: u.user?.email || "A player", action: "round_completed", group_id: round.group_id || null, summary: `Completed a round at ${round.course}${total ? ` (${total})` : ""}` });
      } catch {}
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
      <div style={{ color: C.gold, fontSize: 12, marginBottom: 10 }}>
        Scores save automatically as you tap — you can lock your phone or close the app and pick up where you left off.
      </div>
      <ScoreEntryCard
        holes={(() => {
          const alloc = allocateStrokes(holes.map((h) => ({ hole_number: h.hole_number, stroke_index: h.stroke_index })), round.course_handicap);
          return holes.map((h) => ({
            n: h.hole_number, par: h.par, si: h.stroke_index,
            strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties,
            recv: alloc[h.hole_number] || 0,
          }));
        })()}
        hasHandicap={round.course_handicap != null}
        onSet={(i, patch) => {
          const p: Partial<Hole> = {};
          if (patch.strokes !== undefined) p.strokes = patch.strokes;
          if (patch.putts !== undefined) p.putts = patch.putts;
          if (patch.fairway !== undefined) p.fairway = patch.fairway;
          if (patch.penalties !== undefined) p.penalties = patch.penalties ?? 0;
          setHole(i, p);
        }}
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
        {autoSaveMsg && <span style={{ color: C.gold, fontSize: 12 }}>{autoSaveMsg}</span>}
        <button style={btn(false)} onClick={saveCorrectedFavorite}>★ Save course</button>
        <button style={btn(false)} onClick={onCancel}>{roundId ? "Done" : "Cancel"}</button>
        <button style={{ ...btn(true), opacity: anyPlayed && !saving ? 1 : 0.5 }} disabled={!anyPlayed || saving} onClick={save}>
          {saving ? "Saving…" : "Finish round"}
        </button>
      </div>
      {favMsg && <div style={{ color: C.gold, fontSize: 12, marginTop: 8, textAlign: "right" }}>{favMsg}</div>}
    </div>
  );
}

