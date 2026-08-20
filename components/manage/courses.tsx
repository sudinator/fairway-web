"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, titleCaseName, Round, Hole, strokesReceived, stablefordPts, toParStr, fmtDate, played, strokesOf, validateStrokeIndexes, dedupeHoles, TGC_GROUP_ID, effectiveGroupId, runningHandicap, handicapRounds, adjustedGross, roundDifferential, nextRoundOutlook } from "@/lib/golf";
import capabilities from "@/lib/capabilities.json";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList } from "recharts";
import { buildCustomCourse, Course, CourseHole, courseLabel, findExistingCourseId, loadCoursesForGroup, linkCourseToGroup } from "@/lib/courses";
import { normalizeCourseProviderId } from "@/lib/course-provider-id";
import { buildCourseRatingTexts, buildCourseSourceView, shouldShowCourseCorrectionReason, type CourseSourceMode } from "@/lib/course-source-review";
import { logActivity } from "@/lib/activity";
import { diagEnabled, setDiagEnabled, reproduceBug, setReproduceBug, getDiagLog, clearDiagLog } from "@/lib/debuglog";
import { AdminFeedbackTab } from "@/components/feedback";
import { btn, inputStyle, Eyebrow, NumPicker, Avatar, BottomSheet, DifferentialSheet } from "@/components/ui";
import { YardageBackfill } from "@/components/yardage-backfill";
import { AchievementsWall } from "@/components/achievements";
import { PlayerCard, PeerCardModal, CardVisibilityToggle } from "@/components/player-card";
import { resizeToAvatar } from "@/lib/image";
import { APP_VERSION } from "@/lib/app-version";
import { courseChangeLines, buildCourseChangeSummary, hasMaterialCourseChanges } from "@/lib/course-diff";
import { loadFormDraft, saveFormDraft, clearFormDraft, draftAgeLabel } from "@/lib/form-draft";
import { saveActiveCourseEdit, loadActiveCourseEdit, clearActiveCourseEdit, clearAllLocalState } from "@/lib/draft";
import { FeedbackForm, type FeedbackPrefill } from "@/components/feedback";

const supabase = createClient();

// Course library cluster (CourseChangeSummary / CoursesLibrary / CourseEditor / CourseForm) +
// their helpers/types, moved VERBATIM out of manage.tsx (Stage 3 file-split, EXTRACTION_VERIFICATION.md).

// Normalize a stored favorite into the current {tees:[{name,rating,slope,par}], holes:[{n,par,si}]} shape.
function normalize(d: any): Course {
  d = d || {};
  if ((!d.holes || !d.holes.length) && Array.isArray(d.tees)) {
    const t = d.tees.find((x: any) => x.holes && x.holes.length);
    if (t) {
      d.holes = t.holes;
      d.tees = d.tees.map((x: any) => ({ name: x.name, rating: x.rating, slope: x.slope, par: x.par }));
    }
  }
  return d;
}

// ================= Shared Course Library =================
type LibCourse = { id: string; name: string; location: string; user_id: string; data: Course; vetted?: boolean; group_override?: boolean; group_override_updated_at?: string | null };
type CourseEditRequest = {
  id: string;
  course_id: string;
  group_id: string;
  submitted_by: string | null;
  proposed_name: string;
  proposed_location: string | null;
  proposed_data: Course;
  reason?: string | null;
  change_summary?: string | null;
  status: "pending" | "approved" | "group_only" | "rejected_removed" | "rejected";
  created_at: string;
  current_course?: LibCourse | null;
  group_name?: string | null;
  submitter_name?: string | null;
  submitter_email?: string | null;
};
type CourseTab = "group" | "all";
type CourseProviderSource = { provider: Course; stored: Course | null; existingId: string | null; selectedSource?: CourseSourceMode };

function courseCardTitle(c: LibCourse) {
  return courseLabel(c.data || ({ name: c.name } as any));
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown time";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function CourseChangeSummary({ req }: { req: CourseEditRequest }) {
  const current = req.current_course?.data || null;
  const proposed = req.proposed_data || null;
  const lines = courseChangeLines(current, proposed);
  const visible = lines;
  const extra = 0;
  const submitter = req.submitter_name || req.submitter_email || "Unknown user";

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      <div style={{ background: C.greenLight, borderRadius: 10, padding: 10, border: `1px solid ${C.borderCard}` }}>
        <div style={{ color: C.cream, fontSize: 11, letterSpacing: 1.5, fontWeight: 800, marginBottom: 6 }}>SUBMISSION DETAILS</div>
        <div style={{ color: C.cream, fontSize: 13, lineHeight: 1.6 }}>
          <div><b>Submitted by:</b> {submitter}</div>
          <div><b>Club:</b> {req.group_name || "Unknown club"}</div>
          <div><b>Submitted at:</b> {formatDateTime(req.created_at)}</div>
          <div><b>Reason:</b> {req.reason?.trim() || "No reason provided."}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div style={{ background: C.greenLight, borderRadius: 10, padding: 10, border: `1px solid ${C.borderCard}` }}>
          <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }}>CURRENT GLOBAL</div>
          <div style={{ color: C.cream, fontWeight: 800, marginTop: 5 }}>{current ? courseLabel(current) : "Unknown course"}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{current?.location || "No location"}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{current?.tees?.length || 0} tee{(current?.tees?.length || 0) === 1 ? "" : "s"} · {current?.holes?.length || 0} holes</div>
        </div>
        <div style={{ background: C.greenLight, borderRadius: 10, padding: 10, border: `1px solid ${C.gold}` }}>
          <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }}>PROPOSED GLOBAL</div>
          <div style={{ color: C.cream, fontWeight: 800, marginTop: 5 }}>{proposed ? courseLabel(proposed) : req.proposed_name}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{proposed?.location || req.proposed_location || "No location"}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{proposed?.tees?.length || 0} tee{(proposed?.tees?.length || 0) === 1 ? "" : "s"} · {proposed?.holes?.length || 0} holes</div>
        </div>
      </div>
      <div style={{ background: C.greenLight, border: `1px solid ${C.gold}`, borderRadius: 10, padding: 10 }}>
        <div style={{ color: C.cream, fontSize: 11, letterSpacing: 1.5, fontWeight: 800, marginBottom: 6 }}>WHAT CHANGED ({lines.length})</div>
        {visible.map((line, i) => (
          <div key={i} style={{ color: C.cream, fontSize: 12, padding: "3px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>{line}</div>
        ))}
      </div>
    </div>
  );
}

export function CoursesLibrary({ user, activeGroupId }: { user: any; activeGroupId: string }) {
  const [groupCourses, setGroupCourses] = useState<LibCourse[] | null>(null);
  const [allCourses, setAllCourses] = useState<LibCourse[] | null>(null);
  const [editing, setEditing] = useState<null | "new" | { id: string; data: Course; user_id: string }>(null);
  // Persist which course is being edited so a lock/refresh reopens INTO the editor (the edited
  // data itself is restored by the form-draft). Cleared on cancel/save.
  const openEditor = (v: "new" | { id: string; data: Course; user_id: string }) => { saveActiveCourseEdit(v); setEditing(v); };
  React.useEffect(() => { const v = loadActiveCourseEdit<"new" | { id: string; data: Course; user_id: string }>(); if (v) setEditing(v); }, []);
  // Deliberately navigating away (tab switch / group switch) UNMOUNTS this library — clear the
  // marker so an abandoned editor doesn't hijack the next app reopen. A lock/refresh doesn't
  // unmount, so the marker still survives real interruptions (that's the resume case).
  React.useEffect(() => () => clearActiveCourseEdit(), []);
  const [isAdmin, setIsAdmin] = useState(false);
  const [tab, setTab] = useState<CourseTab>("group");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pendingEdits, setPendingEdits] = useState<CourseEditRequest[]>([]);
  const [myName, setMyName] = useState<string>("Someone");

  const toLibCourse = (f: any): LibCourse => {
    const d = f.data || {};
    return {
      id: f.id,
      name: f.name,
      location: f.location || "",
      user_id: f.user_id,
      data: {
        ...normalize(d),
        club: d?.club || f.facility || "",
        externalId: d?.externalId || f.external_id || null,
        corrected: d?.corrected || f.corrected || false,
      },
      vetted: !!f.vetted,
      group_override: !!f.group_override,
      group_override_updated_at: f.group_override_updated_at || null,
    };
  };

  const sortCourses = (rows: LibCourse[]) => rows.sort((a, b) =>
    courseCardTitle(a).localeCompare(courseCardTitle(b), undefined, { sensitivity: "base" })
  );

  const load = useCallback(async () => {
    // Your group courses are a subset of the global app library, linked by group_courses.
    try {
      const linked = await loadCoursesForGroup(supabase, activeGroupId);
      const groupList = sortCourses(linked.map(toLibCourse));
      setGroupCourses(groupList);
    } catch (e) {
      // Keep the last good list; a refresh error is not an empty library.
      console.error("course library refresh failed", e);
    }

    // Global app library: every non-deleted course saved in Birdie Num Num.
    // Any user can browse this list and add a course to their current group library.
    const { data: all, error: allErr } = await supabase.from("favorite_courses").select("*").order("name");
    if (!allErr) {
      const allList = sortCourses((all || []).filter((f: any) => !f.deleted).map(toLibCourse));
      setAllCourses(allList);
    } else {
      console.error("global course library refresh failed", allErr);
    }

    const { data: prof } = await supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle();
    const admin = !!prof?.is_admin;
    setIsAdmin(admin);
    setMyName(prof?.display_name || user.email || "Someone");

    if (admin) {
      const { data: edits } = await supabase
        .from("course_change_requests")
        .select("id, course_id, group_id, submitted_by, proposed_name, proposed_location, proposed_data, reason, change_summary, status, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      const rows = (edits || []) as CourseEditRequest[];
      const courseIds = Array.from(new Set(rows.map((r) => r.course_id).filter(Boolean)));
      const groupIds = Array.from(new Set(rows.map((r) => r.group_id).filter(Boolean)));
      const userIds = Array.from(new Set(rows.map((r) => r.submitted_by).filter(Boolean))) as string[];

      let coursesById: Record<string, LibCourse> = {};
      if (courseIds.length) {
        const { data: courses } = await supabase.from("favorite_courses").select("*").in("id", courseIds);
        coursesById = Object.fromEntries((courses || []).map((c: any) => [c.id, toLibCourse(c)]));
      }
      let groupsById: Record<string, any> = {};
      if (groupIds.length) {
        const { data: groupRows } = await supabase.from("groups").select("id, name").in("id", groupIds);
        groupsById = Object.fromEntries((groupRows || []).map((g: any) => [g.id, g]));
      }
      let profilesById: Record<string, any> = {};
      if (userIds.length) {
        const { data: profileRows } = await supabase.from("profiles").select("id, display_name, email").in("id", userIds);
        profilesById = Object.fromEntries((profileRows || []).map((p: any) => [p.id, p]));
      }

      setPendingEdits(rows.map((r) => {
        const submitter = r.submitted_by ? profilesById[r.submitted_by] : null;
        return {
          ...r,
          current_course: coursesById[r.course_id] || null,
          group_name: groupsById[r.group_id]?.name || null,
          submitter_name: submitter?.display_name || null,
          submitter_email: submitter?.email || null,
        };
      }));
    } else {
      setPendingEdits([]);
    }
  }, [user.id, activeGroupId]);
  useEffect(() => { load(); }, [load]);

  const groupCourseIds = new Set((groupCourses || []).map((c) => c.id));
  const query = search.trim().toLowerCase();
  const filteredAll = (allCourses || []).filter((c) => {
    if (!query) return true;
    return [courseCardTitle(c), c.location, c.data?.club, c.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
  const filteredGroup = (groupCourses || []).filter((c) => {
    if (!query) return true;
    return [courseCardTitle(c), c.location, c.data?.club, c.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  // App-admin marker only. All courses are now visible in the global app library;
  // the star is a quality flag, not a visibility gate.
  const toggleVetted = async (c: LibCourse) => {
    setBusyId(c.id); setMsg(null);
    const next = !c.vetted;
    await supabase.from("favorite_courses").update({ vetted: next }).eq("id", c.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: next ? "course_vetted" : "course_unvetted", summary: `${next ? "Marked" : "Unmarked"} "${courseCardTitle(c)}" as vetted` });
    setBusyId(null);
    await load();
  };

  // Admin: re-fetch facility name (and refreshed detail) from the golf course API
  // for every course that has a real canonical id, filling in the "Facility —
  // Layout" naming for courses saved before facility was captured. Skips courses
  // whose external_id isn't a real API id (e.g. hand-corrected ones).
  const [refreshing, setRefreshing] = useState(false);
  const refreshFacilities = async () => {
    if (refreshing) return;
    setRefreshing(true); setMsg(null);
    const all = [...(allCourses || [])];
    let updated = 0, skipped = 0, failed = 0;
    for (const c of all) {
      const ext = c.data?.externalId;
      const providerId = normalizeCourseProviderId(ext);
      if (!providerId) { skipped++; continue; }
      try {
        const res = await fetch(`/api/courses?id=${encodeURIComponent(providerId)}`);
        const j = await res.json();
        const fetched = j.course;
        if (!fetched || !fetched.club) { failed++; continue; }
        const newData = { ...c.data, club: fetched.club, externalId: providerId };
        const { error } = await supabase.from("favorite_courses")
          .update({ facility: fetched.club, data: newData }).eq("id", c.id);
        if (error) { failed++; continue; }
        updated++;
      } catch { failed++; }
    }
    setRefreshing(false);
    setMsg(`Refreshed ${updated} course${updated === 1 ? "" : "s"}${skipped ? ` · ${skipped} skipped (no API id)` : ""}${failed ? ` · ${failed} couldn't be fetched` : ""}.`);
    await load();
  };

  const addToMyGroup = async (c: LibCourse) => {
    setBusyId(c.id); setMsg(null);
    await linkCourseToGroup(supabase, activeGroupId, c.id, user.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_added_to_group", group_id: activeGroupId, summary: `Added course "${courseCardTitle(c)}" to the club library` });
    setBusyId(null);
    setMsg(`Added "${courseCardTitle(c)}" to your club library.`);
    await load();
    setTab("group");
  };

  // Remove a course FROM THIS GROUP only (unlink). The global record and other groups are untouched.
  const remove = async (id: string, courseName: string) => {
    await supabase.from("group_courses").delete().eq("group_id", activeGroupId).eq("course_id", id);
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_removed", group_id: activeGroupId, summary: `Removed course "${courseName}" from a club` });
    await load();
  };

  const approveCourseEdit = async (req: CourseEditRequest) => {
    if (!isAdmin) return;
    setBusyId(req.id); setMsg(null);
    try {
      const { error } = await supabase.rpc("review_course_correction", { p_request: req.id, p_action: "approved" });
      if (error) throw error;
      await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_edit_approved_global", group_id: req.group_id, summary: `Approved global course edit for "${courseLabel({ ...(req.proposed_data || {}), name: req.proposed_name })}"` });
      setMsg("Course edit approved globally. The local club override was cleared because the global record now matches it.");
      await load();
    } catch (e: any) {
      setMsg("Couldn't approve edit: " + (e.message || "error"));
    } finally {
      setBusyId(null);
    }
  };

  const keepCourseEditGroupOnly = async (req: CourseEditRequest) => {
    if (!isAdmin) return;
    setBusyId(req.id); setMsg(null);
    try {
      const { error } = await supabase.rpc("review_course_correction", { p_request: req.id, p_action: "group_only" });
      if (error) throw error;
      await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_edit_kept_group_only", group_id: req.group_id, summary: `Kept course edit for "${req.proposed_name}" in the submitting group only` });
      setMsg("Course edit kept for the submitting club only. The global course record was not changed.");
      await load();
    } catch (e: any) {
      setMsg("Couldn't keep edit club-only: " + (e.message || "error"));
    } finally {
      setBusyId(null);
    }
  };

  const rejectAndRemoveCourseEdit = async (req: CourseEditRequest) => {
    if (!isAdmin) return;
    if (!confirm(`Reject this course edit and remove the local override for ${req.group_name || "the submitting group"}?\n\nThe club will revert to the current global course data.`)) return;
    setBusyId(req.id); setMsg(null);
    try {
      const { error } = await supabase.rpc("review_course_correction", { p_request: req.id, p_action: "rejected_removed" });
      if (error) throw error;
      await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_edit_rejected_removed", group_id: req.group_id, summary: `Rejected course edit for "${req.proposed_name}" and removed the club override` });
      setMsg("Course edit rejected and the submitting club's override was removed.");
      await load();
    } catch (e: any) {
      setMsg("Couldn't reject and remove override: " + (e.message || "error"));
    } finally {
      setBusyId(null);
    }
  };

  const CourseRow = ({ c, source }: { c: LibCourse; source: "group" | "all" }) => {
    const inGroup = groupCourseIds.has(c.id);
    return (
      <div key={c.id} style={{ display: "flex", alignItems: "stretch", marginTop: 10, background: C.greenLight, borderRadius: 12, overflow: "hidden" }}>
        {isAdmin && (
          <button title={c.vetted ? "Vetted course — tap to unmark" : "Mark as vetted"}
            onClick={() => toggleVetted(c)} disabled={busyId === c.id}
            style={{ background: "none", border: "none", borderRight: "1px solid rgba(255,255,255,0.12)", color: c.vetted ? C.gold : C.sage, fontSize: 18, cursor: "pointer", padding: "0 14px" }}>
            {c.vetted ? "★" : "☆"}
          </button>
        )}
        <button onClick={() => openEditor({ id: c.id, data: c.data, user_id: c.user_id })}
          style={{ flex: 1, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "13px 16px" }}>
          <div style={{ color: C.cream, fontWeight: 700, fontSize: 15 }}>
            {courseCardTitle(c)}
            {/* APP_RULES #25: gold means "someone must act"; "vetted" is reassurance, so it is
                secondary metadata. This row is CREAM, so the secondary token is C.faint
                (5.98:1) — NOT C.sage, which is green-surface text and measures 1.83:1
                here. Change to C.sage in the same release that turns this row green. */}
            {c.vetted ? <span style={{ color: C.sage, fontSize: 12 }}> · vetted ★</span> : null}
            {c.group_override ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}> · club edit pending review</span> : c.data?.corrected ? <span style={{ color: C.sage, fontSize: 11, fontWeight: 700 }}> · ⚑ corrected</span> : null}
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>
            {c.location ? c.location + " · " : ""}{c.data.tees?.length || 0} tee{(c.data.tees?.length || 0) === 1 ? "" : "s"} · tap to view/edit{c.group_override ? " · this club sees a local correction" : ""}
          </div>
        </button>
        {source === "group" ? (
          <button title="Remove from club library"
            onClick={() => { if (confirm(`Remove "${courseCardTitle(c)}" from this club's library?\n\nThe course remains in the global app library and can be added back later.`)) remove(c.id, courseCardTitle(c)); }}
            style={{ background: "none", border: "none", borderLeft: `1px solid ${C.borderCard}`, color: C.birdie, fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px" }}>✕</button>
        ) : inGroup ? (
          <div style={{ display: "flex", alignItems: "center", borderLeft: `1px solid ${C.borderCard}`, padding: "0 14px", color: C.cream, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>In Club ✓</div>
        ) : (
          <button style={{ ...btn(true), borderRadius: 6, padding: "0 14px", fontSize: 12, opacity: busyId === c.id ? 0.5 : 1 }} disabled={busyId === c.id} onClick={() => addToMyGroup(c)}>＋ Add to Club</button>
        )}
      </div>
    );
  };

  if (editing) {
    return (
      <CourseEditor
        user={user}
        activeGroupId={activeGroupId}
        initial={editing === "new" ? null : editing.data}
        existingId={editing === "new" ? null : editing.id}
        onCancel={() => { clearActiveCourseEdit(); setEditing(null); }}
        onSaved={() => { clearActiveCourseEdit(); setEditing(null); void load(); }}
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Eyebrow>COURSE LIBRARY</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={() => openEditor("new")}>＋ Add New Course</button>
      </div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
        Browse every course saved in Birdie Num Num, then add the ones your group plays to your club library. Your group library is what appears in New Round and Create Game.
      </div>
      {isAdmin && <YardageBackfill />}

      <input
        style={{ ...inputStyle, marginTop: 12 }}
        value={search}
        placeholder="Search all courses..."
        onChange={(e) => setSearch(e.target.value)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button style={{ ...btn(tab === "group"), fontSize: 13 }} onClick={() => setTab("group")}>My Club Courses ({groupCourses?.length ?? 0})</button>
        <button style={{ ...btn(tab === "all"), fontSize: 13 }} onClick={() => setTab("all")}>All App Courses ({allCourses?.length ?? 0})</button>
        {isAdmin && (
          <button style={{ ...btn(false), fontSize: 12, opacity: refreshing ? 0.6 : 1 }} disabled={refreshing} onClick={refreshFacilities}>
            {refreshing ? "Refreshing facility names…" : "↻ Refresh facility names"}
          </button>
        )}
      </div>

      {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>{msg}</div>}

      {isAdmin && pendingEdits.length > 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 14, marginTop: 14 }}>
          <Eyebrow>PENDING GLOBAL COURSE EDITS ({pendingEdits.length})</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
            Members can correct a course for their own group immediately. Choose whether to promote the correction globally, keep it only for that group, or reject it and remove the group override.
          </div>
          {pendingEdits.map((r) => (
            <div key={r.id} style={{ background: C.greenLight, borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
              <div style={{ color: C.cream, fontWeight: 800 }}>{courseLabel(r.proposed_data || ({ name: r.proposed_name } as any))}</div>
              <div style={{ color: C.sage, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                Submitted {formatDateTime(r.created_at)}
                {r.group_name ? ` · Group: ${r.group_name}` : ""}
                {r.submitter_name || r.submitter_email ? ` · By: ${r.submitter_name || r.submitter_email}` : ""}
              </div>
              <CourseChangeSummary req={r} />
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={{ ...btn(true), fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => approveCourseEdit(r)}>Approve globally</button>
                <button style={{ ...btn(false), fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => keepCourseEditGroupOnly(r)}>Keep changes in club only</button>
                <button style={{ ...btn(false), background: C.danger, fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => rejectAndRemoveCourseEdit(r)}>Reject and remove override</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "group" && (
        <div style={{ marginTop: 16 }}>
          <Eyebrow>YOUR CLUB COURSES</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
            These courses are available to everyone in your current group when creating rounds and games.
          </div>
          {groupCourses === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
          {groupCourses !== null && filteredGroup.length === 0 && (
            <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 14, color: C.sage, textAlign: "center" }}>
              {search.trim() ? "No club courses match your search." : "No courses in this club yet. Open All App Courses and add the courses your club plays."}
            </div>
          )}
          {filteredGroup.map((c) => <CourseRow key={c.id} c={c} source="group" />)}
        </div>
      )}

      {tab === "all" && (
        <div style={{ marginTop: 16 }}>
          <Eyebrow>ALL COURSES IN BIRDIE NUM NUM</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
            This is the global course library. Add any course to your group with one tap.
          </div>
          {allCourses === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
          {allCourses !== null && filteredAll.length === 0 && (
            <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 14, color: C.sage, textAlign: "center" }}>
              {search.trim() ? "No courses match your search." : "No courses have been added yet. Add the first course from the database or enter one manually."}
            </div>
          )}
          {filteredAll.map((c) => <CourseRow key={c.id} c={c} source="all" />)}
        </div>
      )}
    </div>
  );
}

// ================= Course editor (add/edit a library course) =================
export function CourseEditor({ user, activeGroupId, initial, existingId, onCancel, onSaved }: {
  user: any; activeGroupId: string; initial: Course | null; existingId: string | null; onCancel: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "form">(initial ? "form" : "choose");
  const [course, setCourse] = useState<Course | null>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // search
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{ id: string; name: string; location: string }[] | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [providerSource, setProviderSource] = useState<CourseProviderSource | null>(null);

  // ---- Resume an interrupted course edit (device-local draft), for NEW and EXISTING courses ----
  const isNewCourse = !existingId;
  const courseDraftKey = `bnn_course_draft:${activeGroupId}:${existingId || "new"}`;
  const [courseDraft, setCourseDraft] = useState<{ savedAt: number; data: Course; providerSource: CourseProviderSource | null } | null>(null);
  const [courseDraftDismissed, setCourseDraftDismissed] = useState(false);
  const courseHydratedRef = React.useRef(false);

  useEffect(() => {
    const d = loadFormDraft<Course | { course: Course; providerSource?: CourseProviderSource | null }>(courseDraftKey);
    const payload = d?.data && "course" in d.data ? d.data : d?.data ? { course: d.data as Course, providerSource: null } : null;
    if (d && payload?.course && (payload.course.name || "").trim()) {
      if (isNewCourse) {
        setCourseDraft({ savedAt: d.savedAt, data: payload.course, providerSource: payload.providerSource || null }); // new course: offer to restore via the prompt
      } else {
        // existing course: a draft only survives an interruption (cleared on save/cancel),
        // so auto-restore the edits — that's what "bring me back to my changes" means.
        setCourse(payload.course); setProviderSource(payload.providerSource || null); setMode("form"); courseHydratedRef.current = true;
      }
    } else {
      courseHydratedRef.current = true;
    }
  }, []);

  const applyCourseDraft = (data: Course, source: CourseProviderSource | null) => {
    setCourse(data); setProviderSource(source); setMode("form");
    setCourseDraft(null); setCourseDraftDismissed(true); courseHydratedRef.current = true;
  };
  const startFreshCourse = () => {
    clearFormDraft(courseDraftKey); setCourseDraft(null); setCourseDraftDismissed(true); courseHydratedRef.current = true;
  };
  // Cancel discards the draft so a cancelled edit doesn't resurface on the next open.
  const handleCancel = () => { clearFormDraft(courseDraftKey); onCancel(); };

  // Save the in-progress course once we're editing it (new OR existing).
  useEffect(() => {
    if (!courseHydratedRef.current) return;
    if (mode === "form" && course && (course.name || "").trim()) saveFormDraft(courseDraftKey, { course, providerSource });
  }, [course, mode, providerSource]);

  const runSearch = async () => {
    if (!q.trim()) return;
    setSearching(true); setErr(null); setResults(null);
    try {
      const res = await fetch(`/api/courses?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Search failed");
      setResults(data.courses || []);
    } catch (e: any) { setErr(e.message); setResults([]); }
    finally { setSearching(false); }
  };
  const pick = async (id: string, fallbackLoc?: string) => {
    if (!courseHydratedRef.current) { courseHydratedRef.current = true; setCourseDraftDismissed(true); } // choosing a course = start fresh
    setLoadingId(id); setErr(null);
    try {
      const res = await fetch(`/api/courses?id=${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed");
      const provider = data.course as Course;
      // If the detail payload didn't include a location, keep the one shown in search.
      if (provider && !provider.location && fallbackLoc) provider.location = fallbackLoc;

      const canonicalId = await findExistingCourseId(supabase, {
        externalId: provider.externalId || id,
        club: provider.club,
        name: provider.name,
        location: provider.location || fallbackLoc || "",
      });

      if (canonicalId) {
        const { data: row, error: rowError } = await supabase
          .from("favorite_courses")
          .select("id,name,facility,location,external_id,data")
          .eq("id", canonicalId)
          .maybeSingle();
        if (rowError) throw rowError;
        if (row) {
          const storedBase = normalize(row.data || {});
          const stored: Course = {
            ...storedBase,
            id: storedBase.id || row.id,
            externalId: normalizeCourseProviderId(row.external_id) || normalizeCourseProviderId(storedBase.externalId) || normalizeCourseProviderId(provider.externalId) || id,
            club: row.facility || storedBase.club || provider.club,
            name: row.name || storedBase.name || provider.name,
            location: row.location || storedBase.location || provider.location || fallbackLoc || "",
          };
          setProviderSource({ provider, stored, existingId: canonicalId, selectedSource: "stored" });
          setCourse(stored);
          setMode("form");
          return;
        }
      }

      setProviderSource({ provider, stored: null, existingId: null, selectedSource: "provider" });
      setCourse(provider); setMode("form");
    } catch (e: any) { setErr(e.message); }
    finally { setLoadingId(null); }
  };
  const startManual = () => {
    if (!courseHydratedRef.current) { courseHydratedRef.current = true; setCourseDraftDismissed(true); }
    setCourse(buildCustomCourse("New course", "", 72, 72, 113));
    setMode("form");
  };

  if (mode === "choose") {
    return (
      <div style={{ maxWidth: 600 }}>
        <Eyebrow>ADD A COURSE</Eyebrow>
        {courseDraft && !courseDraftDismissed && isNewCourse && (
          <div style={{ marginTop: 12, background: C.greenLight, border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>Resume your course?</div>
            <div style={{ color: C.sage, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
              You left {courseDraft.data.name ? `"${courseDraft.data.name}"` : "a course"} unfinished {draftAgeLabel(courseDraft.savedAt)}. Pick up where you left off, or start fresh.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => applyCourseDraft(courseDraft.data, courseDraft.providerSource)} style={{ ...btn(true), fontSize: 13 }}>Resume</button>
              <button onClick={startFreshCourse} style={{ ...btn(false), fontSize: 13 }}>Start fresh</button>
            </div>
          </div>
        )}
        <div style={{ marginTop: 12 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Search the database (≈30,000 courses)</label>
          <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
            <input style={inputStyle} value={q} placeholder="Course name…" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} />
            <button style={{ ...btn(true), whiteSpace: "nowrap", opacity: q.trim() ? 1 : 0.5 }} disabled={!q.trim() || searching} onClick={runSearch}>{searching ? "…" : "Search"}</button>
          </div>
        </div>
        {err && <div style={{ color: C.overRedDark, fontSize: 13, marginTop: 8 }}>{err}</div>}
        {results?.map((r) => (
          <button key={r.id} onClick={() => pick(r.id, r.location)} disabled={loadingId != null}
            style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, cursor: "pointer", background: C.greenLight, border: `1px solid ${C.borderCard}`, borderRadius: 10, padding: "12px 14px" }}>
            <span style={{ color: C.cream, fontWeight: 700 }}>{r.name}</span>
            {r.location ? <span style={{ color: C.sage, fontSize: 13 }}> · {r.location}</span> : null}
            {loadingId === r.id ? <span style={{ color: C.gold, fontSize: 12 }}> · loading…</span> : null}
          </button>
        ))}
        {results && results.length === 0 && !err && <div style={{ color: C.sage, fontSize: 13, marginTop: 8 }}>No matches.</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={btn(false)} onClick={handleCancel}>Cancel</button>
          <button style={btn(false)} onClick={startManual}>Enter manually instead</button>
        </div>
      </div>
    );
  }

  if (!course) return null;
  return <CourseForm user={user} activeGroupId={activeGroupId} course={course} setCourse={setCourse} existingId={existingId} providerSource={providerSource} setProviderSource={setProviderSource} saving={saving} setSaving={setSaving} err={err} setErr={setErr} onCancel={handleCancel} onSaved={() => { clearFormDraft(courseDraftKey); onSaved(); }} />;
}

export function CourseForm({ user, activeGroupId, course, setCourse, existingId, providerSource, setProviderSource, saving, setSaving, err, setErr, onCancel, onSaved }: {
  user: any; activeGroupId: string; course: Course; setCourse: (c: Course) => void; existingId: string | null;
  providerSource?: CourseProviderSource | null; setProviderSource: (source: CourseProviderSource | null) => void;
  saving: boolean; setSaving: (b: boolean) => void; err: string | null; setErr: (s: string | null) => void;
  onCancel: () => void; onSaved: () => void;
}) {
  const coursePar = course.holes.reduce((s, h) => s + (h.par || 0), 0);

  // Keep rating fields as raw text while editing so a typed decimal point survives.
  const [ratingTexts, setRatingTexts] = useState<Record<number, string>>(() => buildCourseRatingTexts(course));

  const [reason, setReason] = useState("");
  const initialCourseRef = React.useRef<Course>(JSON.parse(JSON.stringify(course)));

  const setName = (name: string) => setCourse({ ...course, name });
  const setLoc = (location: string) => setCourse({ ...course, location });
  const updateTee = (i: number, patch: any) => setCourse({ ...course, tees: course.tees.map((t, j) => j === i ? { ...t, ...patch } : t) });
  const setRating = (i: number, raw: string) => {
    if (raw !== "" && !/^\d*\.?\d*$/.test(raw)) return;
    setRatingTexts((m) => ({ ...m, [i]: raw }));
    const n = parseFloat(raw);
    updateTee(i, { rating: isNaN(n) ? 0 : n });
  };
  const addTee = () => {
    const idx = course.tees.length;
    setRatingTexts((m) => ({ ...m, [idx]: "72" }));
    setCourse({ ...course, tees: [...course.tees, { name: "New tee", rating: 72, slope: 113, par: coursePar }] });
  };
  const removeTee = (i: number) => setCourse({ ...course, tees: course.tees.filter((_, j) => j !== i) });
  const updateHole = (i: number, patch: Partial<CourseHole>) => setCourse({ ...course, holes: course.holes.map((h, j) => j === i ? { ...h, ...patch } : h) });
  const [yardTee, setYardTee] = useState<number | null>(null); // which tee's per-hole yardages are open
  const sourceMode: CourseSourceMode = providerSource?.selectedSource || (providerSource?.stored ? "stored" : "provider");
  const providerReviewHasChanges = Boolean(providerSource?.stored && sourceMode === "provider" && hasMaterialCourseChanges(providerSource.stored, course));
  const showCorrectionReason = shouldShowCourseCorrectionReason({
    existingId,
    hasStoredProviderSource: Boolean(providerSource?.stored),
    sourceMode,
    hasMaterialChanges: providerReviewHasChanges,
  });
  const switchCourseSource = (mode: CourseSourceMode, sourceCourse: Course) => {
    const next = buildCourseSourceView(mode, sourceCourse);
    setCourse(next.course);
    setRatingTexts(next.ratingTexts);
    setYardTee(null);
    if (providerSource) setProviderSource({ ...providerSource, selectedSource: mode });
  };
  const updateTeeYardage = (ti: number, hi: number, val: string) => {
    const n = course.holes.length;
    const cur = course.tees[ti].yardages || [];
    const arr: (number | null)[] = Array.from({ length: n }, (_, k) => cur[k] ?? null);
    arr[hi] = val.trim() === "" ? null : (parseInt(val, 10) || null);
    updateTee(ti, { yardages: arr });
  };

  const save = async () => {
    if (!course.name.trim()) { setErr("Give the course a name."); return; }
    // A reason is required only when actual course data changed.
    // Merely opening/viewing an existing course and saving/linking it to the group
    // should not block the user with a reason requirement.
    const siErr = validateStrokeIndexes(course.holes.map((h) => ({ n: h.n, si: h.si })));
    if (siErr) { setErr("Can't save — " + siErr); return; }
    setSaving(true); setErr(null);
    try {
      const name = course.name.trim();
      if (existingId) {
        // If the golfer only opened the course detail/editor and did not change
        // anything, just keep/link the course in this group. Do not require a
        // reason and do not create a global-review request.
        const proposedBase = { ...course, name, location: course.location || "" };
        const hasChanges = hasMaterialCourseChanges(initialCourseRef.current, proposedBase);
        if (!hasChanges) {
          await linkCourseToGroup(supabase, activeGroupId, existingId, user.id);
          await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_linked", group_id: activeGroupId, summary: `Saved course "${name}" to this club library with no course-data changes` });
          onSaved();
          return;
        }
        if (!reason.trim()) { setErr("Please explain why this course change is needed so an admin can review it."); setSaving(false); return; }

        const proposed = { ...proposedBase, corrected: true };
        const { data: currentRow } = await supabase.from("favorite_courses").select("data").eq("id", existingId).maybeSingle();
        const { error: corrErr } = await supabase.rpc("submit_course_correction", {
          p_group: activeGroupId, p_course: existingId, p_name: name, p_location: course.location || "", p_data: proposed,
          p_reason: reason.trim(), p_change_summary: buildCourseChangeSummary((currentRow?.data as any) || initialCourseRef.current, proposed),
        });
        if (corrErr) throw corrErr;
        await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_edit_submitted", group_id: activeGroupId, summary: `Edited course "${name}" for this club and submitted it for global review` });
      } else {
        // New course: if a canonical record with this name already exists, link it and
        // store this group's version as an override; otherwise create the global record.
        let courseId = await findExistingCourseId(supabase, { externalId: course.externalId, club: course.club, name, location: course.location || "" });
        if (courseId) {
          const { data: currentRow } = await supabase.from("favorite_courses").select("data").eq("id", courseId).maybeSingle();
          const proposedBase = { ...course, name, location: course.location || "" };
          const currentData = (currentRow?.data as any) || proposedBase;
          const hasChanges = hasMaterialCourseChanges(currentData, proposedBase);
          if (hasChanges) {
            if (!reason.trim()) { setErr("Please explain why this course change is needed so an admin can review it."); setSaving(false); return; }
            const proposed = { ...proposedBase, corrected: true };
            const { error: corrErr } = await supabase.rpc("submit_course_correction", {
              p_group: activeGroupId, p_course: courseId, p_name: name, p_location: course.location || "", p_data: proposed,
              p_reason: reason.trim(), p_change_summary: buildCourseChangeSummary(currentData, proposed),
            });
            if (corrErr) throw corrErr;
          } else {
            await linkCourseToGroup(supabase, activeGroupId, courseId, user.id);
          }
        } else {
          const createdCourse = { ...course, name, location: course.location || "" };
          const { data: created, error } = await supabase.from("favorite_courses")
            .insert({
              group_id: activeGroupId,
              name,
              facility: course.club || null,
              external_id: normalizeCourseProviderId(course.externalId),
              location: course.location || "",
              data: createdCourse,
              user_id: user.id,
            })
            .select("id").single();
          if (error || !created) throw error || new Error("Could not create course");
          courseId = created.id;
          await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_created", group_id: activeGroupId, summary: `Created course "${name}"` });
        }
        await linkCourseToGroup(supabase, activeGroupId, courseId!, user.id);
      }
      onSaved();
    } catch (e: any) { setErr(e.message || "Save failed."); setSaving(false); }
  };

  return (
    <div style={{ maxWidth: 700 }}>
      <Eyebrow>{existingId ? "EDIT COURSE FOR THIS CLUB" : "NEW COURSE"}</Eyebrow>
      {existingId && (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8, lineHeight: 1.5 }}>
          Changes save immediately for this group and are submitted to an app admin for global approval before other groups see them.
        </div>
      )}
      {!existingId && providerSource && (
        <div style={{ marginTop: 10, border: `1px solid ${providerSource.stored ? C.gold : C.borderCard}`, borderRadius: 10, padding: 10, background: providerSource.stored ? C.greenMid : C.greenLight }}>
          <div style={{ color: providerSource.stored ? C.cream : C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1.2 }}>
            {providerSource.stored ? (sourceMode === "provider" ? "REVIEWING GOLFCOURSEAPI DATA" : "ALREADY IN BNN") : "NEW COURSE FROM GOLFCOURSEAPI"}
          </div>
          {providerSource.stored ? (
            <>
              <div style={{ color: C.cream, fontSize: 13, marginTop: 5, lineHeight: 1.45 }}>
                {sourceMode === "provider" ? (
                  <>You are reviewing the <b>latest GolfCourseAPI data</b>. Nothing will overwrite stored BNN data unless you explicitly save a reviewed correction.</>
                ) : (
                  <>You are viewing the <b>stored BNN course data</b>. The latest provider data was fetched separately and will not overwrite BNN automatically.</>
                )}
              </div>
              {hasMaterialCourseChanges(providerSource.stored, providerSource.provider) ? (
                <div style={{ marginTop: 8 }}>
                  <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.45 }}>
                    Provider differences detected: {courseChangeLines(providerSource.stored, providerSource.provider).slice(0, 4).join("; ")}
                  </div>
                  {sourceMode === "stored" ? (
                    <button type="button" style={{ ...btn(false), marginTop: 8, fontSize: 12 }} onClick={() => switchCourseSource("provider", providerSource.provider)}>
                      Load provider data for review
                    </button>
                  ) : (
                    <button type="button" style={{ ...btn(false), marginTop: 8, fontSize: 12 }} onClick={() => switchCourseSource("stored", providerSource.stored!)}>
                      Return to stored BNN data
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>The provider data currently matches the stored BNN course.</div>
              )}
            </>
          ) : (
            <div style={{ color: C.cream, fontSize: 13, marginTop: 5 }}>This provider course is not currently stored in BNN.</div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Course name</label>
          <input style={{ ...inputStyle, marginTop: 4 }} value={course.name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Town, State</label>
          <input style={{ ...inputStyle, marginTop: 4 }} value={course.location} placeholder="e.g. Livingston, NJ" onChange={(e) => setLoc(e.target.value)} />
        </div>
      </div>

      {/* Tees */}
      <div style={{ marginTop: 16 }}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Tees (rating &amp; slope differ per tee)</label>
          <div style={{ flex: 1 }} />
          <button style={{ ...btn(false), fontSize: 12, padding: "6px 12px" }} onClick={addTee}>＋ add tee</button>
        </div>
        {course.tees.map((t, i) => {
          const yd = (t.yardages || []).reduce((sum: number, v) => sum + (v || 0), 0);
          return (
          <React.Fragment key={i}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8, background: C.greenLight, borderRadius: 10, padding: 10 }}>
            <div style={{ flex: 2, minWidth: 120 }}>
              <label style={{ color: C.sage, fontSize: 11 }}>Name</label>
              <input style={{ ...inputStyle, marginTop: 2 }} value={t.name} onChange={(e) => updateTee(i, { name: e.target.value })} />
            </div>
            <div style={{ flex: 1, minWidth: 80 }}>
              <label style={{ color: C.sage, fontSize: 11 }}>Rating</label>
              <input style={{ ...inputStyle, marginTop: 2 }} inputMode="decimal" placeholder="72.1"
                value={ratingTexts[i] ?? ""} onChange={(e) => setRating(i, e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 80 }}>
              <label style={{ color: C.sage, fontSize: 11 }}>Slope</label>
              <input style={{ ...inputStyle, marginTop: 2 }} inputMode="numeric" placeholder="130"
                value={t.slope ?? ""} onChange={(e) => updateTee(i, { slope: e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0 })} />
            </div>
            <div style={{ flex: 1, minWidth: 90 }}>
              <label style={{ color: C.sage, fontSize: 11 }}>Yards</label>
              <button type="button" onClick={() => setYardTee(yardTee === i ? null : i)}
                title={yd > 0 ? "Total yardage for this tee — tap to edit per hole" : "Tap to enter per-hole yardages"}
                style={{ marginTop: 4, width: "100%", background: "#173a2c", border: `1px solid #37624f`, borderRadius: 8, padding: "6px 8px", color: yd > 0 ? C.cream : C.sage, fontSize: 13, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>
                {yd > 0 ? yd.toLocaleString() : "Add"} <span style={{ color: C.sage, fontSize: 11, fontWeight: 500 }}>{yardTee === i ? "· close" : "· edit"}</span>
              </button>
            </div>
            {course.tees.length > 1 && (
              <button onClick={() => removeTee(i)} style={{ background: "none", border: "none", color: C.birdie, cursor: "pointer", fontWeight: 800, padding: "10px 6px" }}>✕</button>
            )}
          </div>
          {yardTee === i && (
            <div style={{ background: C.card, borderRadius: 10, padding: 12, marginTop: 6 }}>
              <div style={{ color: C.faint, fontSize: 11, marginBottom: 8 }}>Per-hole yardages for <b style={{ color: C.ink }}>{t.name}</b> — leave a hole blank if you don't know it.</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))", gap: 6 }}>
                {course.holes.map((h, hi) => (
                  <div key={hi} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: C.faint, fontSize: 11, fontWeight: 700, width: 20, textAlign: "right" }}>{h.n}</span>
                    <input inputMode="numeric" value={t.yardages?.[hi] ?? ""} placeholder="—"
                      onChange={(e) => updateTeeYardage(i, hi, e.target.value)}
                      style={{ ...inputStyle, padding: "5px 4px", textAlign: "center", fontSize: 13, width: "100%", minWidth: 0 }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          </React.Fragment>
        ); })}
      </div>

      {/* Par + stroke index */}
      <div style={{ marginTop: 16 }}>
        {(() => {
          const front = course.holes.slice(0, 9).reduce((s, h) => s + (h.par || 0), 0);
          const back = course.holes.slice(9, 18).reduce((s, h) => s + (h.par || 0), 0);
          return (
            <div style={{ color: C.sage, fontSize: 12, marginBottom: 6 }}>
              Par &amp; stroke index (same for all tees) · <b style={{ color: C.cream }}>Out {front}</b>
              {course.holes.length > 9 ? <> · <b style={{ color: C.cream }}>In {back}</b></> : null}
              {" · "}<b style={{ color: C.gold }}>Total {coursePar}</b>
            </div>
          );
        })()}
        {(() => {
          const nine = (from: number, to: number, label: string) => {
            const seg = course.holes.slice(from, to);
            if (seg.length === 0) return null;
            return (
              <div style={{ background: C.card, borderRadius: 10, padding: 10, flex: 1, minWidth: 240 }}>
                <div style={{ color: C.green, fontSize: 11, letterSpacing: 2, fontWeight: 800, marginBottom: 6 }}>{label}</div>
                <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, padding: "0 2px 5px", color: C.faint, fontSize: 11, letterSpacing: 1, fontWeight: 700, borderBottom: `1px solid ${C.borderCard}` }}>
                  <div>HOLE</div><div style={{ textAlign: "center" }}>PAR</div><div style={{ textAlign: "center" }}>S.I.</div>
                </div>
                {seg.map((h, jj) => {
                  const j = from + jj;
                  return (
                    <div key={j} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, alignItems: "center", padding: "5px 2px", borderBottom: `1px solid ${C.borderCard}` }}>
                      <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.n}</div>
                      <div style={{ textAlign: "center" }}>
                        <select value={h.par ?? 4} onChange={(e) => updateHole(j, { par: parseInt(e.target.value, 10) })}
                          style={{ ...inputStyle, padding: "5px 0", width: "100%", maxWidth: 70, textAlign: "center", fontSize: 14 }}>
                          {[3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </div>
                      <div style={{ textAlign: "center" }}>
                        <select value={h.si ?? ""} onChange={(e) => updateHole(j, { si: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                          style={{ ...inputStyle, padding: "5px 0", width: "100%", maxWidth: 70, textAlign: "center", fontSize: 14 }}>
                          <option value="">–</option>
                          {Array.from({ length: 18 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          };
          return (
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {nine(0, Math.min(9, course.holes.length), "FRONT NINE")}
              {course.holes.length > 9 && nine(9, 18, "BACK NINE")}
            </div>
          );
        })()}
      </div>

      {err && <div style={{ color: C.overRedDark, fontSize: 13, marginTop: 10 }}>{err}</div>}

      {showCorrectionReason && (
        <div style={{ marginTop: 16 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Reason for change <span style={{ color: C.gold }}>(required to submit changed course data for approval)</span></label>
          <textarea
            style={{ ...inputStyle, marginTop: 4, minHeight: 74, resize: "vertical" }}
            value={reason}
            placeholder="Example: The current scorecard shows hole 7 is now a par 5, and the blue tee slope was rerated to 131."
            onChange={(e) => setReason(e.target.value)}
          />
          <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>This reason is shown to app admins when they review the global course change.</div>
          {providerReviewHasChanges && (
            <div style={{ color: C.ink, fontSize: 12, marginTop: 6, lineHeight: 1.45 }}>
              Submitting will create a course correction for approval. Stored BNN data will not be silently overwritten.
            </div>
          )}
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
        <button style={{ ...btn(true), opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={save}>{saving ? "Saving…" : (providerReviewHasChanges ? "Submit for approval" : "Save to library")}</button>
      </div>
    </div>
  );
}
