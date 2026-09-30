"use client";

import React, { useEffect, useState, useCallback } from "react";
import { failureMessage } from "@/lib/errors";
import { createClient } from "@/lib/supabase";
import { dbg, newSid } from "@/lib/debuglog";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay, withHistoricalRatingSlopeCorrection,
} from "@/lib/golf";
import { buildCustomCourse, linkCourseToGroup, loadCoursesForGroup } from "@/lib/courses";
import { saveDraft, loadDraft, clearDraft, draftHasScores, saveDraftHole, sameDraftRound, saveEditorDraft, loadEditorDraft, clearEditorDraft } from "@/lib/draft";
import { logActivity } from "@/lib/activity";
import { btn, inputStyle, Eyebrow, StatCard, NumPicker, ScoreEntryCard, ScoreViewCard, Wordmark, ShortDateInput } from "@/components/ui";
import { buildCourseChangeSummary, hasMaterialCourseChanges } from "@/lib/course-diff";

const supabase = createClient();

export function RoundEditor({ round, onSaved, onCancel }: { round: Round; onSaved: () => void; onCancel: () => void }) {
  const isRecordedFinal = !!round.id && (round.status ?? "final") !== "in_progress";
  const [sessionId] = useState(() => round.id || round.draft_session_id || crypto.randomUUID());
  const editKey = `round:${sessionId}`;
  const recovered = React.useMemo(() => {
    if (isRecordedFinal) {
      const d = loadEditorDraft<{ round: Round; playDate: string; ratingText: string; slopeText: string; chEdit: string | null }>(editKey);
      return d?.round?.id === round.id ? d : null;
    }
    return null;
  }, []);
  const initialHoles = React.useMemo<Hole[]>(() => {
    if (recovered) return recovered.round.holes;
    const d = loadDraft();
    return !isRecordedFinal && d && sameDraftRound(d.round, { ...round, draft_session_id: sessionId })
      ? d.round.holes : round.holes || [];
  }, []);
  const [holes, setHoles] = useState<Hole[]>(initialHoles);
  // Resume to the LAST hole that has a score — the hole the user was working on — so their
  // most recent entry (and any incomplete hole) is on screen, not skipped. Computed once at mount.
  const resumeHoleTarget = React.useMemo(() => {
    let last = -1;
    for (let i = holes.length - 1; i >= 0; i--) { const s = holes[i]?.strokes; if (s != null && s > 0) { last = i; break; } }
    return last;
  }, []);
  // Editable play date — defaults to the round's stored date (falls back to today).
  const todayLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const [playDate, setPlayDate] = useState<string>(() => recovered?.playDate || (round.played_at ? String(round.played_at).slice(0, 10) : todayLocal()));
  // Historical course values are editable only on an already-recorded round. They are
  // intentionally separate from the course library: correcting this snapshot changes this
  // round's differential/handicap history, not future rounds or the original game result.
  const initialRatingText = round.rating == null ? "" : String(round.rating);
  const initialSlopeText = round.slope == null ? "" : String(round.slope);
  const [ratingText, setRatingText] = useState(recovered?.ratingText ?? initialRatingText);
  const [slopeText, setSlopeText] = useState(recovered?.slopeText ?? initialSlopeText);
  /** Manual course handicap being typed. null = untouched; "" = cleared back to derived. */
  const [chEdit, setChEdit] = useState<string | null>(recovered?.chEdit ?? null);
  const ratingSlopeEdited = isRecordedFinal && (ratingText !== initialRatingText || slopeText !== initialSlopeText);
  const ratingTrim = ratingText.trim();
  const slopeTrim = slopeText.trim();
  const parsedRating = ratingTrim === "" ? null : Number(ratingTrim);
  const parsedSlope = slopeTrim === "" ? null : Number(slopeTrim);
  const ratingSlopeError = (() => {
    if (!ratingSlopeEdited) return null;
    if ((ratingTrim === "") !== (slopeTrim === "")) return "Enter both course rating and slope, or leave both blank.";
    if (ratingTrim === "" && slopeTrim === "") return null;
    if (!Number.isFinite(parsedRating) || (parsedRating as number) <= 0) return "Course rating must be a positive number.";
    if (!Number.isFinite(parsedSlope) || (parsedSlope as number) <= 0 || !Number.isInteger(parsedSlope)) return "Slope must be a positive whole number.";
    return null;
  })();
  // Backdating is deliberate but easy to fumble — confirm when the play date is before today.
  const confirmPastDate = (): boolean => {
    const today = todayLocal();
    if (!playDate || playDate >= today) return true;
    const days = Math.round((+new Date(today + "T00:00:00") - +new Date(playDate + "T00:00:00")) / 86400000);
    return confirm(`This round is dated ${playDate} — ${days} day${days === 1 ? "" : "s"} in the past. Save it with that date?`);
  };
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
      let fav: any = null;
      if (round.group_id) {
        try {
          const groupCourses = await loadCoursesForGroup(supabase, round.group_id);
          fav = groupCourses.find((c: any) => c.name === round.course || c.data?.name === round.course) || null;
        } catch {
          // A failed library read is not evidence that the course is unknown. Do not synthesize a
          // generic layout on a transient error; allow a later reopen/retry to load authoritative data.
          synthesizedRef.current = false;
          setErr("Couldn't load this course's hole details. Your round was not changed — please try again.");
          return;
        }
      }
      // Do not fall back to a global name-only lookup: course names are not globally unique.
      // If the round's group library cannot identify it, use the safe generic layout below.
      // Re-check after the await — if holes arrived meanwhile, do NOT overwrite them.
      if (holesRef.current.length > 0) return;
      const courseHoles = (fav?.data?.holes || []) as { n: number; par: number; si: number | null }[];
      const base = courseHoles.length >= 9
        ? courseHoles
        : Array.from({ length: 18 }, (_, i) => ({ n: i + 1, par: 4, si: i + 1 }));
      const myTee = ((fav?.data?.tees || []) as any[]).find((t) => t.name === round.tee_name);
      const alloc = allocateStrokes(base.map((h) => ({ hole_number: h.n, stroke_index: h.si })), round.course_handicap);
      setHoles(base.map((h, i) => ({
        hole_number: h.n, par: h.par, stroke_index: h.si,
        yardage: myTee?.yardages?.[i] ?? null,
        strokes: null, putts: null, fairway: null, penalties: 0,
        recv: alloc[h.n] || 0,
      })));
    })();
  }, [round.id]);

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [bgSaveFailed, setBgSaveFailed] = useState(false);
  const [favMsg, setFavMsg] = useState<string | null>(null);
  const [courseCorrectionReason, setCourseCorrectionReason] = useState("");
  const isResumed = !!round.id || draftHasScores(round);
  const discardedRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const backgroundPromiseRef = React.useRef<Promise<void>>(Promise.resolve());
  const sidRef = React.useRef<string>(newSid());
  const roundRef = React.useRef<Round>(round);
  roundRef.current = round;

  const persistDraft = (currentHoles: Hole[]) => {
    if (discardedRef.current) return;
    if (isRecordedFinal) {
      saveEditorDraft(editKey, { round: { ...round, holes: currentHoles }, playDate, ratingText, slopeText, chEdit });
    } else {
      saveDraft({ ...round, id: sessionId, draft_session_id: sessionId, status: "in_progress", holes: currentHoles,
        played_at: playDate, course_handicap: effectiveCourseHandicap,
        course_handicap_source: manualCh != null ? "manual" : "derived" }, true);
    }
  };

  // Serialize backups; Finish/Discard stop admission and wait for all admitted writes.
  const backgroundSave = useCallback((currentHoles: Hole[]) => {
    if (isRecordedFinal || discardedRef.current || savingRef.current) return;
    const snapshot = { ...roundRef.current, holes: currentHoles };
    backgroundPromiseRef.current = backgroundPromiseRef.current.then(async () => {
      if (discardedRef.current || savingRef.current) return;
      try {
        const { error } = await supabase.rpc("save_personal_round", {
          p_round_id: sessionId, p_round: snapshot, p_final: false, p_metadata_only: false,
        });
        if (!discardedRef.current) setBgSaveFailed(!!error);
      } catch { if (!discardedRef.current) setBgSaveFailed(true); }
    });
  }, [isRecordedFinal, sessionId]);

  const scheduleBackgroundSave = (currentHoles: Hole[]) => {
    if (isRecordedFinal || discardedRef.current || savingRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => backgroundSave(currentHoles), 1500);
  };

  // Save the corrected par/stroke-index back as a favorite course for next time.
  // Corrections PRESERVE the course's canonical identity (external_id) and just
  // mark it as locally corrected, so it never loses its API id and others can be
  // warned it's been improved rather than treating it as a different course.
  const saveCorrectedFavorite = async () => {
    setFavMsg(null);
    const coursePar = holes.reduce((s, h) => s + h.par, 0);
    const newHoles = holes.map((h) => ({ n: h.hole_number, par: h.par, si: h.stroke_index }));
    const siErr = validateStrokeIndexes(newHoles.map((h) => ({ n: h.n, si: h.si })));
    if (siErr) { setFavMsg("Can't save — " + siErr); return; }
    try {
      // Resolve only within this round's group library. Name alone is not a global identity.
      const groupCourses = round.group_id ? await loadCoursesForGroup(supabase, round.group_id) : [];
      const matches = groupCourses.filter((c: any) => c.name === round.course || c.data?.name === round.course);
      const existing = matches.length === 1 ? matches[0] : null;

      const prevData = (existing?.data as any) || {};
      const prevExternalId = existing?.external_id || prevData.externalId || prevData.id || null;
      const keepExternalId = prevExternalId && prevExternalId !== "corrected" ? String(prevExternalId) : null;
      const prevClub = existing?.facility || prevData.club || "";

      // Merge: keep prior tees, update the played tee's rating/slope/par.
      const prevTees = Array.isArray(prevData.tees) && prevData.tees.length ? prevData.tees : [];
      const teeName = round.tee_name || "Default";
      let tees = prevTees.length ? prevTees.map((t: any) =>
        t.name === teeName ? { ...t, rating: round.rating ?? t.rating, slope: round.slope ?? t.slope, par: coursePar } : t
      ) : [{ name: teeName, rating: round.rating ?? 72, slope: round.slope ?? 113, par: coursePar }];
      if (prevTees.length && !prevTees.some((t: any) => t.name === teeName)) {
        tees = [...tees, { name: teeName, rating: round.rating ?? 72, slope: round.slope ?? 113, par: coursePar }];
      }

      const course = {
        id: keepExternalId || prevData.id || "manual",
        externalId: keepExternalId,
        club: prevClub,
        name: round.course,
        location: existing?.location || prevData.location || round.tee_name || "",
        tees,
        holes: newHoles,
        corrected: true, // locally improved (pars/SI/rating/slope verified by a member)
      };

      let courseId = existing?.id as string | undefined;
      const row = {
        facility: prevClub || null,
        external_id: keepExternalId,
        corrected: true,
        location: course.location,
        data: course,
      };
      if (courseId && round.group_id) {
        const currentData = prevData || course;
        const hasChanges = hasMaterialCourseChanges(currentData, course);
        if (!hasChanges) {
          await linkCourseToGroup(supabase, round.group_id, courseId, null);
          setFavMsg("Course saved to this club's library ★");
          return;
        }
        if (!courseCorrectionReason.trim()) {
          setFavMsg("Please add a reason for this course correction so an admin can review it.");
          return;
        }
        const { error: corrErr } = await supabase.rpc("submit_course_correction", {
          p_group: round.group_id, p_course: courseId, p_name: round.course, p_location: course.location,
          p_data: course, p_reason: courseCorrectionReason.trim(), p_change_summary: buildCourseChangeSummary(currentData, course),
        });
        if (corrErr) throw corrErr;
        setFavMsg("Course updated for this group ★ (global review pending)");
      } else {
        const { data: created, error } = await supabase.from("favorite_courses")
          .insert({ group_id: round.group_id || null, name: round.course, ...row })
          .select("id").single();
        if (error || !created) throw error || new Error("save failed");
        courseId = created.id;
        setFavMsg("Saved to course library ★ (marked as corrected)");
      }
      if (round.group_id && courseId) await linkCourseToGroup(supabase, round.group_id, courseId, null);
    } catch (e: any) {
      setFavMsg("Couldn't save: " + (e.message || "error"));
    }
  };

  const setHole = (i: number, patch: Partial<Hole>) => {
    if (savingRef.current || discardedRef.current) return;
    touchedRef.current = true;
    // Build next from the latest committed holes, then save it SYNCHRONOUSLY,
    // right here, before returning — so the write lands in storage immediately
    // and can't be lost to a screen lock a moment later. We read the freshest
    // holes via the functional updater to avoid stale closures, and persist from
    // inside it using the exact value we are about to commit.
    setHoles((prev) => {
      const next = prev.map((h, j) => (j === i ? { ...h, ...patch } : h));
      holesRef.current = next;
      persistDraft(next);
      scheduleBackgroundSave(next);
      return next;
    });
  };

  // iOS Safari can defer flushing localStorage to disk and lose a just-made write if
  // the page is frozen by a screen lock immediately after. Re-saving in the
  // visibilitychange/pagehide handlers forces the write at the last reliable moment.
  useEffect(() => {
    const flush = (via: string) => {
      if (discardedRef.current || savingRef.current) return; // finished/discarded — never resurrect it
      if (holesRef.current.some((h) => h.strokes != null)) {
        dbg("flush", sidRef.current, { via, hasDbId: !!round.id });
        persistDraft(holesRef.current);
        backgroundSave(holesRef.current); // best-effort server write too
      }
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush("visibilitychange"); };
    const onFreeze = () => flush("freeze");
    const onPageHide = () => flush("pagehide");
    const onBeforeUnload = () => flush("beforeunload");
    const onBlur = () => flush("blur");
    // Cover every browser's "page is being hidden / suspended" signal:
    //  - visibilitychange→hidden: all browsers, fires on lock/background/tab-switch
    //  - pagehide: iOS Safari & Chrome (WebKit) on background/navigation
    //  - blur: extra iOS lock coverage
    //  - freeze: Android Chrome (Page Lifecycle API) when a backgrounded tab is frozen
    //  - beforeunload: desktop refresh/close
    document.addEventListener("visibilitychange", onVis);
    document.addEventListener("freeze", onFreeze);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("blur", onBlur);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      document.removeEventListener("visibilitychange", onVis);
      document.removeEventListener("freeze", onFreeze);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("blur", onBlur);
    };
  }, [round, playDate, ratingText, slopeText, chEdit]);

  const baseLive: Round = { ...round, holes };
  const correctedLive: Round = ratingSlopeEdited && !ratingSlopeError
    ? withHistoricalRatingSlopeCorrection(baseLive, parsedRating, parsedSlope)
    : baseLive;
  const effectiveRating = ratingSlopeEdited && !ratingSlopeError ? parsedRating : round.rating;
  const effectiveSlope = ratingSlopeEdited && !ratingSlopeError ? parsedSlope : round.slope;
  // A manual figure is the authoritative course handicap for THIS round and hole count (0154):
  // used as given, never re-derived and never halved. It therefore outranks both the stored value
  // and any rating/slope edit, which only matter when the handicap is being derived.
  const manualCh = chEdit !== null ? (chEdit === "" ? null : Number(chEdit))
    : (round.course_handicap_source === "manual" ? round.course_handicap : null);
  const derivedHandicap = withHistoricalRatingSlopeCorrection(baseLive, effectiveRating, effectiveSlope).course_handicap;
  const effectiveCourseHandicap = manualCh != null ? manualCh
    : chEdit === "" || (ratingSlopeEdited && !ratingSlopeError) ? derivedHandicap : round.course_handicap;
  const live: Round = { ...correctedLive, course_handicap: effectiveCourseHandicap,
    course_handicap_source: manualCh != null ? "manual" : "derived",
    holes: correctedLive.holes.map((h) => ({ ...h, recv: allocateStrokes(
      holes.map((x) => ({ hole_number: x.hole_number, stroke_index: x.stroke_index })), effectiveCourseHandicap,
    )[h.hole_number] || 0 })),
  };
  useEffect(() => {
    if (touchedRef.current || recovered || chEdit !== null || ratingSlopeEdited || playDate !== round.played_at) persistDraft(holes);
  }, [holes, playDate, ratingText, slopeText, chEdit]);
  roundRef.current = { ...round, played_at: playDate, rating: effectiveRating, slope: effectiveSlope,
    course_handicap: effectiveCourseHandicap, course_handicap_source: manualCh != null ? "manual" : "derived" };
  const anyPlayed = holes.some((h) => h.strokes);
  const metadataOnlyGrossEdit = isRecordedFinal && isGrossOnly(round) && !anyPlayed && (ratingSlopeEdited || chEdit !== null || playDate !== round.played_at);
  const canSave = anyPlayed || metadataOnlyGrossEdit;
  const gir = girStats([live]), fir = firStats([live]);

  const save = async () => {
    if (savingRef.current) return;
    if (manualCh != null && !Number.isFinite(manualCh)) { setErr("Enter a valid course handicap."); return; }
    if (ratingSlopeEdited && ratingSlopeError) { setErr(ratingSlopeError); return; }
    if (!confirmPastDate()) return;
    setSaving(true); setErr(null);
    try {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      savingRef.current = true;
      persistDraft(holesRef.current);
      await backgroundPromiseRef.current;
      const metadataOnly = isRecordedFinal && isGrossOnly(round) && !anyPlayed;
      const payload = { ...round, holes: holesRef.current, played_at: playDate,
        rating: effectiveRating, slope: effectiveSlope,
        course_handicap: effectiveCourseHandicap,
        course_handicap_source: manualCh != null ? "manual" : "derived",
        gross_score: metadataOnly ? (round.gross_score ?? null) : null,
      };
      const { data: result, error: saveError } = await supabase.rpc("save_personal_round", {
        p_round_id: sessionId, p_round: payload, p_final: true, p_metadata_only: metadataOnly,
      });
      if (saveError || !result) throw saveError || new Error("Round save was not confirmed");
      const wasFinal = result.was_final === true;
      // Log "Completed a round" only on the FIRST finalization — not on later edits/re-saves of an
      // already-final round (which otherwise spam the audit trail with a line per save). Also never
      // for game rounds: the game logs its own create/end activity and posts one round per player, so
      // opening a posted round to add stats and saving shouldn't log a completion.
      if (!round.game_id && !wasFinal) {
        try {
          const { data: u } = await supabase.auth.getUser();
          const total = holes.reduce((s, h) => s + (h.strokes || 0), 0);
          await logActivity(supabase, { actor_id: u.user!.id, actor_name: u.user?.email || "A player", action: "round_completed", group_id: round.group_id || null, summary: `Completed a round at ${round.course}${total ? ` (${total})` : ""}` });
        } catch {}
      }
      discardedRef.current = true;
      clearEditorDraft(editKey);
      clearDraft(sessionId);
      onSaved();
    } catch (e: any) {
      setErr(failureMessage("Couldn't save this round", e));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const cancel = async () => {
    if (savingRef.current) return;
    if (!isRecordedFinal && draftHasScores({ ...round, holes }) && !confirm("Discard this in-progress round? Your entered scores will be cleared.")) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (isRecordedFinal) {
      discardedRef.current = true;
      clearEditorDraft(editKey);
      clearDraft(sessionId);
      onCancel(); return;
    }
    savingRef.current = true;
    setSaving(true); setErr(null);
    try {
      await backgroundPromiseRef.current;
      const { error } = await supabase.rpc("discard_personal_round", { p_round_id: sessionId });
      if (error) throw error;
      discardedRef.current = true;
      clearDraft(sessionId);
      onCancel();
    } catch (e: any) {
      savingRef.current = false; setSaving(false);
      setErr(failureMessage("Couldn't discard this round; your draft is still available", e));
    }
  };

  // Only ask for a correction reason if the user actually changed course info
  // (hole pars or stroke indexes) — not when editing scores/putts/fairways.
  const courseInfoChanged = (() => {
    const sig = (hs: { par?: number | null; stroke_index?: number | null }[]) =>
      hs.map((h) => `${h.par ?? ""}:${h.stroke_index ?? ""}`).join("|");
    return sig(holes) !== sig(initialHoles);
  })();

  return (
    <fieldset disabled={saving} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <div style={{ color: C.sage, fontSize: 13, marginBottom: 10 }}>
        {round.course}{round.tee_name ? ` · ${round.tee_name} tees${effectiveRating != null && effectiveSlope != null ? ` (${effectiveRating}/${effectiveSlope})` : ""}` : ""}
        {effectiveCourseHandicap != null ? ` · course handicap ${effectiveCourseHandicap}` : " · no course handicap"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ color: C.sage, fontSize: 12 }}>Play date</span>
        <ShortDateInput value={playDate} onChange={(v) => setPlayDate(v || todayLocal())} />
      </div>
      {isRecordedFinal && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginBottom: 12 }}>
          <Eyebrow style={{ margin: 0 }}>Historical rating / slope</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.45, marginTop: 6 }}>
            Correct these only if the values recorded for this tee were wrong when you played. This changes this recorded round and recalculates its differential/app-estimated handicap; it does not change the course library or the game result.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginTop: 10 }}>
            <label style={{ color: C.sage, fontSize: 12, minWidth: 0 }}>
              Course rating
              <input
                style={{ ...inputStyle, marginTop: 4, minWidth: 0, width: "100%" }}
                inputMode="decimal"
                value={ratingText}
                placeholder="72.1"
                onChange={(e) => setRatingText(e.target.value)}
              />
            </label>
            <label style={{ color: C.sage, fontSize: 12, minWidth: 0 }}>
              Slope
              <input
                style={{ ...inputStyle, marginTop: 4, minWidth: 0, width: "100%" }}
                inputMode="numeric"
                value={slopeText}
                placeholder="130"
                onChange={(e) => setSlopeText(e.target.value)}
              />
            </label>
          </div>
          {ratingSlopeError ? (
            <div style={{ color: C.overRedDark, fontSize: 12, marginTop: 8 }}>{ratingSlopeError}</div>
          ) : ratingSlopeEdited ? (
            <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>
              Preview: {effectiveCourseHandicap != null ? `course handicap ${effectiveCourseHandicap}` : "no course handicap"}
              {roundDifferential(live) != null ? ` · differential ${roundDifferential(live)!.toFixed(1)}` : " · differential unavailable"}
            </div>
          ) : null}
        </div>
      )}
      {(() => {
        // The number entered IS the course handicap for this round's hole count — typically from
        // GHIN — so the field names that hole count. Entering an 18-hole figure against a nine is
        // wrong by a factor of two and looks entirely plausible in the result.
        const nHoles = holes.length === 9 ? 9 : 18;
        const isManual = manualCh != null;
        return (
          <div style={{ background: C.card, borderRadius: 12, padding: 12, marginBottom: 10 }}>
            <label style={{ color: C.faint, fontSize: 11, letterSpacing: 1 }}>{nHoles}-HOLE COURSE HANDICAP</label>
            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
              <input
                inputMode="decimal"
                placeholder={round.course_handicap != null ? String(round.course_handicap) : "\u2014"}
                value={chEdit ?? (isManual && round.course_handicap != null ? String(round.course_handicap) : "")}
                onChange={(e) => { const v = e.target.value; if (v === "" || /^-?\d*\.?\d*$/.test(v)) setChEdit(v); }}
                style={{ ...inputStyle, padding: "8px 12px", width: 74, textAlign: "center" }}
              />
              <span style={{ color: isManual ? C.ink : C.faint, fontWeight: isManual ? 700 : 400, fontSize: 12 }}>
                {isManual ? "manual \u00b7 used as entered, saved with the round" : "leave blank to use the derived figure"}
              </span>
            </div>
          </div>
        );
      })()}
      <div style={{ color: C.gold, fontSize: 12, marginBottom: 10 }}>
        {isRecordedFinal
          ? "Edit the round below, then tap Save changes. Historical rating/slope corrections affect only this recorded round."
          : "Scores save to this device as you tap — lock your phone or close the app and you'll come right back to this scorecard. Tap Finish round when you're done to record it."}
      </div>
      <ScoreEntryCard
        holes={(() => {
          const alloc = allocateStrokes(holes.map((h) => ({ hole_number: h.hole_number, stroke_index: h.stroke_index })), effectiveCourseHandicap);
          return holes.map((h) => ({
            n: h.hole_number, par: h.par, si: h.stroke_index, yards: h.yardage ?? null,
            strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties, sand: h.sand,
            recv: alloc[h.hole_number] || 0,
          }));
        })()}
        hasHandicap={effectiveCourseHandicap != null}
        onSet={(i, patch) => {
          const p: Partial<Hole> = {};
          if (patch.strokes !== undefined) p.strokes = patch.strokes;
          if (patch.putts !== undefined) p.putts = patch.putts;
          if (patch.fairway !== undefined) p.fairway = patch.fairway;
          if (patch.penalties !== undefined) p.penalties = patch.penalties ?? 0;
          if (patch.sand !== undefined) p.sand = patch.sand;
          setHole(i, p);
        }}
        onActiveHole={(i) => saveDraftHole(sessionId, i)}
        resumeHole={resumeHoleTarget}
      />
      {err && <div style={{ color: C.overRedDark, fontSize: 13, marginTop: 10 }}>{err}</div>}
      {bgSaveFailed && <div style={{ color: C.gold, fontSize: 12, marginTop: 10, lineHeight: 1.45 }}>Saved on this device. Couldn&apos;t back up to the server yet — it&apos;ll keep retrying as you enter, and &ldquo;Finish round&rdquo; saves everything.</div>}
      {courseInfoChanged && (
      <div style={{ background: C.greenLight, borderRadius: 12, padding: 12, marginTop: 14 }}>
        <label style={{ color: C.sage, fontSize: 12 }}>Reason for course correction <span style={{ color: C.gold }}>(required before saving course changes)</span></label>
        <textarea
          style={{ ...inputStyle, marginTop: 4, minHeight: 70, resize: "vertical" }}
          value={courseCorrectionReason}
          placeholder="Example: The scorecard shows hole 7 is now a par 5, or the stroke indexes were corrected from the club scorecard."
          onChange={(e) => setCourseCorrectionReason(e.target.value)}
        />
        <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>This reason is sent with the course correction request so app admins know what changed and why.</div>
      </div>
      )}
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
        <button style={btn(false)} onClick={cancel} disabled={saving}>{isRecordedFinal ? "Cancel" : isResumed ? "Discard" : "Cancel"}</button>
        <button style={{ ...btn(true), opacity: canSave && !saving ? 1 : 0.5 }} disabled={!canSave || saving || !!ratingSlopeError} onClick={save}>
          {saving ? "Saving…" : isRecordedFinal ? "Save changes" : "Finish round"}
        </button>
      </div>
      {favMsg && <div style={{ color: C.gold, fontSize: 12, marginTop: 8, textAlign: "right" }}>{favMsg}</div>}
    </fieldset>
  );
}


// TEMPORARY DEBUG STRIP — removed; score persistence confirmed working.
