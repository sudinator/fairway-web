"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
} from "@/lib/golf";
import { buildCustomCourse, linkCourseToGroup } from "@/lib/courses";
import { saveDraft, loadDraft, clearDraft, draftHasScores } from "@/lib/draft";
import { logActivity } from "@/lib/activity";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark } from "@/components/ui";

const supabase = createClient();

export function RoundEditor({ round, onSaved, onCancel }: { round: Round; onSaved: () => void; onCancel: () => void }) {
  // Initialize from whichever source has MORE entered scores: the round passed in,
  // or the draft saved in storage. This makes the editor self-healing — if it gets
  // remounted (e.g. after a screen lock) with an empty round, it recovers the saved
  // scores from storage instead of resetting the scorecard to blank.
  const initialHoles = React.useMemo<Hole[]>(() => {
    const fromProp = round.holes || [];
    const propScored = fromProp.filter((h) => h.strokes != null).length;
    try {
      const d = loadDraft();
      const dh = d?.round?.holes || [];
      const draftScored = dh.filter((h: any) => h.strokes != null).length;
      // Use the draft only if it matches this course and has at least as many scores.
      const sameRound = d?.round?.course === round.course;
      if (sameRound && draftScored > propScored) return dh as Hole[];
    } catch {}
    return fromProp;
  }, []); // mount only
  const [holes, setHoles] = useState<Hole[]>(initialHoles);
  // Single source of truth = `holes` state. A ref mirrors it for the lock/flush
  // handler to read synchronously; written only inside setHole.
  const holesRef = React.useRef<Hole[]>(initialHoles);
  const touchedRef = React.useRef(false); // has the user entered anything?

  // If this round has no per-hole data at all (a gross-only round gaining detail),
  // build a blank hole layout. Guard hard against wiping a resumed draft: only
  // synthesize when there are genuinely no holes AND none have been loaded into
  // state. (Resumed drafts have empty round.id, so we must check the live holes,
  // not just the prop, or this async effect blanks the scores a beat after they load.)
  const synthesizedRef = React.useRef(false);
  useEffect(() => {
    if (round.holes.length > 0) return;       // round already carries holes
    if (holesRef.current.length > 0) return;  // holes already in state (resumed/loaded)
    if (synthesizedRef.current) return;        // only ever do this once
    synthesizedRef.current = true;
    (async () => {
      let favQuery = supabase.from("favorite_courses").select("data").eq("name", round.course);
      if (round.group_id) favQuery = favQuery.eq("group_id", round.group_id);
      const { data: fav } = await favQuery.maybeSingle();
      // Re-check after the await — if holes arrived meanwhile, do NOT overwrite them.
      if (holesRef.current.length > 0) return;
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
  const isResumed = !!round.id || draftHasScores(round);
  // Server-side backup: the DB round id once a background save has created it.
  const dbIdRef = React.useRef<string>(round.id || "");
  const blanksRef = React.useRef(false);
  const saveTimerRef = React.useRef<any>(null);
  // Always-current refs so saves never use a stale snapshot.
  const roundRef = React.useRef<Round>(round);
  roundRef.current = round;

  // Best-effort background save to the database. Never blocks entry and swallows
  // errors — local storage is the instant guarantee; this is server redundancy
  // so a round survives even if device storage is cleared or you switch devices.
  const backgroundSave = useCallback(async (currentHoles: Hole[]) => {
    try {
      let rid = dbIdRef.current;
      if (!rid) {
        const { data: u } = await supabase.auth.getUser();
        const { data: r } = await supabase.from("rounds").insert({
          user_id: u.user!.id,
          course: round.course, tee_name: round.tee_name,
          rating: round.rating, slope: round.slope, course_par: round.course_par,
          handicap_index: round.handicap_index, course_handicap: round.course_handicap,
          played_at: round.played_at, group_id: round.group_id || null,
          status: "in_progress",
        }).select().single();
        if (!r) return;
        rid = r.id;
        dbIdRef.current = rid;
      }
      if (!blanksRef.current) {
        blanksRef.current = true;
        const { data: existing } = await supabase.from("holes").select("hole_number").eq("round_id", rid);
        const have = new Set((existing || []).map((x: any) => x.hole_number));
        const missing = currentHoles.filter((h) => !have.has(h.hole_number));
        if (missing.length) {
          await supabase.from("holes").insert(missing.map((h) => ({
            round_id: rid, hole_number: h.hole_number, par: h.par,
            stroke_index: h.stroke_index, strokes: null, putts: null, fairway: null, penalties: 0,
          })));
        }
      }
      for (const h of currentHoles) {
        await supabase.from("holes").update({
          strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties || 0,
        }).eq("round_id", rid).eq("hole_number", h.hole_number);
      }
    } catch {
      // Ignore — local storage already has the data; we'll retry on the next change.
    }
  }, [round]);

  const scheduleBackgroundSave = (currentHoles: Hole[]) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => backgroundSave(currentHoles), 1500);
  };

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
    touchedRef.current = true;
    // Build next from the latest committed holes, then save it SYNCHRONOUSLY,
    // right here, before returning — so the write lands in storage immediately
    // and can't be lost to a screen lock a moment later. We read the freshest
    // holes via the functional updater to avoid stale closures, and persist from
    // inside it using the exact value we are about to commit.
    setHoles((prev) => {
      const next = prev.map((h, j) => (j === i ? { ...h, ...patch } : h));
      holesRef.current = next;
      saveDraft({ ...roundRef.current, holes: next, id: dbIdRef.current || round.id });
      scheduleBackgroundSave(next);
      return next;
    });
  };

  // iOS Safari can defer flushing localStorage to disk and lose a just-made write if
  // the page is frozen by a screen lock immediately after. Re-saving in the
  // visibilitychange/pagehide handlers forces the write at the last reliable moment.
  useEffect(() => {
    const flush = () => {
      if (holesRef.current.some((h) => h.strokes != null)) {
        saveDraft({ ...roundRef.current, holes: holesRef.current, id: dbIdRef.current || round.id });
        backgroundSave(holesRef.current); // best-effort server write too
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    // Cover every browser's "page is being hidden / suspended" signal:
    //  - visibilitychange→hidden: all browsers, fires on lock/background/tab-switch
    //  - pagehide: iOS Safari & Chrome (WebKit) on background/navigation
    //  - blur: extra iOS lock coverage
    //  - freeze: Android Chrome (Page Lifecycle API) when a backgrounded tab is frozen
    //  - beforeunload: desktop refresh/close
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("freeze", flush);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", flush);
    window.addEventListener("blur", flush);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("freeze", flush);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", flush);
      window.removeEventListener("blur", flush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);

  const live: Round = { ...round, holes };
  const anyPlayed = holes.some((h) => h.strokes);
  const gir = girStats([live]), fir = firStats([live]);

  const save = async () => {
    setSaving(true); setErr(null);
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      let roundId = dbIdRef.current || round.id;
      if (roundId) {
        // Round already exists (from the background save, or a gross round gaining detail).
        // Make sure every hole row exists, then write current values and mark it final.
        const { data: existing } = await supabase.from("holes").select("hole_number").eq("round_id", roundId);
        const have = new Set((existing || []).map((x: any) => x.hole_number));
        const missing = holes.filter((h) => !have.has(h.hole_number));
        if (missing.length) {
          await supabase.from("holes").insert(missing.map((h) => ({
            round_id: roundId, hole_number: h.hole_number, par: h.par,
            stroke_index: h.stroke_index, strokes: null, putts: null, fairway: null, penalties: 0,
          })));
        }
        for (const h of holes) {
          await supabase.from("holes").update({
            strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties || 0,
          }).eq("round_id", roundId).eq("hole_number", h.hole_number);
        }
        await supabase.from("rounds").update({ course_par: round.course_par, gross_score: null, status: "final" }).eq("id", roundId);
      } else {
        const { data: u } = await supabase.auth.getUser();
        const { data: r, error: e1 } = await supabase.from("rounds").insert({
          user_id: u.user!.id,
          course: round.course, tee_name: round.tee_name,
          rating: round.rating, slope: round.slope, course_par: round.course_par,
          handicap_index: round.handicap_index, course_handicap: round.course_handicap,
          played_at: round.played_at, group_id: round.group_id || null, status: "final",
        }).select().single();
        if (e1 || !r) throw e1 || new Error("Could not save round");
        roundId = r.id;
        const rows = holes.map((h) => ({
          round_id: roundId, hole_number: h.hole_number, par: h.par,
          stroke_index: h.stroke_index, strokes: h.strokes, putts: h.putts,
          fairway: h.fairway, penalties: h.penalties || 0,
        }));
        const { error: e2 } = await supabase.from("holes").insert(rows);
        if (e2) throw e2;
      }
      try {
        const { data: u } = await supabase.auth.getUser();
        const total = holes.reduce((s, h) => s + (h.strokes || 0), 0);
        await logActivity(supabase, { actor_id: u.user!.id, actor_name: u.user?.email || "A player", action: "round_completed", group_id: round.group_id || null, summary: `Completed a round at ${round.course}${total ? ` (${total})` : ""}` });
      } catch {}
      clearDraft();
      onSaved();
    } catch (e: any) {
      setErr(e.message || "Save failed. Check your connection and try again.");
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (draftHasScores({ ...round, holes }) && !confirm("Discard this in-progress round? Your entered scores will be cleared.")) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    clearDraft();
    // Remove the background in-progress round from the server, if one was created.
    const rid = dbIdRef.current;
    if (rid && !round.id) {
      try {
        await supabase.from("holes").delete().eq("round_id", rid);
        await supabase.from("rounds").delete().eq("id", rid);
      } catch {}
    }
    onCancel();
  };

  return (
    <div>
      <DebugStrip holes={holes} />
      <div style={{ color: C.sage, fontSize: 13, marginBottom: 10 }}>
        {round.course}{round.tee_name ? ` · ${round.tee_name} tees (${round.rating}/${round.slope})` : ""}
        {round.course_handicap != null ? ` · course handicap ${round.course_handicap}` : " · no handicap — Stableford scored gross"}
      </div>
      <div style={{ color: C.gold, fontSize: 12, marginBottom: 10 }}>
        Scores save to this device as you tap — lock your phone or close the app and you'll come right back to this scorecard. Tap "Finish round" when you're done to record it.
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
        <button style={btn(false)} onClick={saveCorrectedFavorite}>★ Save course</button>
        <button style={btn(false)} onClick={cancel}>{isResumed ? "Discard" : "Cancel"}</button>
        <button style={{ ...btn(true), opacity: anyPlayed && !saving ? 1 : 0.5 }} disabled={!anyPlayed || saving} onClick={save}>
          {saving ? "Saving…" : "Finish round"}
        </button>
      </div>
      {favMsg && <div style={{ color: C.gold, fontSize: 12, marginTop: 8, textAlign: "right" }}>{favMsg}</div>}
    </div>
  );
}


// TEMPORARY DEBUG STRIP — shows what is in the editor's live state vs. what is
// actually saved in localStorage, refreshed every second and on lock/visibility.
// Remove once score persistence is confirmed working.
function DebugStrip({ holes }: { holes: Hole[] }) {
  const [stored, setStored] = useState<string>("(reading…)");
  const read = () => {
    try {
      const raw = window.localStorage.getItem("bnn_round_draft_v1");
      if (!raw) { setStored("EMPTY"); return; }
      const r = JSON.parse(raw)?.round;
      const arr: any[] = r?.holes || [];
      const filled = arr.filter((h) => h.strokes != null);
      setStored(`${filled.length} holes [${filled.map((h) => `${h.hole_number}:${h.strokes}`).join(" ")}]`);
    } catch (e: any) { setStored("ERR " + (e?.message || "")); }
  };
  useEffect(() => {
    read();
    const t = setInterval(read, 1000);
    const onVis = () => read();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); window.removeEventListener("focus", onVis); };
  }, []);
  const liveFilled = holes.filter((h) => h.strokes != null);
  return (
    <div style={{ background: "#2A1A1A", border: "1px solid #C0392B", borderRadius: 8, padding: "8px 10px", marginBottom: 10, fontSize: 11, color: "#FFD7D2", fontFamily: "monospace", lineHeight: 1.5 }}>
      <div><b>DEBUG</b> — live on screen: {liveFilled.length} holes [{liveFilled.map((h) => `${h.hole_number}:${h.strokes}`).join(" ")}]</div>
      <div>saved in storage: {stored}</div>
    </div>
  );
}
