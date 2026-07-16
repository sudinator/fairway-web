"use client";

import React, { useEffect, useState, useCallback } from "react";
import { HScroll } from "@/components/hscroll";
import { createClient } from "@/lib/supabase";
import { pushGate, subscribeToPush, unsubscribeFromPush, currentPermission, syncPushSubscription } from "@/lib/push";
import { C, titleCaseName, Round, Hole, strokesReceived, stablefordPts, toParStr, fmtDate, played, strokesOf, validateStrokeIndexes, dedupeHoles, TGC_GROUP_ID, effectiveGroupId } from "@/lib/golf";
import capabilities from "@/lib/capabilities.json";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, LabelList } from "recharts";
import { buildCustomCourse, Course, CourseHole, courseLabel, loadCoursesForGroup, linkCourseToGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { diagEnabled, setDiagEnabled, reproduceBug, setReproduceBug, getDiagLog, clearDiagLog } from "@/lib/debuglog";
import { AdminFeedbackTab } from "@/components/feedback";
import { btn, inputStyle, Eyebrow, NumPicker, Avatar } from "@/components/ui";
import { YardageBackfill } from "@/components/yardage-backfill";
import { AchievementsWall } from "@/components/achievements";
import { PlayerCard, PeerCardModal, CardVisibilityToggle } from "@/components/player-card";
import { resizeToAvatar } from "@/lib/image";
import { APP_VERSION } from "@/lib/app-version";
import { courseChangeLines, buildCourseChangeSummary, hasMaterialCourseChanges } from "@/lib/course-diff";
import { loadFormDraft, saveFormDraft, clearFormDraft, draftAgeLabel } from "@/lib/form-draft";
import { HelpSearch } from "@/components/help-search";
import { FeedbackForm, type FeedbackPrefill } from "@/components/feedback";

const supabase = createClient();

// Create an in-app notification for a user.
async function notify(userId: string, message: string) {
  try { await supabase.rpc("create_notification", { p_recipient: userId, p_message: message }); } catch {}
}

// "3h ago" style relative time.
function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - +new Date(iso)) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
// Relative + absolute stamp for notifications, e.g. "3h ago · Jul 13, 3:42 PM".
function notifWhen(iso: string | null): string {
  if (!iso) return "";
  return `${timeAgo(iso)} · ${new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
}

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

function courseCardTitle(c: LibCourse) {
  return courseLabel(c.data || ({ name: c.name } as any));
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Unknown time";
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

function CourseChangeSummary({ req }: { req: CourseEditRequest }) {
  const current = req.current_course?.data || null;
  const proposed = req.proposed_data || null;
  const lines = courseChangeLines(current, proposed);
  const visible = lines;
  const extra = 0;
  const submitter = req.submitter_name || req.submitter_email || "Unknown user";

  return (
    <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
      <div style={{ background: "#F7F3E8", borderRadius: 10, padding: 10, border: `1px solid ${C.line}` }}>
        <div style={{ color: C.green, fontSize: 11, letterSpacing: 1.5, fontWeight: 800, marginBottom: 6 }}>SUBMISSION DETAILS</div>
        <div style={{ color: C.ink, fontSize: 13, lineHeight: 1.6 }}>
          <div><b>Submitted by:</b> {submitter}</div>
          <div><b>Club:</b> {req.group_name || "Unknown club"}</div>
          <div><b>Submitted at:</b> {formatDateTime(req.created_at)}</div>
          <div><b>Reason:</b> {req.reason?.trim() || "No reason provided."}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div style={{ background: C.cream, borderRadius: 10, padding: 10, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }}>CURRENT GLOBAL</div>
          <div style={{ color: C.ink, fontWeight: 800, marginTop: 5 }}>{current ? courseLabel(current) : "Unknown course"}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{current?.location || "No location"}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{current?.tees?.length || 0} tee{(current?.tees?.length || 0) === 1 ? "" : "s"} · {current?.holes?.length || 0} holes</div>
        </div>
        <div style={{ background: C.cream, borderRadius: 10, padding: 10, border: `1px solid ${C.gold}` }}>
          <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }}>PROPOSED GLOBAL</div>
          <div style={{ color: C.ink, fontWeight: 800, marginTop: 5 }}>{proposed ? courseLabel(proposed) : req.proposed_name}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{proposed?.location || req.proposed_location || "No location"}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{proposed?.tees?.length || 0} tee{(proposed?.tees?.length || 0) === 1 ? "" : "s"} · {proposed?.holes?.length || 0} holes</div>
        </div>
      </div>
      <div style={{ background: "#FFF8E1", border: `1px solid ${C.gold}`, borderRadius: 10, padding: 10 }}>
        <div style={{ color: C.green, fontSize: 11, letterSpacing: 1.5, fontWeight: 800, marginBottom: 6 }}>WHAT CHANGED ({lines.length})</div>
        {visible.map((line, i) => (
          <div key={i} style={{ color: C.ink, fontSize: 12, padding: "3px 0", borderTop: i === 0 ? "none" : `1px solid ${C.line}` }}>{line}</div>
        ))}
      </div>
    </div>
  );
}

export function CoursesLibrary({ user, activeGroupId }: { user: any; activeGroupId: string }) {
  const [groupCourses, setGroupCourses] = useState<LibCourse[] | null>(null);
  const [allCourses, setAllCourses] = useState<LibCourse[] | null>(null);
  const [editing, setEditing] = useState<null | "new" | { id: string; data: Course; user_id: string }>(null);
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
    const linked = await loadCoursesForGroup(supabase, activeGroupId);
    const groupList = sortCourses(linked.map(toLibCourse));
    setGroupCourses(groupList);

    // Global app library: every non-deleted course saved in Birdie Num Num.
    // Any user can browse this list and add a course to their current group library.
    const { data: all } = await supabase.from("favorite_courses").select("*").order("name");
    const allList = sortCourses((all || []).filter((f: any) => !f.deleted).map(toLibCourse));
    setAllCourses(allList);

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
      if (!ext || !/^\d+$/.test(String(ext))) { skipped++; continue; }
      try {
        const res = await fetch(`/api/courses?id=${encodeURIComponent(String(ext))}`);
        const j = await res.json();
        const fetched = j.course;
        if (!fetched || !fetched.club) { failed++; continue; }
        const newData = { ...c.data, club: fetched.club, externalId: String(ext) };
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
      const proposed = { ...req.proposed_data, name: req.proposed_name, location: req.proposed_location || "", corrected: true };
      const { error } = await supabase.from("favorite_courses")
        .update({ name: req.proposed_name, location: req.proposed_location || "", data: proposed, vetted: true })
        .eq("id", req.course_id);
      if (error) throw error;
      await supabase.from("course_change_requests")
        .update({ status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", req.id);
      // Once the global record matches the proposal, the submitting group's local
      // override is no longer needed. Removing it prevents duplicate/confusing state.
      await supabase.from("group_course_overrides")
        .delete()
        .eq("group_id", req.group_id)
        .eq("course_id", req.course_id);
      await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_edit_approved_global", group_id: req.group_id, summary: `Approved global course edit for "${courseLabel(proposed)}"` });
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
      const { error } = await supabase.from("course_change_requests")
        .update({ status: "group_only", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", req.id);
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
      const { error: delErr } = await supabase.from("group_course_overrides")
        .delete()
        .eq("group_id", req.group_id)
        .eq("course_id", req.course_id);
      if (delErr) throw delErr;
      const { error } = await supabase.from("course_change_requests")
        .update({ status: "rejected_removed", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
        .eq("id", req.id);
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

  if (editing) {
    return <CourseEditor
      user={user}
      activeGroupId={activeGroupId}
      initial={editing === "new" ? null : editing.data}
      existingId={editing === "new" ? null : editing.id}
      onCancel={() => setEditing(null)}
      onSaved={async () => { setEditing(null); await load(); setTab("group"); }}
    />;
  }

  const CourseRow = ({ c, source }: { c: LibCourse; source: "group" | "all" }) => {
    const inGroup = groupCourseIds.has(c.id);
    return (
      <div key={c.id} style={{ display: "flex", alignItems: "stretch", marginTop: 10, background: C.card, borderRadius: 12, overflow: "hidden" }}>
        {isAdmin && (
          <button title={c.vetted ? "Vetted course — tap to unmark" : "Mark as vetted"}
            onClick={() => toggleVetted(c)} disabled={busyId === c.id}
            style={{ background: "none", border: "none", borderRight: `1px solid ${C.line}`, color: c.vetted ? C.gold : C.faint, fontSize: 18, cursor: "pointer", padding: "0 14px" }}>
            {c.vetted ? "★" : "☆"}
          </button>
        )}
        <button onClick={() => setEditing({ id: c.id, data: c.data, user_id: c.user_id })}
          style={{ flex: 1, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "13px 16px" }}>
          <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>
            {courseCardTitle(c)}
            {c.vetted ? <span style={{ color: C.gold, fontSize: 12 }}> · vetted ★</span> : null}
            {c.group_override ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}> · club edit pending review</span> : c.data?.corrected ? <span style={{ color: C.sage, fontSize: 11, fontWeight: 700 }}> · ⚑ corrected</span> : null}
          </div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
            {c.location ? c.location + " · " : ""}{c.data.tees?.length || 0} tee{(c.data.tees?.length || 0) === 1 ? "" : "s"} · tap to view/edit{c.group_override ? " · this club sees a local correction" : ""}
          </div>
        </button>
        {source === "group" ? (
          <button title="Remove from club library"
            onClick={() => { if (confirm(`Remove "${courseCardTitle(c)}" from this club's library?\n\nThe course remains in the global app library and can be added back later.`)) remove(c.id, courseCardTitle(c)); }}
            style={{ background: "none", border: "none", borderLeft: `1px solid ${C.line}`, color: C.birdie, fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px" }}>✕</button>
        ) : inGroup ? (
          <div style={{ display: "flex", alignItems: "center", borderLeft: `1px solid ${C.line}`, padding: "0 14px", color: C.green, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>In Club ✓</div>
        ) : (
          <button style={{ ...btn(true), borderRadius: 0, padding: "0 14px", fontSize: 12, opacity: busyId === c.id ? 0.5 : 1 }} disabled={busyId === c.id} onClick={() => addToMyGroup(c)}>＋ Add to Club</button>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Eyebrow>COURSE LIBRARY</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={() => setEditing("new")}>＋ Add New Course</button>
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
            <div key={r.id} style={{ background: C.card, borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
              <div style={{ color: C.ink, fontWeight: 800 }}>{courseLabel(r.proposed_data || ({ name: r.proposed_name } as any))}</div>
              <div style={{ color: C.faint, fontSize: 12, marginTop: 3, lineHeight: 1.5 }}>
                Submitted {formatDateTime(r.created_at)}
                {r.group_name ? ` · Group: ${r.group_name}` : ""}
                {r.submitter_name || r.submitter_email ? ` · By: ${r.submitter_name || r.submitter_email}` : ""}
              </div>
              <CourseChangeSummary req={r} />
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button style={{ ...btn(true), fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => approveCourseEdit(r)}>Approve globally</button>
                <button style={{ ...btn(false), fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => keepCourseEditGroupOnly(r)}>Keep changes in club only</button>
                <button style={{ ...btn(false), background: "#7A2F28", fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => rejectAndRemoveCourseEdit(r)}>Reject and remove override</button>
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
function CourseEditor({ user, activeGroupId, initial, existingId, onCancel, onSaved }: {
  user: any; activeGroupId: string; initial: Course | null; existingId: string | null; onCancel: () => void; onSaved: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "form">(initial ? "form" : "choose");
  const [course, setCourse] = useState<Course | null>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // search
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<{ id: number; name: string; location: string }[] | null>(null);
  const [loadingId, setLoadingId] = useState<number | null>(null);

  // ---- Resume an interrupted NEW course (device-local draft) ----
  const isNewCourse = !existingId;
  const courseDraftKey = `bnn_course_draft:${activeGroupId}`;
  const [courseDraft, setCourseDraft] = useState<{ savedAt: number; data: Course } | null>(null);
  const [courseDraftDismissed, setCourseDraftDismissed] = useState(false);
  const courseHydratedRef = React.useRef(false);

  useEffect(() => {
    if (!isNewCourse) { courseHydratedRef.current = true; return; }
    const d = loadFormDraft<Course>(courseDraftKey);
    if (d && d.data && (d.data.name || "").trim()) setCourseDraft(d);
    else courseHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyCourseDraft = (data: Course) => {
    setCourse(data); setMode("form");
    setCourseDraft(null); setCourseDraftDismissed(true); courseHydratedRef.current = true;
  };
  const startFreshCourse = () => {
    clearFormDraft(courseDraftKey); setCourseDraft(null); setCourseDraftDismissed(true); courseHydratedRef.current = true;
  };

  // Save the in-progress course once we're editing it (new courses only).
  useEffect(() => {
    if (!isNewCourse || !courseHydratedRef.current) return;
    if (mode === "form" && course && (course.name || "").trim()) saveFormDraft(courseDraftKey, course);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course, mode]);

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
  const pick = async (id: number, fallbackLoc?: string) => {
    if (!courseHydratedRef.current) { courseHydratedRef.current = true; setCourseDraftDismissed(true); } // choosing a course = start fresh
    setLoadingId(id); setErr(null);
    try {
      const res = await fetch(`/api/courses?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed");
      const c = data.course;
      // If the detail payload didn't include a location, keep the one shown in search.
      if (c && !c.location && fallbackLoc) c.location = fallbackLoc;
      setCourse(c); setMode("form");
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
          <div style={{ marginTop: 12, background: "#faf6ea", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ color: C.ink, fontSize: 13, fontWeight: 700 }}>Resume your course?</div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
              You left {courseDraft.data.name ? `"${courseDraft.data.name}"` : "a course"} unfinished {draftAgeLabel(courseDraft.savedAt)}. Pick up where you left off, or start fresh.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <button onClick={() => applyCourseDraft(courseDraft.data)} style={{ ...btn(true), fontSize: 13 }}>Resume</button>
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
        {err && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 8 }}>{err}</div>}
        {results?.map((r) => (
          <button key={r.id} onClick={() => pick(r.id, r.location)} disabled={loadingId != null}
            style={{ display: "block", width: "100%", textAlign: "left", marginTop: 8, cursor: "pointer", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "12px 14px" }}>
            <span style={{ color: C.ink, fontWeight: 700 }}>{r.name}</span>
            {r.location ? <span style={{ color: C.faint, fontSize: 13 }}> · {r.location}</span> : null}
            {loadingId === r.id ? <span style={{ color: C.gold, fontSize: 12 }}> · loading…</span> : null}
          </button>
        ))}
        {results && results.length === 0 && !err && <div style={{ color: C.sage, fontSize: 13, marginTop: 8 }}>No matches.</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
          <button style={btn(false)} onClick={onCancel}>Cancel</button>
          <button style={btn(false)} onClick={startManual}>Enter manually instead</button>
        </div>
      </div>
    );
  }

  if (!course) return null;
  return <CourseForm user={user} activeGroupId={activeGroupId} course={course} setCourse={setCourse} existingId={existingId} saving={saving} setSaving={setSaving} err={err} setErr={setErr} onCancel={onCancel} onSaved={() => { clearFormDraft(courseDraftKey); onSaved(); }} />;
}

function CourseForm({ user, activeGroupId, course, setCourse, existingId, saving, setSaving, err, setErr, onCancel, onSaved }: {
  user: any; activeGroupId: string; course: Course; setCourse: (c: Course) => void; existingId: string | null;
  saving: boolean; setSaving: (b: boolean) => void; err: string | null; setErr: (s: string | null) => void;
  onCancel: () => void; onSaved: () => void;
}) {
  const coursePar = course.holes.reduce((s, h) => s + (h.par || 0), 0);

  // Keep rating fields as raw text while editing so a typed decimal point survives.
  const [ratingTexts, setRatingTexts] = useState<Record<number, string>>(() => {
    const m: Record<number, string> = {};
    course.tees.forEach((t, i) => { m[i] = t.rating != null && !isNaN(t.rating) ? String(t.rating) : ""; });
    return m;
  });

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
        await linkCourseToGroup(supabase, activeGroupId, existingId, user.id);
        if (!hasChanges) {
          await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_linked", group_id: activeGroupId, summary: `Saved course "${name}" to this club library with no course-data changes` });
          onSaved();
          return;
        }
        if (!reason.trim()) { setErr("Please explain why this course change is needed so an admin can review it."); setSaving(false); return; }

        // Editing an existing global course creates a GROUP-SPECIFIC override immediately
        // and submits a pending global change request for app-admin review. It does not
        // overwrite the global record for every group.
        const proposed = { ...proposedBase, corrected: true };
        const { error: overrideErr } = await supabase.from("group_course_overrides").upsert({
          group_id: activeGroupId,
          course_id: existingId,
          name,
          location: course.location || "",
          data: proposed,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "group_id,course_id" });
        if (overrideErr) throw overrideErr;

        const { data: currentRow } = await supabase.from("favorite_courses").select("data").eq("id", existingId).maybeSingle();
        await supabase.from("course_change_requests").insert({
          course_id: existingId,
          group_id: activeGroupId,
          submitted_by: user.id,
          proposed_name: name,
          proposed_location: course.location || "",
          proposed_data: proposed,
          reason: reason.trim(),
          change_summary: buildCourseChangeSummary((currentRow?.data as any) || initialCourseRef.current, proposed),
          status: "pending",
        });
        await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_edit_submitted", group_id: activeGroupId, summary: `Edited course "${name}" for this club and submitted it for global review` });
      } else {
        // New course: if a canonical record with this name already exists, link it and
        // store this group's version as an override; otherwise create the global record.
        const { data: existsByName } = await supabase.from("favorite_courses").select("id").eq("name", name).maybeSingle();
        let courseId = existsByName?.id as string | undefined;
        if (courseId) {
          await linkCourseToGroup(supabase, activeGroupId, courseId, user.id);
          const { data: currentRow } = await supabase.from("favorite_courses").select("data").eq("id", courseId).maybeSingle();
          const proposedBase = { ...course, name, location: course.location || "" };
          const currentData = (currentRow?.data as any) || proposedBase;
          const hasChanges = hasMaterialCourseChanges(currentData, proposedBase);
          if (hasChanges) {
            if (!reason.trim()) { setErr("Please explain why this course change is needed so an admin can review it."); setSaving(false); return; }
            const proposed = { ...proposedBase, corrected: true };
            const { error: overrideErr } = await supabase.from("group_course_overrides").upsert({
              group_id: activeGroupId, course_id: courseId, name, location: course.location || "", data: proposed, updated_by: user.id, updated_at: new Date().toISOString(),
            }, { onConflict: "group_id,course_id" });
            if (overrideErr) throw overrideErr;
            await supabase.from("course_change_requests").insert({
              course_id: courseId, group_id: activeGroupId, submitted_by: user.id, proposed_name: name, proposed_location: course.location || "", proposed_data: proposed,
              reason: reason.trim(),
              change_summary: buildCourseChangeSummary(currentData, proposed),
              status: "pending",
            });
          }
        } else {
          const createdCourse = { ...course, name, location: course.location || "" };
          const { data: created, error } = await supabase.from("favorite_courses")
            .insert({ group_id: activeGroupId, name, location: course.location || "", data: createdCourse, user_id: user.id })
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
                {yd > 0 ? yd.toLocaleString() : "Add"} <span style={{ color: C.sage, fontSize: 11, fontWeight: 600 }}>{yardTee === i ? "· close" : "· edit"}</span>
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
                <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, padding: "0 2px 5px", color: C.faint, fontSize: 11, letterSpacing: 1, fontWeight: 700, borderBottom: `1px solid ${C.line}` }}>
                  <div>HOLE</div><div style={{ textAlign: "center" }}>PAR</div><div style={{ textAlign: "center" }}>S.I.</div>
                </div>
                {seg.map((h, jj) => {
                  const j = from + jj;
                  return (
                    <div key={j} style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, alignItems: "center", padding: "5px 2px", borderBottom: `1px solid ${C.line}` }}>
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

      {err && <div style={{ color: "#E8A199", fontSize: 13, marginTop: 10 }}>{err}</div>}

      {existingId && (
        <div style={{ marginTop: 16 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Reason for change <span style={{ color: C.gold }}>(required only if you changed course data)</span></label>
          <textarea
            style={{ ...inputStyle, marginTop: 4, minHeight: 74, resize: "vertical" }}
            value={reason}
            placeholder="Example: The current scorecard shows hole 7 is now a par 5, and the blue tee slope was rerated to 131."
            onChange={(e) => setReason(e.target.value)}
          />
          <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>This reason is shown to app admins when they review the global course change.</div>
        </div>
      )}
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button style={btn(false)} onClick={onCancel}>Cancel</button>
        <button style={{ ...btn(true), opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save to library"}</button>
      </div>
    </div>
  );
}

// ================= Push notifications opt-in =================
// Per-type notification preferences. Keys + defaults must match the sender route
// (app/api/push/route.ts DEFAULT_DELIVERY). Only the first three are wired to real
// events today; the rest are shown so the choice persists as those events get added.
const NOTIF_TYPES: { key: string; label: string; def: "push" | "inapp" | "off"; live: boolean }[] = [
  { key: "game_added", label: "You're added to a game", def: "push", live: true },
  { key: "money_owed", label: "You owe money", def: "push", live: true },
  { key: "money_paid", label: "You get paid / settled", def: "push", live: true },
  { key: "tee_reminder", label: "Tee-time reminders", def: "push", live: true },
  { key: "tee_new", label: "New tee time posted", def: "inapp", live: true },
  { key: "bet_posted", label: "A bet is posted in your game", def: "inapp", live: true },
  { key: "game_finished", label: "Game finished / results", def: "inapp", live: true },
  { key: "group_member", label: "New member joins your club", def: "inapp", live: true },
];

function PushToggle({ user, profile }: { user: any; profile: any }) {
  const [gate, setGate] = useState<ReturnType<typeof pushGate> | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Record<string, string>>((profile?.push_prefs as Record<string, string>) || {});
  useEffect(() => {
    const g = pushGate(); setGate(g);
    // Reflect the true server state: on = a live browser subscription that's actually saved.
    // syncPushSubscription re-saves it (healing a rotated endpoint) and reports enrollment,
    // so the toggle can't show a false "on" when the server has no row for this device.
    if (g === "ready" && user?.id) syncPushSubscription(user.id).then(setOn);
    else setOn(false);
  }, [user?.id]);
  useEffect(() => { setPrefs((profile?.push_prefs as Record<string, string>) || {}); }, [profile?.push_prefs]);
  if (gate === null) return null;

  const enable = async () => {
    setBusy(true); setMsg(null);
    const r = await subscribeToPush(user.id);
    setBusy(false);
    if (r.ok) { setOn(true); setMsg("Notifications are on for this device."); return; }
    if (r.reason === "denied") setMsg(currentPermission() === "denied"
      ? "Notifications are blocked in your device/browser settings — enable them for Birdie Num Num there, then try again."
      : "Permission wasn't granted.");
    else if (r.reason === "unsupported") setMsg("This device can't receive web push. On iPhone, install to the Home Screen from Safari first.");
    else if (r.reason === "unconfigured") setMsg("Push isn't configured on the server yet.");
    else setMsg("Couldn't turn on notifications — please try again.");
  };
  const disable = async () => { setBusy(true); await unsubscribeFromPush(); setOn(false); setBusy(false); setMsg("Notifications are off for this device."); };

  const setPref = async (key: string, val: "push" | "inapp" | "off") => {
    const next = { ...prefs, [key]: val };
    setPrefs(next);
    try { await supabase.from("profiles").update({ push_prefs: next }).eq("id", user.id); } catch { /* ignore */ }
  };
  const seg = (key: string, def: string) => {
    const cur = prefs[key] ?? def;
    const opts: { v: "push" | "inapp" | "off"; l: string }[] = [{ v: "push", l: "Push" }, { v: "inapp", l: "In-app" }, { v: "off", l: "Off" }];
    return (
      <div style={{ display: "flex", gap: 4 }}>
        {opts.map((o) => {
          const active = cur === o.v;
          return (
            <button key={o.v} onClick={() => setPref(key, o.v)}
              style={{ padding: "4px 9px", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer",
                border: `1px solid ${active ? (o.v === "off" ? "#8B6A62" : C.gold) : C.line}`,
                background: active ? (o.v === "off" ? "#6B2F28" : C.gold) : "transparent",
                color: active ? (o.v === "off" ? "#F6DEDB" : "#16201C") : C.sage }}>
              {o.l}
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 10 }}>
      <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>🔔 Notifications</div>
      {gate === "install_ios" ? (
        <div style={{ marginTop: 6 }}>
          <div style={{ background: "#2A1512", border: `1px solid ${C.birdie}`, borderRadius: 10, padding: "10px 11px" }}>
            <div style={{ color: "#F0997B", fontSize: 12, fontWeight: 800, lineHeight: 1.4 }}>⚠️ iPhone: add to your Home Screen first, or notifications won&apos;t work</div>
            <div style={{ color: "#E8C9C2", fontSize: 12, lineHeight: 1.5, marginTop: 6 }}>
              Phone notifications only work when Birdie Num Num is installed to your Home Screen <b>from Safari</b> and opened from that icon. Opened in any browser — including Safari itself — your phone will not receive them.
            </div>
          </div>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.7, marginTop: 10 }}>
            <div>1. Open Birdie Num Num in <b>Safari</b>.</div>
            <div>2. Tap the <b>Share</b> icon (the square with an up-arrow).</div>
            <div>3. Choose <b>Add to Home Screen</b>.</div>
            <div>4. Open BNN from that new <b>Home-Screen icon</b>.</div>
            <div>5. Come back here and tap <b>Turn on notifications</b>.</div>
          </div>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>An icon added from Chrome or any other browser won&apos;t work — it must be added from Safari.</div>
        </div>
      ) : gate === "unsupported" ? (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>This browser can't receive push notifications. Try Chrome on Android/desktop, or install to the Home Screen on iPhone via Safari.</div>
      ) : gate === "unconfigured" ? (
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>Notifications aren't switched on for the app yet — check back soon.</div>
      ) : (
        <>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 4 }}>
            Get a phone notification when you're added to a game, when you owe or get paid, and more — even when the app is closed.
          </div>
          <button onClick={on ? disable : enable} disabled={busy} style={{ ...btn(!on), marginTop: 10, fontSize: 13, opacity: busy ? 0.6 : 1 }}>
            {busy ? "…" : on ? "Turn off on this device" : "Turn on notifications"}
          </button>
        </>
      )}
      {msg && <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>{msg}</div>}

      {gate !== "unconfigured" && (
        <div style={{ marginTop: 14, borderTop: `1px solid ${C.greenMid}`, paddingTop: 10 }}>
          <Eyebrow>WHAT TO NOTIFY ME ABOUT</Eyebrow>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 3 }}>Push buzzes your phone (needs notifications on for the device); In-app just shows in the bell.</div>
          {NOTIF_TYPES.map((t) => (
            <div key={t.key} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
              <div style={{ flex: 1, color: C.cream, fontSize: 12 }}>
                {t.label}{!t.live && <span style={{ color: C.faint, fontSize: 11 }}> · soon</span>}
              </div>
              {seg(t.key, t.def)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ================= Profile panel (+ admin) =================
export function ProfilePanel({ profile, user, onSaved, badgeRefresh = 0, rounds = [] }: { profile: any; user: any; onSaved: () => void; badgeRefresh?: number; rounds?: Round[] }) {
  const [name, setName] = useState(profile?.display_name || "");
  const [ghin, setGhin] = useState(profile?.ghin_number || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [venmo, setVenmo] = useState(profile?.venmo_handle || "");
  const [paypal, setPaypal] = useState(profile?.paypal_handle || "");
  const [zelle, setZelle] = useState(profile?.zelle_handle || "");
  const [idxStr, setIdxStr] = useState(profile?.handicap_index != null ? String(profile.handicap_index) : "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url || null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.display_name || "");
    setGhin(profile?.ghin_number || "");
    setPhone(profile?.phone || "");
    setVenmo(profile?.venmo_handle || "");
    setPaypal(profile?.paypal_handle || "");
    setZelle(profile?.zelle_handle || "");
    setIdxStr(profile?.handicap_index != null ? String(profile.handicap_index) : "");
    setAvatarUrl(profile?.avatar_url || null);
  }, [profile]);

  const pickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file later
    if (!file) return;
    setPhotoBusy(true); setMsg(null);
    try {
      const blob = await resizeToAvatar(file);
      const path = `${user.id}/avatar.jpg`;
      const up = await supabase.storage.from("avatars").upload(path, blob, { upsert: true, contentType: "image/jpeg" });
      if (up.error) throw new Error(up.error.message);
      const pub = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
      const url = `${pub}?v=${Date.now()}`; // cache-bust so a changed photo shows immediately
      const { error } = await supabase.rpc("set_my_avatar", { p_url: url });
      if (error) throw new Error(error.message);
      setAvatarUrl(url);
      setMsg("Photo updated ✓");
      onSaved();
    } catch (err: any) {
      setMsg("Couldn't update photo: " + (err?.message || "unknown error"));
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = async () => {
    setPhotoBusy(true); setMsg(null);
    try {
      await supabase.rpc("set_my_avatar", { p_url: null });
      await supabase.storage.from("avatars").remove([`${user.id}/avatar.jpg`]);
      setAvatarUrl(null);
      setMsg("Photo removed ✓");
      onSaved();
    } catch (err: any) {
      setMsg("Couldn't remove photo: " + (err?.message || "unknown error"));
    } finally {
      setPhotoBusy(false);
    }
  };


  const save = async () => {
    if (!name.trim()) { setMsg("Please enter your name so others in your club can recognize you."); return; }
    setSaving(true); setMsg(null);
    const idx = idxStr.trim() === "" ? null : parseFloat(idxStr);
    const { error } = await supabase.from("profiles").update({
      display_name: titleCaseName(name.trim()),
      ghin_number: ghin.trim() || null,
      phone: phone.trim() || null,
      venmo_handle: venmo.trim().replace(/^@/, "") || null,
      paypal_handle: paypal.trim().replace(/^@/, "") || null,
      zelle_handle: zelle.trim() || null,
      handicap_index: idx,
    }).eq("id", user.id);
    setSaving(false);
    if (error) { setMsg("Couldn't save: " + error.message); return; }
    setMsg("Saved ✓");
    onSaved();
  };

  return (
    <div style={{ maxWidth: 560 }}>
      <PlayerCard profile={profile} user={user} rounds={rounds} />
      <CardVisibilityToggle user={user} initial={profile?.show_card !== false} />
      <Eyebrow>YOUR PROFILE</Eyebrow>
      <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14, paddingBottom: 16, marginBottom: 16, borderBottom: `1px solid ${C.greenMid}` }}>
          <Avatar src={avatarUrl} name={name || profile?.display_name || "?"} size={64} />
          <div style={{ flex: 1 }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>Profile photo</div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 2, lineHeight: 1.5 }}>
              Helps your group recognize you on the scorecard. Any photo works — it&apos;s resized automatically.
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <label style={{ ...btn(true), fontSize: 12, padding: "7px 12px", cursor: photoBusy ? "default" : "pointer", opacity: photoBusy ? 0.6 : 1 }}>
                {photoBusy ? "Working…" : avatarUrl ? "Change" : "Add photo"}
                <input type="file" accept="image/*" disabled={photoBusy} onChange={pickPhoto} style={{ display: "none" }} />
              </label>
              {avatarUrl && !photoBusy && (
                <button onClick={removePhoto}
                  style={{ background: "transparent", color: "#E8A199", border: `0.5px solid #7A3A34`, borderRadius: 8, padding: "7px 12px", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label style={{ color: C.sage, fontSize: 12 }}>Display name <span style={{ color: C.gold }}>(required)</span></label>
          <input style={{ ...inputStyle, marginTop: 6 }} value={name} placeholder="e.g. Amit Sharma" onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Phone (optional)</label>
          <input style={{ ...inputStyle, marginTop: 6, maxWidth: 220 }} inputMode="tel" placeholder="(555) 123-4567"
            value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>Venmo username (optional)</label>
            <input style={{ ...inputStyle, marginTop: 6 }} placeholder="your-venmo" value={venmo} onChange={(e) => setVenmo(e.target.value)} />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <label style={{ color: C.sage, fontSize: 12 }}>PayPal.me handle (optional)</label>
            <input style={{ ...inputStyle, marginTop: 6 }} placeholder="yourhandle" value={paypal} onChange={(e) => setPaypal(e.target.value)} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Zelle contact (phone or email, optional)</label>
          <input style={{ ...inputStyle, marginTop: 6 }} placeholder="phone or email you use for Zelle" value={zelle} onChange={(e) => setZelle(e.target.value)} />
        </div>
        <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Used only to pre-fill payments when settling up in Money. Never shared elsewhere.</div>
        <div style={{ marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Handicap index (enter manually)</label>
          <input style={{ ...inputStyle, marginTop: 6, maxWidth: 160 }} inputMode="decimal" placeholder="14.2"
            value={idxStr} onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setIdxStr(v); }} />
        </div>
        <div style={{ marginTop: 14 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>GHIN number (optional)</label>
          <input style={{ ...inputStyle, marginTop: 6, maxWidth: 220 }} inputMode="numeric" placeholder="1234567"
            value={ghin} onChange={(e) => setGhin(e.target.value)} />
          <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
            Stored for reference. Automatic handicap import from GHIN isn't connected — enter your index manually for now.
          </div>
        </div>
        <button style={{ ...btn(true), marginTop: 18, opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save profile"}</button>
        {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>{msg}</div>}
      </div>

      <AchievementsWall user={user} rounds={rounds} refreshKey={badgeRefresh} />

      <PushToggle user={user} profile={profile} />

      <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.greenMid}` }}>
        <button style={{ ...btn(false), fontSize: 13 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}

// ================= Admin panel =================
// ★ Shared stat drill-down engine. Any analytics stat calls openStatDrill({stat,title,...});
// the single StatDrawerHost (mounted once) fetches admin_stat_users(stat,arg,date) and lists
// the exact users behind that number. Built once, reused by every stat — existing and new.
type DrillPayload = { stat: string; title: string; cap?: string; arg?: string | null; date?: string | null };
let _openDrill: ((p: DrillPayload) => void) | null = null;
function openStatDrill(p: DrillPayload) { _openDrill?.(p); }

function StatDrawerHost() {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<DrillPayload | null>(null);
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    _openDrill = (p) => {
      setPayload(p); setOpen(true); setRows(null); setErr(null);
      supabase.rpc("admin_stat_users", { p_stat: p.stat, p_arg: p.arg ?? null, p_date: p.date ?? null })
        .then(({ data, error }: any) => { if (error) setErr(error.message); else setRows(data || []); });
    };
    return () => { _openDrill = null; };
  }, []);
  const close = () => setOpen(false);
  const tagColor = (t: string) => {
    const bad = ["friction", "off", "stale", "lapsed", "deleted", "muted", "in progress"];
    const good = ["on", "installed", "new"];
    if (bad.includes(t)) return { bg: C.birdie, fg: "#fff" };
    if (good.includes(t)) return { bg: C.gold, fg: C.green };
    return { bg: C.greenLight, fg: C.sage };
  };
  return (
    <>
      <div aria-hidden style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 80,
        opacity: open ? 1 : 0, pointerEvents: open ? "auto" : "none", transition: "opacity .2s" }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxWidth: 440, margin: "0 auto", zIndex: 90,
        background: C.greenMid, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "82vh",
        display: "flex", flexDirection: "column", transform: open ? "translateY(0)" : "translateY(102%)",
        transition: "transform .24s cubic-bezier(.2,.7,.2,1)", boxShadow: "0 -10px 40px rgba(0,0,0,.5)",
        paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}>
        <div style={{ width: 42, height: 5, borderRadius: 3, background: "rgba(255,255,255,.25)", margin: "9px auto 4px" }} />
        <div style={{ padding: "6px 16px 12px", borderBottom: `1px solid ${C.greenLight}`, position: "relative" }}>
          <button onClick={close} style={{ position: "absolute", right: 12, top: 4, background: "none", border: "none", color: C.sage, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 19, fontWeight: 800, color: C.cream, paddingRight: 28 }}>{payload?.title || ""}</div>
          {payload?.cap ? <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{payload.cap}</div> : null}
          {rows ? <div style={{ color: C.faint, fontSize: 11, marginTop: 4 }}>{rows.length} {rows.length === 1 ? "user" : "users"}</div> : null}
        </div>
        <div style={{ overflowY: "auto", padding: "6px 10px 22px" }}>
          {err ? <div style={{ color: C.sage, fontSize: 12, padding: 12 }}>Couldn't load: {err}</div> :
           !rows ? <div style={{ color: C.sage, fontSize: 12, padding: 12 }}>Loading…</div> :
           rows.length === 0 ? <div style={{ color: C.sage, fontSize: 12, padding: 12 }}>No users for this metric.</div> :
           rows.map((u: any, i: number) => {
             const tc = u.tag ? tagColor(u.tag) : null;
             return (
               <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 8px", borderTop: i ? "1px solid rgba(255,255,255,.06)" : "none" }}>
                 <Avatar src={u.avatar_url} name={u.name || "?"} size={34} />
                 <div style={{ minWidth: 0 }}>
                   <div style={{ fontSize: 14, fontWeight: 600, color: C.cream, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                   {u.detail ? <div style={{ fontSize: 11, color: C.sage, marginTop: 1 }}>{u.detail}</div> : null}
                 </div>
                 {tc ? <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: tc.bg, color: tc.fg, whiteSpace: "nowrap" }}>{u.tag === "friction" ? "unfinished" : u.tag}</span> : null}
               </div>
             );
           })}
        </div>
      </div>
    </>
  );
}

// ★ Admin analytics — utilization, feature popularity, health. Reads one JSON
// payload from the is_admin-gated get_admin_analytics() RPC.
// ★ Golf-cadence engagement — reads the is_admin-gated get_admin_engagement() RPC (migration
// 0078). Measures the round (real golf activity) on a weekly cycle, not daily app-opens.
function AdminEngagement() {
  const [e, setE] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("get_admin_engagement").then(({ data, error }: any) => {
      if (error) setErr(error.message); else setE(data);
    });
  }, []);
  if (err) return null; // supplementary; stay quiet if the RPC isn't deployed yet
  if (!e) return <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>Loading engagement…</div>;

  const ws: { week: string; golfers: number; rounds: number }[] = e.weekend_series || [];
  const nr: { week: string; new: number; returning: number }[] = e.weekly_new_returning || [];
  const nrData = nr.map((w) => ({ week: w.week, new: w.new || 0, returning: w.returning || 0, total: (w.new || 0) + (w.returning || 0) }));
  const feat = e.feature || { in_game: 0, solo: 0 };
  const featTot = (feat.in_game || 0) + (feat.solo || 0);

  const tile = (n: React.ReactNode, l: string, d?: string) => (
    <div style={{ background: C.greenLight, borderRadius: 12, padding: "10px 12px", flex: 1, minWidth: 92 }}>
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{n}</div>
      <div style={{ color: C.sage, fontSize: 11 }}>{l}</div>
      {d ? <div style={{ color: C.sage, fontSize: 11, marginTop: 2, opacity: 0.8 }}>{d}</div> : null}
    </div>
  );

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>Engagement — golf cadence</div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 2, marginBottom: 8 }}>Measured on rounds (the real unit of golf) on a weekly cycle — not daily app-opens.</div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tile(`${e.wau_mau_pct ?? 0}%`, "WAU / MAU", "weekly stickiness")}
        {tile(e.rounds_per_active_mo ?? 0, "Rounds / golfer", "active, last 28d")}
        {tile(`${e.weekend_share_pct ?? 0}%`, "Weekend share", "Fri–Sun, 90d")}
        {tile(e.active_28d ?? 0, "Active golfers", "logged a round, 28d")}
      </div>

      <div style={{ color: C.sage, fontSize: 12, fontWeight: 700, marginTop: 16, marginBottom: 6 }}>Weekend reach — golfers logging Fri–Sun</div>
      <div style={{ height: 160, background: C.greenLight, borderRadius: 12, padding: "14px 10px 6px" }}>
        {ws.length === 0 ? <div style={{ color: C.sage, fontSize: 12 }}>No rounds yet.</div> : (
          <ResponsiveContainer>
            <BarChart data={ws} margin={{ top: 14, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="week" tick={{ fill: C.sage, fontSize: 11 }} axisLine={{ stroke: C.greenMid }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fill: C.faint, fontSize: 11 }} axisLine={false} tickLine={false} width={22} />
              <Bar dataKey="golfers" fill={C.gold} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                <LabelList dataKey="golfers" position="top" fill={C.cream} fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div style={{ color: C.sage, fontSize: 12, fontWeight: 700, marginTop: 16, marginBottom: 6 }}>New vs returning golfers, per week</div>
      <div style={{ height: 160, background: C.greenLight, borderRadius: 12, padding: "14px 10px 6px" }}>
        {nr.length === 0 ? <div style={{ color: C.sage, fontSize: 12 }}>No rounds yet.</div> : (
          <ResponsiveContainer>
            <BarChart data={nrData} margin={{ top: 14, right: 8, left: -20, bottom: 0 }}>
              <XAxis dataKey="week" tick={{ fill: C.sage, fontSize: 11 }} axisLine={{ stroke: C.greenMid }} tickLine={false} interval="preserveStartEnd" minTickGap={16} />
              <YAxis allowDecimals={false} tick={{ fill: C.faint, fontSize: 11 }} axisLine={false} tickLine={false} width={22} />
              <Bar dataKey="new" stackId="a" fill={C.gold} maxBarSize={34} isAnimationActive={false} />
              <Bar dataKey="returning" stackId="a" fill={C.sage} radius={[4, 4, 0, 0]} maxBarSize={34} isAnimationActive={false}>
                <LabelList dataKey="total" position="top" fill={C.cream} fontSize={11} fontWeight={700} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11, color: C.sage }}>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: C.gold, borderRadius: 2, marginRight: 4 }} />new</span>
        <span><span style={{ display: "inline-block", width: 8, height: 8, background: C.sage, borderRadius: 2, marginRight: 4 }} />returning</span>
      </div>

      <div style={{ color: C.sage, fontSize: 12, fontWeight: 700, marginTop: 14 }}>How rounds are played (90 days)</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.cream, marginTop: 6 }}><span>In a game</span><span>{feat.in_game || 0}</span></div>
      <div style={{ height: 8, borderRadius: 4, background: C.green, marginTop: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 4, width: `${featTot > 0 ? Math.round(((feat.in_game || 0) / featTot) * 100) : 0}%`, background: C.gold }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.cream, marginTop: 8 }}><span>Solo score entry</span><span>{feat.solo || 0}</span></div>
      <div style={{ height: 8, borderRadius: 4, background: C.green, marginTop: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 4, width: `${featTot > 0 ? Math.round(((feat.solo || 0) / featTot) * 100) : 0}%`, background: C.sage }} />
      </div>
    </div>
  );
}

// ★ Power users — top 25 by composite engagement score, every metric individually sortable,
// with a churn ("quiet 30d+") signal. (The old "restarts" behaviour badge was removed —
// abandoning/deleting rounds is normal; real data-integrity issues live in Friction review.)
// Reads the is_admin-gated get_power_users() RPC (migration 0088).
type PUCol =
  | "score" | "completed_rounds" | "games_played" | "active_days" | "total_opens"
  | "completion_pct" | "unfinished_rounds" | "deleted_rounds" | "days_since_active";
function AdminPowerUsers() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null); // null = all-time
  const [sortCol, setSortCol] = useState<PUCol>("score");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [avatars, setAvatars] = useState<Record<string, string | null>>({});

  useEffect(() => {
    setRows(null); setErr(null);
    supabase.rpc("get_power_users", { p_days: days }).then(({ data, error }: any) => {
      if (error) setErr(error.message); else setRows(data || []);
    });
  }, [days]);

  // Photos, best-effort: if row-level security lets this admin read the profiles, show avatars;
  // otherwise the Avatar falls back to initials. Never blocks the table.
  useEffect(() => {
    const ids = (rows || []).map((r: any) => r.user_id).filter(Boolean);
    if (!ids.length) return;
    supabase.from("profiles").select("id, avatar_url").in("id", ids).then(({ data }: any) => {
      if (data) setAvatars(Object.fromEntries(data.map((p: any) => [p.id, p.avatar_url ?? null])));
    });
  }, [rows]);

  const sorted = React.useMemo(() => {
    if (!rows) return [];
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortCol] ?? -1, bv = b[sortCol] ?? -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return arr;
  }, [rows, sortCol, sortDir]);

  const setSort = (c: PUCol) => {
    if (c === sortCol) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortCol(c); setSortDir("desc"); }
  };

  if (err) return null; // supplementary; stay quiet if the RPC isn't deployed yet

  const cols: { key: PUCol; label: string; title: string }[] = [
    { key: "score", label: "Score", title: "Composite: completed×4 + games×2 + active days×1 + opens×0.1" },
    { key: "completed_rounds", label: "Rnds", title: "Completed rounds (final, not deleted)" },
    { key: "games_played", label: "Games", title: "Games played" },
    { key: "active_days", label: "Days", title: "Days active (opened the app)" },
    { key: "total_opens", label: "Opens", title: "Total app opens" },
    { key: "completion_pct", label: "Cmpl%", title: "Completed ÷ all started rounds" },
    { key: "unfinished_rounds", label: "Unfin", title: "Started but never finished (in-progress)" },
    { key: "deleted_rounds", label: "Del", title: "Soft-deleted rounds (mostly phantom-round cleanup)" },
    { key: "days_since_active", label: "Idle", title: "Days since last active" },
  ];
  const arrow = (c: PUCol) => (c === sortCol ? (sortDir === "desc" ? " ▾" : " ▴") : "");

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 8 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>Power users</div>
        <div style={{ display: "flex", gap: 4 }}>
          {([[null, "All-time"], [90, "90 days"]] as [number | null, string][]).map(([d, lbl]) => (
            <button key={lbl} onClick={() => setDays(d)}
              style={{ fontSize: 11, padding: "3px 10px", borderRadius: 999, border: "none", cursor: "pointer",
                background: days === d ? C.gold : C.greenLight, color: days === d ? C.green : C.cream, fontWeight: 700 }}>
              {lbl}
            </button>
          ))}
        </div>
      </div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 2, marginBottom: 8 }}>
        Top 25 by composite score — tap a column to sort. <b style={{ color: C.cream }}>quiet</b> = no activity 30d+.
      </div>

      {!rows ? <div style={{ color: C.sage, fontSize: 12 }}>Loading…</div> :
        sorted.length === 0 ? <div style={{ color: C.sage, fontSize: 12 }}>No users yet.</div> : (
        <HScroll maxHeight="70vh" style={{ background: C.greenLight, borderRadius: 12, padding: 4 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "6px 8px", position: "sticky", left: 0, top: 0, zIndex: 3, background: C.greenLight }}>
                  <span style={{ color: C.sage, fontSize: 11, fontWeight: 700 }}>Player</span>
                </th>
                {cols.map((c) => (
                  <th key={c.key} title={c.title} onClick={() => setSort(c.key)}
                    style={{ padding: "6px 8px", textAlign: "right", cursor: "pointer", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 2, background: C.greenLight }}>
                    <span style={{ color: c.key === sortCol ? C.gold : C.sage, fontSize: 11, fontWeight: 700 }}>{c.label}{arrow(c.key)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.user_id} style={{ borderTop: `1px solid ${C.greenMid}` }}>
                  <td style={{ padding: "6px 8px", position: "sticky", left: 0, zIndex: 1, background: C.greenLight, maxWidth: 160 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
                      <Avatar src={avatars[r.user_id]} name={r.display_name || "?"} size={22} enlargeable={false} />
                      <div style={{ color: C.cream, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {r.display_name || "—"}
                      </div>
                    </div>
                    {r.churned ? (
                      <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                        <span style={{ fontSize: 11, color: C.cream, background: C.greenMid, borderRadius: 4, padding: "0 5px", fontWeight: 700 }}>quiet</span>
                      </div>
                    ) : null}
                  </td>
                  {cols.map((c) => {
                    const v = r[c.key];
                    const flagHot = (c.key === "unfinished_rounds" || c.key === "deleted_rounds") && (v || 0) > 0;
                    return (
                      <td key={c.key} style={{ padding: "6px 8px", textAlign: "right", whiteSpace: "nowrap",
                        color: c.key === sortCol ? C.cream : (flagHot ? C.gold : C.sage), fontSize: 12,
                        fontWeight: c.key === "score" ? 800 : 500 }}>
                        {v == null ? "—" : c.key === "score" ? Math.round(v) : c.key === "completion_pct" ? `${v}%` : v}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </HScroll>
      )}
    </div>
  );
}

function AdminAnalytics() {
  const [a, setA] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("get_admin_analytics").then(({ data, error }: any) => {
      if (error) setErr(error.message); else setA(data);
    });
  }, []);
  if (err) return <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>Analytics unavailable: {err}</div>;
  if (!a) return <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>Loading analytics…</div>;

  const t = a.totals || {}, ac = a.active || {}, f = a.formats || {}, fe = a.features || {}, h = a.health || {}, en = a.engagement || {};
  const series: { day: string; n: number }[] = ac.series || [];

  const tile = (n: React.ReactNode, l: string, d?: string, bg: string = C.greenLight, drill?: { stat: string; cap?: string }) => (
    <div onClick={drill ? () => openStatDrill({ stat: drill.stat, title: l, cap: drill.cap }) : undefined}
      style={{ background: bg, borderRadius: 12, padding: "10px 12px", flex: 1, minWidth: 88, position: "relative", cursor: drill ? "pointer" : "default" }}>
      {drill ? <span style={{ position: "absolute", right: 8, top: 8, color: C.gold, fontSize: 11, fontWeight: 800 }}>who ›</span> : null}
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{n}</div>
      <div style={{ color: C.sage, fontSize: 11 }}>{l}</div>
      {d ? <div style={{ color: "#5BD08A", fontSize: 11, marginTop: 2 }}>{d}</div> : null}
    </div>
  );

  const W = 600, H = 120, pad = 6;
  const max = Math.max(1, ...series.map((s) => s.n));
  const step = series.length > 1 ? (W - pad * 2) / (series.length - 1) : 0;
  const pts = series.map((s, i) => [pad + i * step, H - pad - (s.n / max) * (H - pad * 2)] as [number, number]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const area = pts.length ? `${line} L${(W - pad).toFixed(1)} ${H - pad} L${pad} ${H - pad} Z` : "";

  const bar = (label: string, n: number, denom: number, color: string, drillStat?: string) => (
    <div key={label} onClick={drillStat ? () => openStatDrill({ stat: drillStat, title: label }) : undefined} style={{ cursor: drillStat ? "pointer" : "default" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.cream, marginTop: 8 }}><span>{label}{drillStat ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>  who ›</span> : null}</span><span>{n}</span></div>
      <div style={{ height: 8, borderRadius: 4, background: C.green, marginTop: 3, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 4, width: `${denom > 0 ? Math.round((n / denom) * 100) : 0}%`, background: color }} />
      </div>
    </div>
  );

  const fmtName: Record<string, string> = { stableford: "Stableford", fourball: "Four-ball", match: "Singles match", skins: "Skins", trifecta: "Trifecta" };
  const fmtColors: Record<string, string> = { stableford: "#5BD08A", fourball: "#5AA9E6", match: "#C9A227", skins: "#E0915B", trifecta: "#B084E0" };
  const fmtEntries = (Object.entries(f) as [string, number][]).sort((x, y) => y[1] - x[1]);
  const fmtMax = Math.max(1, ...fmtEntries.map(([, n]) => n));
  const feat: [string, number][] = [["Avatars set", fe.avatars_set || 0], ["AI summaries", fe.ai_summaries || 0], ["Live links (now)", fe.live_shared || 0], ["Courses added (30d)", fe.courses_added_30d || 0]];
  const featMax = Math.max(1, ...feat.map(([, n]) => n));

  const hrow = (label: string, val: string, good?: boolean, drill?: { stat: string; cap?: string }) => (
    <div onClick={drill ? () => openStatDrill({ stat: drill.stat, title: label, cap: drill.cap }) : undefined}
      style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "8px 0", borderTop: `1px solid ${C.greenMid}`, cursor: drill ? "pointer" : "default" }}>
      <span style={{ color: C.cream, fontSize: 13 }}>{label}{drill ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>  who ›</span> : null}</span>
      <span style={{ fontWeight: 800, fontSize: 15, color: good === undefined ? C.cream : good ? "#5BD08A" : "#E0796B" }}>{val}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 8 }}>
      <StatDrawerHost />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tile(t.users ?? "—", "Total users", t.users_new_30d ? `+${t.users_new_30d} / 30d` : undefined, C.greenLight, { stat: "users_total", cap: "All active (non-test) users" })}
        {tile(t.active_groups ?? "—", "Active clubs")}
        {tile(t.games ?? "—", "Games", t.games_30d ? `+${t.games_30d} / 30d` : undefined)}
        {tile(t.rounds ?? "—", "Rounds done", `${t.rounds_30d ? `+${t.rounds_30d} /30d` : "—"}${t.rounds_started ? ` · ${t.rounds_started} started` : ""}`, C.greenLight, { stat: "rounds_done", cap: "Players with completed rounds" })}
      </div>

      <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 10 }}>
        <div style={{ display: "flex", textAlign: "center" }}>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openStatDrill({ stat: "active_dau", title: "Active today", cap: "Users who opened BNN today" })}><div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 800 }}>{ac.dau ?? 0}</div><div style={{ color: C.sage, fontSize: 11 }}>Today · unique</div><div style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>{ac.views_today ?? 0} views · who ›</div></div>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openStatDrill({ stat: "active_wau", title: "Active this week", cap: "Users active in the last 7 days" })}><div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 800 }}>{ac.wau ?? 0}</div><div style={{ color: C.sage, fontSize: 11 }}>This week · unique</div><div style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>{ac.views_7d ?? 0} views · who ›</div></div>
          <div style={{ flex: 1, cursor: "pointer" }} onClick={() => openStatDrill({ stat: "active_mau", title: "Active this month", cap: "Users active in the last 30 days" })}><div style={{ color: C.gold, fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 800 }}>{ac.mau ?? 0}</div><div style={{ color: C.sage, fontSize: 11 }}>This month · unique</div><div style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>{ac.views_30d ?? 0} views · who ›</div></div>
        </div>
        {series.length > 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 120, marginTop: 12 }}>
            <defs><linearGradient id="aaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={C.gold} stopOpacity="0.35" /><stop offset="1" stopColor={C.gold} stopOpacity="0" /></linearGradient></defs>
            {area && <path d={area} fill="url(#aaGrad)" />}
            {line && <path d={line} fill="none" stroke={C.gold} strokeWidth={2.5} strokeLinejoin="round" />}
          </svg>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.faint }}><span>30 days ago</span><span>today</span></div>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          {tile(ac.avg7 ?? 0, "7-day avg", undefined, C.green)}
          {tile(ac.avg30 ?? 0, "30-day avg", undefined, C.green)}
          {tile(`${ac.stickiness_pct ?? 0}%`, "Stickiness (DAU/MAU)", undefined, C.green)}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          {tile(t.rounds_per_active_user ?? 0, "Rounds / active user", undefined, C.green)}
          {tile(ac.churn_30d ?? 0, "Lapsed (30–60d, gone)", undefined, C.green, { stat: "lapsed", cap: "Active 30–60d ago, silent since" })}
        </div>
        <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Unique = distinct users; views = total app opens. Test accounts are excluded from all figures. Days run midnight–midnight US Eastern. Trends build over time.</div>
      </div>

      <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 10 }}>
        <div style={{ color: C.sage, fontSize: 12, fontWeight: 700 }}>Games by format</div>
        {fmtEntries.length ? fmtEntries.map(([k, n]) => bar(fmtName[k] || k, n, fmtMax, fmtColors[k] || C.sage)) : <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>No games yet.</div>}
        <div style={{ color: C.sage, fontSize: 12, fontWeight: 700, marginTop: 14 }}>Feature usage</div>
        {feat.map(([k, n]) => bar(k, n, featMax, "#5AA9E6", k === "Avatars set" ? "avatars_set" : k === "AI summaries" ? "ai_summaries" : undefined))}
      </div>

      <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 10 }}>
        {hrow("Game completion (ended \u00f7 created)", `${h.completion_pct ?? 0}%`, true)}
        {hrow("Round completion (done \u00f7 started)", `${h.round_completion_pct ?? 0}%`, true, { stat: "unfinished", cap: "Users with unfinished / abandoned rounds" })}
        {hrow("Abandoned games + rounds (never finished)", `${h.abandoned_pct ?? 0}%`, false, { stat: "abandoned", cap: "Users with stale unfinished or deleted rounds" })}
        {hrow("Avg holes entered / game", `${h.avg_holes ?? 0}`)}
        {hrow("New users active within 7 days", `${h.activated_7d_pct ?? 0}%`, true, { stat: "users_new_30d", cap: "Recently-joined users" })}
        {hrow("Signups never joined a club", `${h.never_joined_group_pct ?? 0}%`, false, { stat: "never_joined_group", cap: "Users with no active club membership" })}
        {hrow("Retention \u2014 week 1", `${h.retention_w1_pct ?? 0}%`)}
        {hrow("Retention \u2014 week 4", `${h.retention_w4_pct ?? 0}%`)}
        <div style={{ color: C.faint, fontSize: 11, marginTop: 8 }}>Rounds counted only when completed; deleted rounds never count. Retention accrues over the first weeks.</div>
      </div>

      <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 10 }}>
        <div style={{ color: C.sage, fontSize: 12, fontWeight: 700, marginBottom: 2 }}>Engagement (last 30 days)</div>
        {hrow("Tee times created", `${en.tee_times_30d ?? 0}`)}
        {hrow("RSVPs recorded", `${en.tee_rsvps_30d ?? 0}`)}
        {hrow("Bets posted (all-time / 30d)", `${en.bets_posted ?? 0} / ${en.bets_30d ?? 0}`)}
        {hrow("Money settled (all-time)", `$${Math.round((en.settled_cents ?? 0) / 100).toLocaleString()}`)}
        {hrow("Invite links created", `${en.invites_created_30d ?? 0}`)}
        {hrow("Joins via invite (all-time)", `${en.joins_via_invite ?? 0}`)}
        {hrow("Games using a group scorer", `${en.group_scoring_pct ?? 0}%`, true)}
      </div>
    </div>
  );
}

function OpsMetrics() {
  const [m, setM] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sg, setSg] = useState<any[] | null>(null);
  const [delId, setDelId] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("get_ops_metrics").then(({ data, error }: any) => {
      if (error) setErr(error.message); else setM(data);
    });
    supabase.rpc("admin_stale_games").then(({ data }: any) => {
      if (Array.isArray(data)) setSg(data);
    }, () => {});
  }, []);
  if (err) return null; // supplementary; quiet if the RPC isn't deployed yet
  if (!m || Object.keys(m).length === 0) return null;

  const delStale = async (g: any) => {
    if (g.rounds_posted > 0 || delId) return;
    if (!confirm(`Delete "${g.name}"? This removes the game and its ${g.players} player row${g.players === 1 ? "" : "s"} app-wide. It can't be undone.`)) return;
    setDelId(g.game_id);
    const { data } = await supabase.rpc("admin_delete_stale_game", { p_game: g.game_id });
    setDelId(null);
    if (data === "deleted") setSg((prev) => (prev || []).filter((x) => x.game_id !== g.game_id));
    else if (data === "has_rounds") alert("Skipped — this game has posted rounds, so it wasn't deleted (avoids orphaning player rounds).");
    else if (data === "not_stale") alert("Skipped — this game is already completed.");
    else alert("Couldn't delete (permission or already gone).");
  };

  const ctr = (c: number, s: number) => (s ? `${Math.round((100 * c) / s)}% click-through` : "no impressions yet");
  const tile = (n: React.ReactNode, l: string, d?: string) => (
    <div style={{ background: C.greenLight, borderRadius: 12, padding: "10px 12px", flex: 1, minWidth: 92 }}>
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 20, fontFamily: "Georgia, serif" }}>{n}</div>
      <div style={{ color: C.sage, fontSize: 11 }}>{l}</div>
      {d ? <div style={{ color: C.sage, fontSize: 11, marginTop: 2, opacity: 0.8 }}>{d}</div> : null}
    </div>
  );

  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700 }}>Operations</div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 2, marginBottom: 8 }}>Profile-completion funnel and round hygiene. Nudge counts accumulate from when logging shipped, so they build up over time.</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tile(m.profiles_incomplete ?? 0, "Profiles incomplete", "missing photo or handicap")}
        {tile(`${m.nudge_clicked_7d ?? 0}/${m.nudge_shown_7d ?? 0}`, "Nudge clicks · 7d", ctr(m.nudge_clicked_7d ?? 0, m.nudge_shown_7d ?? 0))}
        {tile(`${m.nudge_clicked_28d ?? 0}/${m.nudge_shown_28d ?? 0}`, "Nudge clicks · 28d", ctr(m.nudge_clicked_28d ?? 0, m.nudge_shown_28d ?? 0))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {tile(m.stale_ready ?? 0, "Stuck & complete", "auto-finished on next sweep")}
        {tile(m.stale_partial ?? 0, "Stuck & partial", "left for the player to resolve")}
        {tile(m.auto_finished_7d ?? 0, "Auto-finished · 7d", "recovered into handicaps")}
      </div>
      {sg ? (() => {
        const clean = sg.filter((g) => g.verdict === "fully_scored").length;
        const abandoned = sg.filter((g) => g.verdict === "in_progress" || g.verdict === "no_scores" || g.verdict === "empty").length;
        const vlabel: Record<string, string> = { fully_scored: "fully scored", in_progress: "in progress", no_scores: "no scores", empty: "no players" };
        const vcolor: Record<string, string> = { fully_scored: C.gold, in_progress: C.sage, no_scores: C.birdie, empty: C.faint };
        return (
          <div style={{ marginTop: 16 }}>
            <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 14, fontWeight: 700 }}>Stale games · 24h+</div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 2, marginBottom: 8 }}>
              Unfinished games older than a day, app-wide. Fully-scored ones (gold) auto-complete on the next sweep if under 30 days old; the rest are abandoned shells you can Delete here (games with posted rounds are protected).
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
              {tile(sg.length, "Total stale", "not ended, 24h+")}
              {tile(clean, "Fully scored", "done but left open")}
              {tile(abandoned, "Abandoned", "partial / empty")}
            </div>
            {sg.length === 0 ? (
              <div style={{ color: C.sage, fontSize: 12, padding: "8px 2px" }}>No stale games — nothing to clean up.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {sg.map((g) => (
                  <div key={g.game_id} style={{ background: C.greenLight, borderRadius: 10, padding: "8px 10px", display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>{g.name}</div>
                      <div style={{ color: C.sage, fontSize: 11, marginTop: 1 }}>
                        {g.course} · {g.club} · {Math.round(g.age_days)}d · {g.organizer}
                      </div>
                      <div style={{ color: C.sage, fontSize: 11, marginTop: 1, opacity: 0.85 }}>
                        {g.players} player{g.players === 1 ? "" : "s"} · {g.complete} done · {g.partial} mid-round · {g.not_started} no score
                        {g.rounds_posted ? ` · ${g.rounds_posted} posted` : ""}
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                      <div style={{ background: vcolor[g.verdict] || C.faint, color: g.verdict === "fully_scored" ? "#1A1A1A" : C.cream, borderRadius: 8, padding: "2px 8px", fontSize: 11, fontWeight: 800, whiteSpace: "nowrap" }}>
                        {vlabel[g.verdict] || g.verdict}
                      </div>
                      {g.rounds_posted > 0 ? (
                        <div style={{ color: C.faint, fontSize: 11, whiteSpace: "nowrap" }}>has rounds</div>
                      ) : (
                        <button
                          onClick={() => delStale(g)}
                          disabled={delId === g.game_id}
                          style={{ background: "transparent", color: C.birdie, border: `1px solid ${C.birdie}`, borderRadius: 8, padding: "2px 8px", fontSize: 11, fontWeight: 700, cursor: delId === g.game_id ? "default" : "pointer", opacity: delId === g.game_id ? 0.5 : 1, whiteSpace: "nowrap" }}
                        >
                          {delId === g.game_id ? "Deleting…" : "Delete"}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })() : null}
    </div>
  );
}

function RoundSaveDiag() {
  const [on, setOn] = useState(false);
  const [repro, setRepro] = useState(false);
  const [log, setLog] = useState<any[]>([]);
  const [open, setOpen] = useState(false);
  const refresh = () => setLog(getDiagLog().slice().reverse());
  useEffect(() => { setOn(diagEnabled()); setRepro(reproduceBug()); refresh(); }, []);

  const toggleOn = () => { const v = !on; setDiagEnabled(v); setOn(v); refresh(); };
  const toggleRepro = () => { const v = !repro; setReproduceBug(v); setRepro(v); };
  const copyAll = async () => {
    const text = getDiagLog().map((e) => `${new Date(e.t).toISOString()} [${e.sid}] ${e.ev}${e.d ? " " + JSON.stringify(e.d) : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); alert(`Copied ${getDiagLog().length} events to clipboard.`); }
    catch { alert("Couldn't access the clipboard — select the text below and copy manually."); }
  };
  const clear = () => { if (confirm("Clear the diagnostics log?")) { clearDiagLog(); refresh(); } };

  const insertCount = getDiagLog().filter((e) => e.ev === "ensure" && /insert/.test(e.d?.outcome || "")).length;
  const evColor = (e: any) => {
    if (e.ev === "ensure") {
      const o = e.d?.outcome || "";
      if (/insert/.test(o)) return "#FB7185";      // new row created — the bug's signature
      if (o === "adopt" || o === "reuse") return "#8FE0B0"; // reused an existing row — good
      return C.sage;
    }
    if (e.ev === "flush") return "#7FB8FF";
    if (e.ev === "mount") return C.gold;
    return C.sage;
  };
  const Toggle = ({ v, on: label, off }: { v: boolean; on: string; off: string }) => (
    <span style={{ display: "inline-block", minWidth: 44, textAlign: "center", padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 800, color: v ? "#0e3a2c" : C.sage, background: v ? C.gold : "#16302A", border: `1px solid ${v ? C.gold : "#37624f"}` }}>{v ? label : off}</span>
  );

  return (
    <div style={{ marginTop: 18, border: `1px solid #37624f`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, flex: 1 }}>Round-save diagnostics</div>
        <button onClick={() => setOpen((o) => !o)} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>{open ? "Hide" : "Show"}</button>
      </div>
      {open && (
        <div style={{ marginTop: 10 }}>
          <div style={{ color: C.sage, fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>
            Per-device and off by default. Turn on logging, then to reproduce the bug turn on “reproduce” and score a few holes,
            locking the phone between each. Red “insert” lines = a new row was created; green “adopt/reuse” = the existing row was
            reused. One round should show a single insert once reproduce is off.
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 10 }}>
            <button onClick={toggleOn} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0 }}>
              <Toggle v={on} on="ON" off="OFF" /><span style={{ color: C.cream, fontSize: 12 }}>Logging</span>
            </button>
            <button onClick={toggleRepro} style={{ background: "none", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8, padding: 0 }}>
              <Toggle v={repro} on="ON" off="OFF" /><span style={{ color: repro ? "#FB7185" : C.cream, fontSize: 12 }}>Reproduce bug (disable dedupe)</span>
            </button>
          </div>
          <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <button onClick={refresh} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Refresh</button>
            <button onClick={copyAll} style={{ ...btn(true), fontSize: 11, padding: "5px 10px" }}>Copy all</button>
            <button onClick={clear} style={{ ...btn(false), fontSize: 11, padding: "5px 10px" }}>Clear</button>
          </div>
          <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>{log.length} events · <span style={{ color: insertCount > 1 ? "#FB7185" : C.sage, fontWeight: 700 }}>{insertCount} insert{insertCount === 1 ? "" : "s"}</span></div>
          <div style={{ maxHeight: 280, overflowY: "auto", background: "#0e2620", borderRadius: 8, padding: 8, fontFamily: "monospace", fontSize: 11, lineHeight: 1.5 }}>
            {log.length === 0 ? <div style={{ color: C.sage }}>No events yet.</div> : log.map((e, i) => (
              <div key={i} style={{ color: evColor(e), whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {new Date(e.t).toLocaleTimeString()} [{e.sid}] {e.ev}{e.d ? " " + JSON.stringify(e.d) : ""}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminPanel({ user, showAnalytics = true }: { user: any; showAnalytics?: boolean }) {
  const [profiles, setProfiles] = useState<any[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [scoringFor, setScoringFor] = useState<any | null>(null);
  const [deletedCourses, setDeletedCourses] = useState<any[]>([]);
  const [pendingGroups, setPendingGroups] = useState<any[]>([]);
  const [allGroups, setAllGroups] = useState<any[]>([]);
  const [memberships, setMemberships] = useState<any[]>([]);
  const [manageGroupsFor, setManageGroupsFor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");        // debounced/applied search term
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const PAGE = 50;

  // Load one page of players (search-filtered), and fetch group memberships only for those players.
  const loadProfiles = useCallback(async (from: number, q: string, existing: any[]) => {
    let qb = supabase.from("profiles").select("*").order("last_active", { ascending: false }).range(from, from + PAGE - 1);
    if (q.trim()) qb = qb.or(`display_name.ilike.%${q.trim()}%,email.ilike.%${q.trim()}%`);
    const { data } = await qb;
    const page = data || [];
    const merged = from === 0 ? page : [...existing, ...page];
    setProfiles(merged);
    setHasMore(page.length === PAGE);
    const ids = merged.map((p: any) => p.id);
    if (ids.length) {
      const { data: mem } = await supabase.from("group_members").select("id, group_id, user_id, role, status").in("user_id", ids).neq("status", "removed");
      setMemberships(mem || []);
    }
  }, []);

  const loadMorePlayers = async () => {
    setLoadingMore(true);
    const current = profiles || [];
    await loadProfiles(current.length, query, current);
    setLoadingMore(false);
  };

  const load = useCallback(async () => {
    await loadProfiles(0, query, []);
    const { data: del } = await supabase.from("favorite_courses").select("*").eq("deleted", true).order("deleted_at", { ascending: false });
    setDeletedCourses(del || []);
    // Groups list is small (count of groups, not users) — fine to load fully for the add-to-group picker.
    const { data: gs } = await supabase.from("groups").select("id, name, status").neq("status", "declined").order("name");
    setAllGroups((gs || []).filter((g: any) => (g.status ?? "active") === "active"));
    const { data: reqs } = await supabase.from("groups").select("id, name, request_note, created_by, status").eq("status", "pending").order("created_at", { ascending: true });
    const reqList = reqs || [];
    const reqIds = reqList.map((r: any) => r.created_by).filter(Boolean);
    let byId: Record<string, any> = {};
    if (reqIds.length) {
      const { data: ps } = await supabase.from("profiles").select("id, display_name, email").in("id", reqIds);
      byId = Object.fromEntries((ps || []).map((p: any) => [p.id, p]));
    }
    setPendingGroups(reqList.map((r: any) => ({ ...r, requester: byId[r.created_by] || null })));
  }, [query]);
  useEffect(() => { load(); }, [load]);

  // --- Global player ↔ group management (admin governance) ---
  const addToGroup = async (p: any, groupId: string) => {
    const existing = memberships.find((m) => m.user_id === p.id && m.group_id === groupId);
    if (existing) return;
    await supabase.from("group_members").insert({
      group_id: groupId, user_id: p.id, email: (p.email || "").toLowerCase(), role: "member", status: "active",
    });
    await notify(p.id, `An admin added you to a club.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "member_added", group_id: groupId, target_user_id: p.id, summary: `Added ${p.display_name || p.email} to a group` });
    await load();
  };

  const removeFromGroup = async (p: any, m: any, groupName: string) => {
    if (!confirm(`Remove ${p.display_name || p.email} from "${groupName}"?`)) return;
    await supabase.from("group_members").update({ status: "removed" }).eq("id", m.id);
    await notify(p.id, `An admin removed you from "${groupName}".`);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "member_removed", group_id: m.group_id, target_user_id: p.id, summary: `Removed ${p.display_name || p.email} from "${groupName}"` });
    await load();
  };

  // Deactivate: remove from all groups + block access, but keep their data.
  const deactivatePlayer = async (p: any) => {
    if (!confirm(`Deactivate ${p.display_name || p.email}?\n\nThey'll be removed from all clubs and blocked from using the app, but their rounds and history are kept. You can reactivate them later.`)) return;
    await supabase.from("group_members").update({ status: "removed" }).eq("user_id", p.id);
    await supabase.from("profiles").update({ deactivated: true }).eq("id", p.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "player_deactivated", target_user_id: p.id, summary: `Deactivated ${p.display_name || p.email}` });
    await load();
  };

  const reactivatePlayer = async (p: any) => {
    await supabase.from("profiles").update({ deactivated: false }).eq("id", p.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "player_reactivated", target_user_id: p.id, summary: `Reactivated ${p.display_name || p.email}` });
    await load();
  };

  // Flag/unflag any account as a test account (excluded from all analytics, fully functional).
  const toggleTestPlayer = async (p: any) => {
    const next = !p.is_test;
    const { error } = await supabase.rpc("admin_set_test", { p_user: p.id, p_is_test: next });
    if (error) { alert("Couldn't update test mode — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: next ? "player_test_on" : "player_test_off", target_user_id: p.id, summary: `${next ? "Marked" : "Unmarked"} ${p.display_name || p.email} as a test account` });
    await load();
  };

  // Hard delete: erase the player and all their data permanently.
  const deletePlayer = async (p: any) => {
    const typed = prompt(`PERMANENTLY DELETE ${p.display_name || p.email} and ALL their rounds and scores?\n\nThis cannot be undone. Type DELETE to confirm.`);
    if (typed !== "DELETE") return;
    // Remove their rounds (and holes cascade if FK set), group memberships, then profile.
    let { data: rs, error: rE } = await supabase.from("rounds").select("id").eq("user_id", p.id).is("deleted_at", null);
    if (rE) { const rt = await supabase.from("rounds").select("id").eq("user_id", p.id); rs = rt.data; }
    const roundIds = (rs || []).map((r: any) => r.id);
    if (roundIds.length) { await supabase.from("holes").delete().in("round_id", roundIds); }
    await supabase.from("rounds").delete().eq("user_id", p.id);
    await supabase.from("game_players").delete().eq("user_id", p.id);
    await supabase.from("group_members").delete().eq("user_id", p.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "player_deleted", summary: `Permanently deleted ${p.display_name || p.email}` });
    await supabase.from("profiles").delete().eq("id", p.id);
    await load();
  };

  // Approve a pending group request → it becomes active and appears for its members.
  const approveGroup = async (g: any) => {
    await supabase.from("groups").update({ status: "active" }).eq("id", g.id);
    if (g.created_by) await notify(g.created_by, `Your club "${g.name}" was approved. It's now active.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "group_approved", group_id: g.id, summary: `Approved the club "${g.name}"` });
    await load();
  };

  // Decline a request → mark declined (kept for the record) and notify the requester.
  const declineGroup = async (g: any) => {
    if (!confirm(`Decline the club request "${g.name}"?`)) return;
    await supabase.from("groups").update({ status: "declined" }).eq("id", g.id);
    if (g.created_by) await notify(g.created_by, `Your club request "${g.name}" was declined.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "group_declined", summary: `Declined the group request "${g.name}"` });
    await load();
  };

  const restoreCourse = async (c: any) => {
    await supabase.from("favorite_courses").update({ deleted: false, deleted_by: null, deleted_at: null }).eq("id", c.id);
    if (c.deleted_by && c.deleted_by !== user.id) {
      await notify(c.deleted_by, `An admin restored the course "${c.name}" you deleted.`);
    }
    await load();
  };

  const now = Date.now();
  const active24 = (profiles || []).filter((p) => p.last_active && now - +new Date(p.last_active) < 86400000).length;
  const active7d = (profiles || []).filter((p) => p.last_active && now - +new Date(p.last_active) < 7 * 86400000).length;

  const saveHandicap = async (p: any) => {
    const raw = edits[p.id];
    if (raw === undefined) return;
    const idx = raw.trim() === "" ? null : parseFloat(raw);
    setSavingId(p.id);
    await supabase.from("profiles").update({ handicap_index: idx }).eq("id", p.id);
    // Notify both the player and the admin.
    const who = p.display_name || "a player";
    await notify(p.id, `Your handicap index was set to ${idx ?? "—"} by an admin.`);
    await notify(user.id, `You changed ${who}'s handicap index to ${idx ?? "—"}.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "handicap_changed", target_user_id: p.id, summary: `Set ${who}'s handicap index to ${idx ?? "—"}` });
    setSavingId(null);
    await load();
  };

  if (scoringFor) {
    return <AdminScoreEditor admin={user} player={scoringFor} onBack={() => setScoringFor(null)} />;
  }

  return (
    <div style={{ marginTop: 24 }}>
      {showAnalytics && (
        <>
          <Eyebrow>★ ADMIN · ANALYTICS</Eyebrow>
          <AdminAnalytics />
          <AdminExtraStats />
          <AdminDailyReport />
          <AdminEngagement />
          <AdminPowerUsers />
          <OpsMetrics />
          <RoundSaveDiag />
          <div style={{ height: 22 }} />
        </>
      )}
      <Eyebrow>★ ADMIN · ALL PLAYERS</Eyebrow>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
        <div style={{ background: C.greenLight, borderRadius: 12, padding: "10px 14px", flex: 1, minWidth: 110 }}>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{profiles?.length ?? "—"}{hasMore ? "+" : ""}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>{query ? "Matches loaded" : "Users loaded"}</div>
        </div>
        <div style={{ background: C.greenLight, borderRadius: 12, padding: "10px 14px", flex: 1, minWidth: 110 }}>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{active24}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>Active 24h</div>
        </div>
        <div style={{ background: C.greenLight, borderRadius: 12, padding: "10px 14px", flex: 1, minWidth: 110 }}>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{active7d}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>Active 7d</div>
        </div>
      </div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 10 }}>Adjust any player's handicap; they (and you) get a notification. To edit a player's scores, use “Edit scores” to enter admin mode on their rounds.</div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setQuery(search); }}
          placeholder="Search players by name or email…"
          style={{ ...inputStyle, flex: 1, minWidth: 200 }}
        />
        <button style={{ ...btn(true), fontSize: 13 }} onClick={() => setQuery(search)}>Search</button>
        {query && <button style={{ ...btn(false), fontSize: 13 }} onClick={() => { setSearch(""); setQuery(""); }}>Clear</button>}
      </div>

      {profiles === null && <div style={{ color: C.sage, marginTop: 12 }}>Loading…</div>}
      {profiles?.map((p) => (
        <div key={p.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Avatar src={p.avatar_url} name={p.display_name || p.email || "?"} size={40} />
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ color: C.ink, fontWeight: 700 }}>{p.display_name || "Golfer"}{p.id === user.id ? " (you)" : ""}{p.is_admin ? " ★" : ""}</div>
            <div style={{ color: C.faint, fontSize: 12 }}>
              {p.email || "no email"}{p.phone ? ` · ${p.phone}` : ""}{p.ghin_number ? ` · GHIN ${p.ghin_number}` : ""}
            </div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
              Handicap: {p.handicap_index != null ? p.handicap_index : "—"}
            </div>
            {(() => {
              const mine = memberships.filter((m) => m.user_id === p.id);
              if (mine.length === 0) return <div style={{ color: C.birdie, fontSize: 12, marginTop: 2 }}>Clubs: none</div>;
              return (
                <div style={{ color: C.green, fontSize: 12, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ color: C.faint }}>Clubs:</span>
                  {mine.map((m) => {
                    const g = allGroups.find((x) => x.id === m.group_id);
                    return (
                      <span key={m.id} style={{ background: C.greenLight, color: C.cream, borderRadius: 12, padding: "1px 9px", fontSize: 11, fontWeight: 700 }}>
                        {g?.name || "Club"}{m.role === "admin" ? " ★" : ""}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>active {timeAgo(p.last_active)}</div>
          </div>
          <div>
            <label style={{ color: C.sage, fontSize: 11 }}>Handicap index</label>
            <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
              <input inputMode="decimal" defaultValue={p.handicap_index != null ? String(p.handicap_index) : ""}
                onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setEdits((m) => ({ ...m, [p.id]: v })); }}
                style={{ ...inputStyle, padding: "6px 8px", width: 80, textAlign: "center" }} />
              <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12, opacity: savingId === p.id ? 0.5 : 1 }} disabled={savingId === p.id} onClick={() => saveHandicap(p)}>Save</button>
            </div>
          </div>
          <button style={{ ...btn(false), padding: "6px 12px", fontSize: 12 }} onClick={() => setScoringFor(p)}>Edit scores</button>
          <button style={{ ...btn(false), padding: "6px 12px", fontSize: 12 }} onClick={() => setManageGroupsFor(manageGroupsFor === p.id ? null : p.id)}>
            {manageGroupsFor === p.id ? "Close" : "Manage"}
          </button>
          {p.deactivated && <span style={{ color: C.birdie, fontSize: 11, fontWeight: 800 }}>DEACTIVATED</span>}

          {manageGroupsFor === p.id && (
            <div style={{ width: "100%", background: C.greenLight, borderRadius: 10, padding: 12, marginTop: 8 }}>
              <Eyebrow>CLUBS</Eyebrow>
              {(() => {
                const mine = memberships.filter((m) => m.user_id === p.id);
                const myGroupIds = new Set(mine.map((m) => m.group_id));
                return (
                  <>
                    {mine.length === 0 && <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>Not in any club.</div>}
                    {mine.map((m) => {
                      const g = allGroups.find((x) => x.id === m.group_id);
                      return (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.greenMid}` }}>
                          <span style={{ flex: 1, color: C.cream, fontSize: 13 }}>{g?.name || "Club"}{m.role === "admin" ? " · admin" : ""}</span>
                          <button style={{ ...btn(false), padding: "4px 10px", fontSize: 11, color: C.birdie }} onClick={() => removeFromGroup(p, m, g?.name || "this club")}>Remove</button>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ color: C.sage, fontSize: 11 }}>Add to club:</label>
                      <select defaultValue="" onChange={(e) => { if (e.target.value) { addToGroup(p, e.target.value); e.target.value = ""; } }}
                        style={{ ...inputStyle, padding: "6px 8px", fontSize: 12, maxWidth: 180 }}>
                        <option value="">Select…</option>
                        {allGroups.filter((g) => !myGroupIds.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>

                    <div style={{ borderTop: `1px solid ${C.greenMid}`, marginTop: 12, paddingTop: 10 }}>
                      <Eyebrow>ANALYTICS</Eyebrow>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                        <div style={{ flex: 1, color: C.cream, fontSize: 12 }}>
                          Test account {p.is_test ? "· ON" : "· off"}
                          <div style={{ color: C.sage, fontSize: 11, marginTop: 2 }}>Hidden from every analytics figure; the app works normally. Use for a second account you test with.</div>
                        </div>
                        <button style={{ ...btn(!!p.is_test), padding: "7px 12px", fontSize: 12, whiteSpace: "nowrap" }} onClick={() => toggleTestPlayer(p)}>{p.is_test ? "Turn off" : "Mark as test"}</button>
                      </div>
                    </div>

                    <div style={{ borderTop: `1px solid ${C.greenMid}`, marginTop: 12, paddingTop: 10 }}>
                      <Eyebrow>REMOVE FROM APP</Eyebrow>
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                        {p.deactivated ? (
                          <button style={{ ...btn(true), padding: "7px 12px", fontSize: 12 }} onClick={() => reactivatePlayer(p)}>Reactivate</button>
                        ) : (
                          <button style={{ background: "#7A4E18", color: "#F6E9D6", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }} onClick={() => deactivatePlayer(p)}>
                            Deactivate (keep data)
                          </button>
                        )}
                        <button style={{ background: "#5A1E1E", color: "#F6DEDB", border: "none", borderRadius: 8, padding: "7px 12px", fontWeight: 700, cursor: "pointer", fontSize: 12 }} onClick={() => deletePlayer(p)}>
                          Delete permanently
                        </button>
                      </div>
                      <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>
                        Deactivate removes them from all groups and blocks access but keeps history (reversible). Delete erases the player and all their rounds for good.
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </div>
      ))}
      {hasMore && (
        <button style={{ ...btn(false), marginTop: 10, fontSize: 13, opacity: loadingMore ? 0.5 : 1 }} disabled={loadingMore} onClick={loadMorePlayers}>
          {loadingMore ? "Loading…" : "Load more players"}
        </button>
      )}

      <div style={{ marginTop: 20 }}>
        <Eyebrow>★ CLUB REQUESTS{pendingGroups.length ? ` (${pendingGroups.length})` : ""}</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
          New clubs need your approval. Approve to make a club active for its members, or decline the request.
        </div>
        {pendingGroups.length === 0 && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 8, color: C.sage }}>No pending requests.</div>
        )}
        {pendingGroups.map((g) => (
          <div key={g.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 180 }}>
              <div style={{ color: C.ink, fontWeight: 700 }}>{g.name}</div>
              <div style={{ color: C.faint, fontSize: 12 }}>
                from {g.requester?.display_name || g.requester?.email || "a member"}{g.request_note ? ` · "${g.request_note}"` : ""}
              </div>
            </div>
            <button style={{ ...btn(true), padding: "7px 12px", fontSize: 12 }} onClick={() => approveGroup(g)}>Approve</button>
            <button style={{ ...btn(false), padding: "7px 12px", fontSize: 12, color: C.birdie }} onClick={() => declineGroup(g)}>Decline</button>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <Eyebrow>★ DELETED COURSES</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
          Courses anyone has deleted are archived here. Restore one to return it to the shared library.
        </div>
        {deletedCourses.length === 0 && (
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 16, marginTop: 8, color: C.sage }}>No deleted courses.</div>
        )}
        {deletedCourses.map((c) => (
          <div key={c.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 160 }}>
              <div style={{ color: C.ink, fontWeight: 700 }}>{c.name}</div>
              <div style={{ color: C.faint, fontSize: 12 }}>{c.location ? c.location + " · " : ""}deleted {timeAgo(c.deleted_at)}</div>
            </div>
            <button style={{ ...btn(true), padding: "6px 14px", fontSize: 12 }} onClick={() => restoreCourse(c)}>Restore</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ================= Notification bell =================
export function NotificationBell({ user, onSeeAll, onNavigate }: { user: any; onSeeAll?: () => void; onNavigate?: (link?: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    setItems(data || []);
  }, [user.id]);
  useEffect(() => { load(); }, [load]);

  const unread = items.filter((n) => !n.read).length;

  const openPanel = () => setOpen((v) => !v); // opening no longer auto-marks read — unread stays bold until acknowledged
  const markAllRead = async () => {
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  };
  const markOne = async (id: string) => {
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try { await supabase.from("notifications").update({ read: true }).eq("id", id); } catch { /* no-op */ }
  };
  const fmtNotifTime = (iso: string | null) => {
    if (!iso) return "";
    return `${timeAgo(iso)} · ${new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={openPanel} style={{ ...btn(false), fontSize: 14, padding: "8px 12px", position: "relative" }}>
        🔔
        {unread > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, background: C.birdie, color: "#fff", borderRadius: 10, fontSize: 11, fontWeight: 800, padding: "1px 6px" }}>{unread}</span>
        )}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 80 }} />
          <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, maxWidth: 440, margin: "0 auto", zIndex: 90,
            background: C.greenMid, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "82vh",
            display: "flex", flexDirection: "column", boxShadow: "0 -10px 40px rgba(0,0,0,.5)",
            paddingBottom: "calc(72px + env(safe-area-inset-bottom))" }}>
            <div style={{ width: 40, height: 4, background: C.greenLight, borderRadius: 2, margin: "8px auto 4px", flexShrink: 0 }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.08)", flexShrink: 0 }}>
              <Eyebrow style={{ margin: 0 }}>NOTIFICATIONS</Eyebrow>
              <span style={{ flex: 1 }} />
              {unread > 0 && (
                <button onClick={markAllRead} style={{ background: "none", border: "none", color: C.sage, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "4px 6px" }}>Mark all read</button>
              )}
              <button onClick={() => setOpen(false)} aria-label="Close" style={{ background: C.greenLight, border: "none", color: C.cream, width: 30, height: 30, borderRadius: 15, fontSize: 17, fontWeight: 800, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
            </div>
            <div style={{ overflowY: "auto", padding: "2px 8px 8px" }}>
              {items.length === 0 && <div style={{ color: C.sage, fontSize: 13, padding: 18, textAlign: "center" }}>Nothing yet.</div>}
              {items.map((n) => (
                <div key={n.id} onClick={() => { if (!n.read) markOne(n.id); if (n.link && onNavigate) { setOpen(false); onNavigate(n.link); } }}
                  style={{ padding: "11px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 9, cursor: (n.link || !n.read) ? "pointer" : "default" }}>
                  <span style={{ width: 7, height: 7, borderRadius: 4, background: n.read ? "transparent" : C.gold, marginTop: 5, flexShrink: 0 }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ color: n.read ? "#CFC9B4" : C.cream, fontSize: 13, lineHeight: 1.4, fontWeight: n.read ? 500 : 800 }}>{n.message}</div>
                    <div style={{ color: C.sage, fontSize: 11, marginTop: 3 }}>{fmtNotifTime(n.created_at)}</div>
                  </div>
                  {n.link ? <span style={{ color: C.sage, fontSize: 18, alignSelf: "center", flexShrink: 0 }}>›</span> : null}
                </div>
              ))}
              {onSeeAll && (
                <button onClick={() => { setOpen(false); onSeeAll(); }} style={{ width: "100%", marginTop: 8, background: "none", border: "none", color: C.gold, fontSize: 13, fontWeight: 700, cursor: "pointer", padding: "10px 0" }}>See all notifications →</button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// Exported so other parts of the app (e.g. admin score edits) can raise notifications.
export { notify };

// ================= Notifications screen (full history) =================
// A user's complete notification history, paginated. The bell shows the recent 30 as a quick
// peek; this is the durable record so nothing sent to a user is ever out of reach.
export function NotificationsScreen({ user, onNavigate }: { user: any; onNavigate?: (link?: string | null) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const load = useCallback(async (lim: number) => {
    setLoading(true);
    const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(lim);
    setItems(data || []);
    setHasMore((data || []).length === lim);
    setLoading(false);
  }, [user.id]);
  useEffect(() => { load(limit); }, [load, limit]);

  const unread = items.filter((n) => !n.read).length;
  const markAllRead = async () => {
    setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
  };
  const markOne = async (id: string) => {
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, read: true } : n)));
    try { await supabase.from("notifications").update({ read: true }).eq("id", id); } catch { /* no-op */ }
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <h2 style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800 }}>Notifications</h2>
        <span style={{ flex: 1 }} />
        {unread > 0 && <button onClick={markAllRead} style={{ ...btn(false), fontSize: 13, padding: "7px 12px" }}>Mark all read</button>}
      </div>
      <div style={{ color: C.sage, fontSize: 13, marginTop: 4, marginBottom: 12 }}>{unread > 0 ? `${unread} unread` : "All caught up"}</div>
      {loading && items.length === 0 ? (
        <div style={{ color: C.sage, fontSize: 14, padding: 20, textAlign: "center" }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 28, color: C.sage, textAlign: "center" }}>No notifications yet. Anything sent your way will show up here.</div>
      ) : (
        <>
          {items.map((n) => (
            <div key={n.id} onClick={() => { if (!n.read) markOne(n.id); if (n.link && onNavigate) onNavigate(n.link); }}
              style={{ background: C.card, borderRadius: 12, padding: "13px 16px", marginTop: 10, display: "flex", gap: 11, cursor: (n.link || !n.read) ? "pointer" : "default" }}>
              <span style={{ width: 8, height: 8, borderRadius: 4, background: n.read ? "transparent" : C.gold, marginTop: 6, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ color: n.read ? "#6B6857" : C.ink, fontSize: 14, lineHeight: 1.4, fontWeight: n.read ? 500 : 800 }}>{n.message}</div>
                <div style={{ color: C.faint, fontSize: 11, marginTop: 3 }}>{notifWhen(n.created_at)}</div>
              </div>
              {n.link ? <span style={{ color: C.faint, fontSize: 20, alignSelf: "center", flexShrink: 0 }}>›</span> : null}
            </div>
          ))}
          {hasMore && (
            <button onClick={() => setLimit((l) => l + 30)} style={{ ...btn(false), width: "100%", marginTop: 12, fontSize: 13 }}>Load older</button>
          )}
        </>
      )}
      <div style={{ color: C.faint, fontSize: 12, textAlign: "center", marginTop: 18, lineHeight: 1.5 }}>
        Notifications are kept for 90 days, then removed automatically.
      </div>
    </div>
  );
}

// ================= Admin score editor =================
// Lets an admin browse a player's rounds and edit hole scores/putts.
// Saving notifies both the player and the admin.
function AdminScoreEditor({ admin, player, onBack }: { admin: any; player: any; onBack: () => void }) {
  const [rounds, setRounds] = useState<Round[] | null>(null);
  const [editing, setEditing] = useState<Round | null>(null);
  const [holes, setHoles] = useState<Hole[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    let { data: rs, error: rE2 } = await supabase.from("rounds").select("*").eq("user_id", player.id).is("deleted_at", null).order("played_at", { ascending: false });
    if (rE2) { const rt = await supabase.from("rounds").select("*").eq("user_id", player.id).order("played_at", { ascending: false }); rs = rt.data; }
    if (!rs) { setRounds([]); return; }
    const ids = rs.map((r: any) => r.id);
    const { data: hs } = await supabase.from("holes").select("*").in("round_id", ids.length ? ids : ["none"]);
    const byRound: Record<string, Hole[]> = {};
    (hs || []).forEach((h: any) => { (byRound[h.round_id] ||= []).push(h); });
    const merged: Round[] = rs.map((r: any) => ({
      ...r,
      holes: dedupeHoles(byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number)
        .map((h) => ({ ...h, recv: strokesReceived(h.stroke_index, r.course_handicap) })),
    }));
    setRounds(merged);
  }, [player.id]);
  useEffect(() => { load(); }, [load]);

  const openRound = (r: Round) => { setEditing(r); setHoles(r.holes.map((h) => ({ ...h }))); setMsg(null); };
  const setHole = (i: number, patch: Partial<Hole>) => setHoles((hs) => hs.map((h, j) => (j === i ? { ...h, ...patch } : h)));

  const saveRound = async () => {
    if (!editing) return;
    setSaving(true); setMsg(null);
    try {
      for (const h of holes) {
        const { error } = await supabase.from("holes")
          .update({ strokes: h.strokes, putts: h.putts, fairway: h.fairway, penalties: h.penalties })
          .eq("round_id", editing.id).eq("hole_number", h.hole_number);
        if (error) throw error;
      }
      const who = player.display_name || "the player";
      await notify(player.id, `An admin edited your scores for ${editing.course} (${fmtDate(editing.played_at)}).`);
      await notify(admin.id, `You edited ${who}'s scores for ${editing.course} (${fmtDate(editing.played_at)}).`);
      setMsg("Saved & player notified ✓");
      await load();
      setEditing(null);
    } catch (e: any) {
      setMsg("Couldn't save: " + (e.message || "error"));
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button style={btn(false)} onClick={() => setEditing(null)}>‹ Back</button>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20 }}>Admin edit · {player.display_name}</div>
        </div>
        <div style={{ background: "#5A1E1E", color: "#F6DEDB", borderRadius: 10, padding: "8px 12px", marginTop: 10, fontSize: 12 }}>
          ⚠ Admin mode — you are editing another player's official scores. They will be notified.
        </div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 10 }}>{editing.course}{editing.tee_name ? ` · ${editing.tee_name}` : ""} · {fmtDate(editing.played_at)}</div>
        <div style={{ background: C.card, borderRadius: 12, padding: 12, marginTop: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "44px 40px 1fr 1fr", gap: 6, padding: "0 2px 6px", color: C.faint, fontSize: 11, letterSpacing: 1, fontWeight: 700, borderBottom: `1px solid ${C.line}` }}>
            <div>HOLE</div><div style={{ textAlign: "center" }}>PAR</div><div style={{ textAlign: "center" }}>SCORE</div><div style={{ textAlign: "center" }}>PUTTS</div>
          </div>
          {holes.map((h, i) => {
            const subtotalAfter = (i === 8 && holes.length > 9) || i === holes.length - 1;
            const segStart = i < 9 ? 0 : 9;
            const seg = holes.slice(segStart, i + 1);
            const sPar = seg.reduce((s, x) => s + (x.par || 0), 0);
            const sScore = seg.reduce((s, x) => s + (x.strokes || 0), 0);
            const sPutts = seg.reduce((s, x) => s + (x.putts || 0), 0);
            return (
              <React.Fragment key={i}>
                <div style={{ display: "grid", gridTemplateColumns: "44px 40px 1fr 1fr", gap: 6, alignItems: "center", padding: "5px 2px", borderBottom: `1px solid ${C.line}` }}>
                  <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{h.hole_number}</div>
                  <div style={{ textAlign: "center", color: C.parBlue, fontWeight: 700 }}>{h.par}</div>
                  <div style={{ textAlign: "center" }}>
                    <NumPicker value={h.strokes} from={1} to={h.par * 2 + (editing.course_handicap != null ? (h.recv || 0) : 0)} onChange={(v) => setHole(i, { strokes: v })} width={52} />
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <NumPicker value={h.putts} from={0} to={h.strokes && h.strokes > 0 ? Math.min(h.strokes, 6) : 6} onChange={(v) => setHole(i, { putts: v })} width={52} />
                  </div>
                </div>
                {subtotalAfter && (
                  <div style={{ display: "grid", gridTemplateColumns: "44px 40px 1fr 1fr", gap: 6, padding: "6px 2px", background: C.greenLight, borderTop: `2px solid ${C.greenMid}`, fontWeight: 800 }}>
                    <div style={{ color: C.gold, fontSize: 11 }}>{segStart === 0 ? "OUT" : "IN"}</div>
                    <div style={{ textAlign: "center", color: C.ink }}>{sPar}</div>
                    <div style={{ textAlign: "center", color: C.green }}>{sScore || "–"}</div>
                    <div style={{ textAlign: "center", color: C.faint }}>{sPutts || "–"}</div>
                  </div>
                )}
              </React.Fragment>
            );
          })}
          {holes.length > 9 && (() => {
            const tot = holes.reduce((s, x) => s + (x.strokes || 0), 0);
            const totPutts = holes.reduce((s, x) => s + (x.putts || 0), 0);
            return (
              <div style={{ display: "grid", gridTemplateColumns: "44px 40px 1fr 1fr", gap: 6, padding: "7px 2px", background: C.green, fontWeight: 800 }}>
                <div style={{ color: C.cream, fontSize: 11 }}>TOTAL</div>
                <div />
                <div style={{ textAlign: "center", color: "#fff" }}>{tot || "–"}</div>
                <div style={{ textAlign: "center", color: C.cream }}>{totPutts || "–"}</div>
              </div>
            );
          })()}
        </div>
        {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>{msg}</div>}
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          <button style={btn(false)} onClick={() => setEditing(null)}>Cancel</button>
          <button style={{ ...btn(true), opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={saveRound}>{saving ? "Saving…" : "Save changes"}</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button style={btn(false)} onClick={onBack}>‹ Players</button>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20 }}>{player.display_name}'s rounds</div>
      </div>
      {rounds === null && <div style={{ color: C.sage, marginTop: 12 }}>Loading…</div>}
      {rounds?.length === 0 && <div style={{ color: C.sage, marginTop: 12 }}>This player has no rounds.</div>}
      {rounds?.map((r) => (
        <div key={r.id} onClick={() => openRound(r)} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, cursor: "pointer", display: "flex", alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.ink, fontWeight: 700 }}>{r.course}</div>
            <div style={{ color: C.faint, fontSize: 12 }}>{fmtDate(r.played_at)} · {played(r).length} holes</div>
          </div>
          <div style={{ color: C.green, fontWeight: 800, fontFamily: "Georgia, serif", fontSize: 18 }}>{played(r).length ? strokesOf(r) : "—"}</div>
        </div>
      ))}
    </div>
  );
}

// ================= Players directory =================
// Everyone can see who else has access: name, handicap (if set), and phone to reach them.
export function PlayersTab({ user, activeGroupId, isGroupAdmin, onChanged }: { user: any; activeGroupId: string; isGroupAdmin: boolean; onChanged?: () => void }) {
  const [players, setPlayers] = useState<any[] | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [cardMember, setCardMember] = useState<any | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("group_members")
      .select("id, user_id, email, role, status, avatar_url")
      .eq("group_id", activeGroupId)
      .neq("status", "removed")
      .order("role")
      .order("email");
    const rows = data || [];
    const ids = rows.map((r: any) => r.user_id).filter(Boolean);
    let profilesById: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name, handicap_index, phone, ghin_number").in("id", ids);
      profilesById = Object.fromEntries((profs || []).map((p: any) => [p.id, p]));
    }
    setPlayers(rows.map((r: any) => ({ ...r, profiles: r.user_id ? profilesById[r.user_id] || null : null })));
  }, [activeGroupId]);
  useEffect(() => { load(); }, [load]);

  // Group admin: set a member's handicap index (updates their profile; notifies them).
  const saveHandicap = async (row: any) => {
    const raw = edits[row.id];
    if (raw === undefined || !row.user_id) return;
    const idx = raw.trim() === "" ? null : parseFloat(raw);
    setBusyId(row.id); setMsg(null);
    const { error } = await supabase.from("profiles").update({ handicap_index: idx }).eq("id", row.user_id);
    if (error) { setMsg("Couldn't update handicap: " + error.message); setBusyId(null); return; }
    if (row.user_id !== user.id) await notify(row.user_id, `Your handicap index was set to ${idx ?? "—"} by a group admin.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "handicap_changed", group_id: activeGroupId, target_user_id: row.user_id, summary: `Set ${row.profiles?.display_name || row.email}'s handicap to ${idx ?? "—"}` });
    setBusyId(null);
    await load();
    setMsg("Handicap updated.");
  };

  // Group admin: promote/demote within the group.
  const toggleRole = async (row: any) => {
    setBusyId(row.id); setMsg(null);
    await supabase.from("group_members").update({ role: row.role === "admin" ? "member" : "admin" }).eq("id", row.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "role_changed", group_id: activeGroupId, target_user_id: row.user_id, summary: `Changed ${row.profiles?.display_name || row.email} to ${row.role === "admin" ? "member" : "club admin"}` });
    setBusyId(null);
    await load(); onChanged?.();
  };

  // Group admin: remove a member from THIS group (does not delete their account or other groups).
  const removeFromGroup = async (row: any) => {
    if (!confirm(`Remove ${row.profiles?.display_name || row.email} from this club?\n\nThis only affects this club — their account and other clubs are untouched.`)) return;
    setBusyId(row.id); setMsg(null);
    await supabase.from("group_members").update({ status: "removed" }).eq("id", row.id);
    if (row.user_id && row.user_id !== user.id) await notify(row.user_id, `You were removed from a group by an admin.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "member_removed", group_id: activeGroupId, target_user_id: row.user_id, summary: `Removed ${row.profiles?.display_name || row.email} from a group` });
    setBusyId(null);
    await load(); onChanged?.();
  };

  return (
    <div>
      <Eyebrow>PLAYERS · CURRENT CLUB</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Members and invited players in the selected group. Tap a phone number to call or text.
        {isGroupAdmin ? " As a club admin you can set handicaps, change roles, and remove players from this club." : ""}
      </div>
      {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>{msg}</div>}
      {players === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
      {players?.length === 0 && <div style={{ color: C.sage, marginTop: 14 }}>No players yet.</div>}
      {players?.map((row: any) => {
        const p = row.profiles || {};
        const self = row.user_id === user.id;
        return (
          <div key={row.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <button
                onClick={() => row.user_id && setCardMember(row)}
                disabled={!row.user_id}
                title={row.user_id ? "View player card" : undefined}
                style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, minWidth: 150, background: "transparent", border: "none", padding: 0, textAlign: "left", cursor: row.user_id ? "pointer" : "default" }}
              >
                <Avatar src={row.avatar_url} name={p.display_name || row.email || "?"} size={48} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{p.display_name || row.email}{self ? " (you)" : ""}{row.role === "admin" ? " · admin" : ""}</div>
                  <div style={{ color: C.faint, fontSize: 12 }}>
                    {p.handicap_index != null ? `Handicap ${p.handicap_index}` : row.status === "invited" ? "Invited" : "No handicap set"}
                    {p.ghin_number ? ` · GHIN ${p.ghin_number}` : ""}
                  </div>
                </div>
              </button>
              {p.phone ? (
                <a href={`tel:${p.phone}`} style={{ color: C.green, fontWeight: 700, fontSize: 14, textDecoration: "none", background: C.cream, borderRadius: 8, padding: "8px 12px" }}>{p.phone}</a>
              ) : !p.display_name ? (
                <span style={{ color: C.faint, fontSize: 12 }}>{row.email}</span>
              ) : null}
            </div>

            {isGroupAdmin && row.user_id && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap", borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                <div>
                  <label style={{ color: C.sage, fontSize: 11 }}>Handicap index</label>
                  <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
                    <input inputMode="decimal" defaultValue={p.handicap_index != null ? String(p.handicap_index) : ""}
                      onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setEdits((m) => ({ ...m, [row.id]: v })); }}
                      style={{ ...inputStyle, padding: "6px 8px", width: 78, textAlign: "center" }} />
                    <button style={{ ...btn(true), padding: "6px 10px", fontSize: 12, opacity: busyId === row.id ? 0.5 : 1 }} disabled={busyId === row.id} onClick={() => saveHandicap(row)}>Set</button>
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                {!self && (
                  <>
                    <button style={{ ...btn(false), padding: "7px 10px", fontSize: 12 }} disabled={busyId === row.id} onClick={() => toggleRole(row)}>{row.role === "admin" ? "Remove club admin" : "Make club admin"}</button>
                    <button style={{ ...btn(false), padding: "7px 10px", fontSize: 12, color: C.birdie }} disabled={busyId === row.id} onClick={() => removeFromGroup(row)}>Remove</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
      {cardMember && <PeerCardModal member={cardMember} groupId={activeGroupId} viewerUserId={user.id} onClose={() => setCardMember(null)} />}
    </div>
  );
}

// ================= Admin Activity (audit trail) =================
// System tools (master admin): test-account toggle + course yardage backfill.
function SystemTools({ user }: { user: any }) {
  const [isTest, setIsTest] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    supabase.from("profiles").select("is_test").eq("id", user.id).maybeSingle().then(({ data }: any) => setIsTest(!!data?.is_test));
  }, [user.id]);
  return (
    <div>
      <div style={{ background: C.greenLight, borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>Test account {isTest == null ? "" : isTest ? "· ON" : "· off"}</div>
            <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
              When on, this account works normally but is excluded from every analytics figure — use it for feature testing so your stats stay clean.
            </div>
          </div>
          <button
            onClick={async () => {
              const next = !isTest; setIsTest(next);
              const { error } = await supabase.rpc("admin_set_test", { p_user: user.id, p_is_test: next });
              if (error) { setIsTest(!next); setMsg("Couldn't update test mode — " + error.message); }
            }}
            style={{ ...btn(!!isTest), fontSize: 12, padding: "8px 14px", whiteSpace: "nowrap" }}
          >{isTest ? "Turn off" : "Turn on"}</button>
        </div>
        {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>{msg}</div>}
      </div>
      <div style={{ marginTop: 14 }}><YardageBackfill /></div>
    </div>
  );
}

// Consolidated admin hub. Two tiers: Club admin (any admin of the active club, scoped to
// that club) and System Admin (master only). Reuses every existing panel;
// club cards jump to the shared tabs, system cards render the panel inline.
// ★ Stage-2 analytics: new drillable summary tiles (platform, notifications, sharing, guests).
// Counts from get_admin_extra_stats (0091); every tile drills via the shared engine (0090).
function AdminExtraStats() {
  const [x, setX] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    supabase.rpc("get_admin_extra_stats").then(({ data, error }: any) => {
      if (error) setErr(error.message); else setX(data);
    });
  }, []);
  if (err || !x) return null; // supplementary; stays hidden until 0091 is deployed

  const tile = (n: React.ReactNode, l: string, stat: string, cap?: string, arg?: string) => (
    <button onClick={() => openStatDrill({ stat, title: l, cap, arg })}
      style={{ background: C.greenLight, border: "none", borderRadius: 12, padding: "11px 12px", flex: 1, minWidth: 92, textAlign: "left", color: C.cream, cursor: "pointer", position: "relative" }}>
      <span style={{ position: "absolute", right: 8, top: 8, color: C.gold, fontSize: 11, fontWeight: 800 }}>who ›</span>
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{n}</div>
      <div style={{ color: C.sage, fontSize: 11 }}>{l}</div>
    </button>
  );
  const hdr = (t: string, c: string) => (
    <div style={{ margin: "18px 0 8px" }}>
      <span style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, color: C.cream }}>{t}</span>
      <span style={{ color: C.sage, fontSize: 11 }}> · {c}</span>
    </div>
  );

  const mutes: Record<string, number> = x.mutes || {};
  const mutedTypes = NOTIF_TYPES.map((t) => ({ ...t, n: mutes[t.key] || 0 })).filter((t) => t.n > 0).sort((a, b) => b.n - a.n);

  return (
    <div>
      {hdr("Platform", "how people open BNN")}
      <div style={{ display: "flex", gap: 10 }}>
        {tile(x.installed ?? 0, "Installed app", "installed", "Latest open = home-screen app")}
        {tile(x.browser ?? 0, "Browser only", "browser", "Latest open = browser tab")}
      </div>
      <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>
        {x.platform_unknown ? `${x.platform_unknown} not yet recorded \u00b7 ` : ""}counts forward from launch — no backfill.
      </div>

      {hdr("Notifications", "push reach & health")}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {tile(x.notif_on ?? 0, "Notifications on", "notif_on", "Has an active push device")}
        {tile(x.notif_off ?? 0, "Off / none", "notif_off", "No active push device")}
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        {tile(x.failing_subs ?? 0, "Failing / stale devices", "failing_subs", "Push not being delivered")}
      </div>
      {mutedTypes.length ? (
        <>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 12, marginBottom: 2 }}>Most-muted types (tap for who)</div>
          <div style={{ background: C.greenLight, borderRadius: 12, padding: 6 }}>
            {mutedTypes.map((t, i) => (
              <div key={t.key} onClick={() => openStatDrill({ stat: "mute", arg: t.key, title: t.label, cap: "Users who set this to Off" })}
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 10px", borderTop: i ? `1px solid ${C.greenMid}` : "none", cursor: "pointer" }}>
                <span style={{ fontSize: 13, color: C.cream }}>{t.label}</span>
                <span style={{ color: C.gold, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 15 }}>{t.n} ›</span>
              </div>
            ))}
          </div>
        </>
      ) : null}

      {hdr("Profile sharing", "peer-visible player card")}
      <div style={{ display: "flex", gap: 10 }}>
        {tile(x.share_on ?? 0, "Sharing on", "share_on", "Card visible to peers")}
        {tile(x.share_off ?? 0, "Turned off", "share_off", "Opted out of the card")}
      </div>

      {hdr("Guests", "non-registered players")}
      <div style={{ display: "flex", gap: 10 }}>
        {tile(x.guests ?? 0, x.guest_hosts ? `Guest rounds \u00b7 ${x.guest_hosts} hosts` : "Guest rounds", "guests", "Hosts who brought guests")}
      </div>
    </div>
  );
}

// ★ Stage-3 analytics: Daily report. Pick a day; see active users + that day's rounds, both
// drillable. Reuses engine branches active_day / rounds_day (0090) — no new migration. Counts
// are just the length of those lists; the inline list is the rounds_day rows color-coded by status.
function AdminDailyReport() {
  const [days, setDays] = useState<{ label: string; iso: string }[]>([]);
  const [sel, setSel] = useState<string>("");
  const [active, setActive] = useState<any[] | null>(null);
  const [rounds, setRounds] = useState<any[] | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    // Days are US Eastern (America/New_York) for everyone — "Today" is the same midnight-to-midnight
    // window no matter the viewer's device timezone, matching the DAU tiles (which now anchor ET too).
    const east = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()); // YYYY-MM-DD
    const [Y, M, D] = east.split("-").map(Number);
    const arr: { label: string; iso: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const dt = new Date(Date.UTC(Y, M - 1, D)); dt.setUTCDate(dt.getUTCDate() - i);
      const iso = dt.toISOString().slice(0, 10);
      arr.push({ iso, label: i === 0 ? "Today" : i === 1 ? "Yesterday" : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) });
    }
    setDays(arr); setSel(arr[0].iso);
  }, []);

  useEffect(() => {
    if (!sel) return;
    setActive(null); setRounds(null);
    supabase.rpc("admin_stat_users", { p_stat: "active_day", p_arg: null, p_date: sel }).then(({ data, error }: any) => { if (error) setGone(true); else setActive(data || []); });
    supabase.rpc("admin_stat_users", { p_stat: "rounds_day", p_arg: null, p_date: sel }).then(({ data, error }: any) => { if (!error) setRounds(data || []); });
  }, [sel]);

  if (gone) return null;
  const dotColor = (tag: string) =>
    tag === "completed" ? "#5BBE7E" : tag === "in progress" ? C.gold : tag === "auto-finished" ? "#5AA9E6" : tag === "deleted" ? C.birdie : C.sage;
  const selLabel = days.find((d) => d.iso === sel)?.label || sel;
  const dot = (bg: string) => <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: bg, marginRight: 4 }} />;

  return (
    <div>
      <div style={{ margin: "18px 0 8px" }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, color: C.cream }}>Daily report</span>
        <span style={{ color: C.sage, fontSize: 11 }}> · pick a day</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        {days.map((d) => (
          <button key={d.iso} onClick={() => setSel(d.iso)}
            style={{ fontSize: 11, fontWeight: 700, borderRadius: 999, padding: "5px 11px", border: "none", cursor: "pointer",
              background: sel === d.iso ? C.gold : C.greenLight, color: sel === d.iso ? C.green : C.cream }}>{d.label}</button>
        ))}
        <input type="date" value={sel} max={days[0]?.iso} onChange={(e) => setSel(e.target.value)}
          style={{ fontSize: 11, borderRadius: 8, border: `1px solid ${C.greenMid}`, background: C.green, color: C.cream, padding: "4px 8px", WebkitAppearance: "none", appearance: "none" }} />
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 10 }}>
        <button onClick={() => openStatDrill({ stat: "active_day", title: `Active · ${selLabel}`, cap: "Users who opened BNN that day", date: sel })}
          style={{ flex: 1, background: C.greenLight, border: "none", borderRadius: 12, padding: "11px 12px", textAlign: "left", cursor: "pointer", position: "relative" }}>
          <span style={{ position: "absolute", right: 8, top: 8, color: C.gold, fontSize: 11, fontWeight: 800 }}>who ›</span>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{active ? active.length : "…"}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>Active users</div>
        </button>
        <button onClick={() => openStatDrill({ stat: "rounds_day", title: `Rounds · ${selLabel}`, cap: "Rounds played that day", date: sel })}
          style={{ flex: 1, background: C.greenLight, border: "none", borderRadius: 12, padding: "11px 12px", textAlign: "left", cursor: "pointer", position: "relative" }}>
          <span style={{ position: "absolute", right: 8, top: 8, color: C.gold, fontSize: 11, fontWeight: 800 }}>list ›</span>
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{rounds ? rounds.length : "…"}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>Rounds played</div>
        </button>
      </div>

      {rounds && rounds.length > 0 ? (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 6, marginTop: 10 }}>
          {rounds.map((r: any, i: number) => (
            <div key={i} onClick={() => openStatDrill({ stat: "rounds_day", title: `Rounds · ${selLabel}`, cap: "Rounds played that day", date: sel })}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 8px", borderTop: i ? `1px solid ${C.greenMid}` : "none", cursor: "pointer" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", flex: "0 0 8px", background: dotColor(r.tag) }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, color: C.cream, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</div>
                <div style={{ fontSize: 11, color: C.sage }}>{r.detail} · {r.tag}</div>
              </div>
            </div>
          ))}
        </div>
      ) : rounds && rounds.length === 0 ? (
        <div style={{ color: C.faint, fontSize: 12, marginTop: 10 }}>No rounds played on {selLabel}.</div>
      ) : null}

      <div style={{ color: C.faint, fontSize: 11, marginTop: 8, lineHeight: 1.7 }}>
        {dot("#5BBE7E")}completed &nbsp; {dot(C.gold)}in progress &nbsp; {dot("#5AA9E6")}auto-finished &nbsp; {dot(C.birdie)}deleted / issue
        <div style={{ marginTop: 4 }}>Days run midnight–midnight US Eastern.</div>
      </div>
    </div>
  );
}

// ★ Friction review: the daily integrity sweep's findings, with review + resolve. Reads
// get_friction_items / get_friction_rounds and writes via resolve_friction (all is_admin-gated).
const FRICTION_KIND: Record<string, { label: string; bg: string; fg: string }> = {
  dup_day:     { label: "duplicate",   bg: "#5AA9E6",   fg: "#06251a" },
  dup_game:    { label: "game dup",    bg: "#C58BE0",   fg: "#06251a" },
  multi_draft: { label: "multi-draft", bg: C.gold,      fg: C.green },
  integrity:   { label: "integrity",   bg: C.birdie,    fg: "#ffffff" },
};

function FrictionItem({ it, onDone }: { it: any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [rounds, setRounds] = useState<any[] | null>(null);
  const [keep, setKeep] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const isCluster = it.kind === "dup_day" || it.kind === "dup_game" || it.kind === "multi_draft";
  const meta = FRICTION_KIND[it.kind] || { label: it.kind, bg: C.greenMid, fg: C.cream };
  const resolved = it.status === "cleared" || it.status === "auto_resolved" || it.status === "needs_action";

  const expand = async () => {
    const next = !open; setOpen(next);
    if (next && !rounds && isCluster) {
      const { data } = await supabase.rpc("get_friction_rounds", { p_id: it.id });
      const rows = data || []; setRounds(rows);
      const rec = rows.find((r: any) => r.recommended); if (rec) setKeep(rec.round_id);
    }
  };
  const resolve = async (status: string, soft: boolean) => {
    setBusy(true);
    await supabase.rpc("resolve_friction", { p_id: it.id, p_status: status, p_reason: note || null, p_keep: keep, p_soft_delete: soft });
    setBusy(false); onDone();
  };
  const when = it.first_seen ? new Date(it.first_seen).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 12, marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: C.cream }}>{it.subject_name}</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontWeight: 800, borderRadius: 5, padding: "1px 6px", background: meta.bg, color: meta.fg }}>{meta.label}</span>
      </div>
      <div style={{ color: C.cream, fontSize: 12.5, margin: "8px 0 3px", lineHeight: 1.5 }}>{it.detail}</div>
      {resolved ? (
        <div style={{ color: C.faint, fontSize: 11, marginTop: 4 }}>
          {it.status === "auto_resolved" ? "Auto-resolved — the data was cleaned up." : `${it.status === "cleared" ? "Cleared" : "Needs action"}${it.reason ? " · " + it.reason : ""}`}
          {it.reviewed_at ? " · " + new Date(it.reviewed_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : ""}
        </div>
      ) : (
        <>
          <div style={{ color: C.faint, fontSize: 11, marginBottom: 8 }}>first seen {when}</div>
          <button onClick={expand} style={{ background: C.gold, color: C.green, border: "none", borderRadius: 9, padding: "7px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>
            {open ? "Close" : "Review \u2192"}
          </button>
          {open ? (
            <div style={{ borderTop: `1px solid ${C.greenMid}`, marginTop: 10, paddingTop: 10 }}>
              {isCluster ? (
                <>
                  <div style={{ color: C.sage, fontSize: 11, marginBottom: 6 }}>{it.kind === "multi_draft" ? "Which draft to keep (if any)?" : "Which round to keep?"}</div>
                  <div style={{ background: C.green, borderRadius: 9, padding: 6, marginBottom: 8 }}>
                    {(rounds || []).map((r: any) => {
                      const sel = keep === r.round_id;
                      return (
                        <div key={r.round_id} onClick={() => setKeep(r.round_id)}
                          style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 6px", cursor: "pointer" }}>
                          <span style={{ width: 14, height: 14, borderRadius: "50%", flex: "0 0 14px", border: `2px solid ${sel ? C.gold : C.sage}`, background: sel ? C.gold : "transparent" }} />
                          <span style={{ fontSize: 11.5, color: sel ? C.cream : C.sage, flex: 1 }}>
                            {r.course || "round"} · {new Date(r.created_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.scored} holes{r.gross != null ? " \u00b7 gross " + r.gross : ""} · {r.status}
                          </span>
                          {sel ? <span style={{ fontSize: 11, fontWeight: 800, color: C.gold }}>keep</span> : null}
                        </div>
                      );
                    })}
                    {it.kind === "multi_draft" ? (
                      <div onClick={() => setKeep(null)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 6px", cursor: "pointer", borderTop: `1px solid ${C.greenMid}` }}>
                        <span style={{ width: 14, height: 14, borderRadius: "50%", flex: "0 0 14px", border: `2px solid ${keep === null ? C.gold : C.sage}`, background: keep === null ? C.gold : "transparent" }} />
                        <span style={{ fontSize: 11.5, color: keep === null ? C.cream : C.sage }}>Keep none — remove all these drafts</span>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Optional note (e.g. 'v1.135 in-progress inflation bug')"
                style={{ width: "100%", background: C.green, border: `1px solid ${C.greenMid}`, borderRadius: 8, color: C.cream, fontSize: 13, padding: 8, marginBottom: 8, fontFamily: "inherit" }} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {isCluster ? (
                  <>
                    <button disabled={busy} onClick={() => resolve("cleared", true)} style={btnPrimary}>Confirm bug — remove{it.kind === "multi_draft" && keep === null ? " all" : " the rest"}</button>
                    <button disabled={busy} onClick={() => resolve("cleared", false)} style={btnGhost}>Not a problem — keep all</button>
                  </>
                ) : (
                  <button disabled={busy} onClick={() => resolve("cleared", false)} style={btnPrimary}>Acknowledge / fixed</button>
                )}
                <button disabled={busy} onClick={() => resolve("needs_action", false)} style={btnGhost}>Needs action</button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
const btnPrimary: React.CSSProperties = { background: "#5BBE7E", color: "#06251a", border: "none", borderRadius: 9, padding: "8px 12px", fontSize: 12, fontWeight: 800, cursor: "pointer" };
const btnGhost: React.CSSProperties = { background: "transparent", color: C.cream, border: "1px solid #6f8a7e", borderRadius: 9, padding: "8px 12px", fontSize: 12, fontWeight: 700, cursor: "pointer" };

function AdminFrictionReview() {
  const [tab, setTab] = useState<"open" | "needs_action" | "resolved">("open");
  const [items, setItems] = useState<any[] | null>(null);
  const [gone, setGone] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const load = useCallback(() => {
    supabase.rpc("get_friction_items", { p_status: null }).then(({ data, error }: any) => {
      if (error) { setGone(true); return; }
      setItems(data || []);
    });
  }, []);
  useEffect(() => { load(); }, [load]);
  if (gone) return null; // hidden until 0092 is deployed

  const list = items || [];
  const groups = {
    open: list.filter((i) => i.status === "open"),
    needs_action: list.filter((i) => i.status === "needs_action"),
    resolved: list.filter((i) => i.status === "cleared" || i.status === "auto_resolved"),
  };
  const runNow = async () => { setSweeping(true); try { await supabase.rpc("sweep_friction", { p_force: true }); } catch { /* ignore */ } setSweeping(false); load(); };
  const cur = groups[tab];
  const tabBtn = (k: "open" | "needs_action" | "resolved", label: string) => (
    <button onClick={() => setTab(k)} style={{ flex: 1, border: "none", borderRadius: 999, padding: "7px 6px", fontSize: 11.5, fontWeight: 700, cursor: "pointer", background: tab === k ? C.gold : C.greenLight, color: tab === k ? C.green : C.cream }}>
      {label} <span style={{ fontFamily: "Georgia, serif", fontWeight: 800 }}>{groups[k].length}</span>
    </button>
  );

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", margin: "18px 0 4px" }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 16, fontWeight: 700, color: C.cream }}>Friction review</span>
        <button onClick={runNow} disabled={sweeping} style={{ marginLeft: "auto", background: C.greenLight, color: C.sage, border: `1px solid ${C.greenMid}`, borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
          {sweeping ? "Checking\u2026" : "Run check now"}
        </button>
      </div>
      <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 10, lineHeight: 1.5 }}>
        States the app shouldn’t be able to produce. Swept daily; a flag is a to-do, not a mark against a player. Cleared items stay cleared; fixed ones auto-resolve.
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        {tabBtn("open", "Open")}{tabBtn("needs_action", "Needs action")}{tabBtn("resolved", "Resolved")}
      </div>
      {items === null ? (
        <div style={{ color: C.faint, fontSize: 12, padding: "16px 4px" }}>Loading…</div>
      ) : cur.length === 0 ? (
        <div style={{ color: C.faint, fontSize: 13, textAlign: "center", padding: "22px 10px" }}>
          {tab === "open" ? "Nothing to review \u2014 the data looks clean." : tab === "needs_action" ? "No items flagged for follow-up." : "No resolved items yet."}
        </div>
      ) : (
        cur.map((it) => <FrictionItem key={it.id} it={it} onDone={load} />)
      )}
    </div>
  );
}

// Sandbaggers: entered (GHIN) index vs the app's scoring-derived index, flagged at >=20% apart
// once a player has >=18 posted rounds (below that the record is too thin to judge).
function AdminSandbaggers() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    supabase.rpc("admin_sandbaggers").then(({ data, error }: any) => { if (error) setErr(true); else setRows(data || []); });
  }, []);
  if (err) return <div style={{ color: C.sage, fontSize: 13 }}>Couldn’t load — the admin_sandbaggers migration (0101) may not be applied yet.</div>;
  if (!rows) return <div style={{ color: C.sage, fontSize: 13 }}>Loading…</div>;
  return (
    <div>
      <div style={{ color: C.sage, fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
        Players whose entered index differs from what their scoring in the app implies by 20% or more, once they have at least 18 posted rounds. An entered index higher than their scoring warrants (“index looks high”) is the classic sandbag — more strokes than their game deserves. The entered (GHIN) index always wins for display; this is only a flag to review. Under 18 rounds, nobody is judged.
      </div>
      {rows.length === 0 ? (
        <div style={{ background: C.card, borderRadius: 12, padding: 16, color: C.faint, fontSize: 13 }}>No one flagged — every player with 18+ rounds has an entered index within 20% of their scoring.</div>
      ) : rows.map((r) => (
        <div key={r.user_id} style={{ background: C.card, borderRadius: 12, padding: "12px 14px", marginTop: 8, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: C.ink, fontWeight: 800, fontSize: 14 }}>{r.name}</div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>Entered {Number(r.entered).toFixed(1)} · scoring says {Number(r.calc).toFixed(1)} · {r.rounds} rounds</div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ color: r.direction === "entered_high" ? C.birdie : C.gold, fontWeight: 800, fontSize: 15 }}>{r.diff_pct}%</div>
            <div style={{ color: C.faint, fontSize: 11 }}>{r.direction === "entered_high" ? "index looks high" : "index looks low"}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminHome({ user, profile, activeGroupName, activeGroupRole, onGoto, onEnterGroup, onExitGroup, onGroupsChanged }: {
  user: any; profile: any; activeGroupName?: string | null; activeGroupRole?: string | null;
  onGoto: (tab: string) => void;
  onEnterGroup: (g: any) => Promise<void>; onExitGroup: (g: any) => Promise<void>; onGroupsChanged: () => void;
}) {
  const isMaster = !!profile?.is_admin;
  const isClubAdmin = activeGroupRole === "admin";
  const [view, setView] = useState<string | null>(null);
  const [todos, setTodos] = useState<any>({});
  useEffect(() => {
    if (!isMaster) return;
    supabase.rpc("get_admin_todos").then(({ data }: any) => setTodos((t: any) => ({ ...t, ...(data || {}) })), () => {});
    supabase.rpc("get_friction_items", { p_status: "open" }).then(
      ({ data }: any) => setTodos((t: any) => ({ ...t, friction_open: (data || []).length })), () => {});
  }, [isMaster]);

  const Card = ({ icon, name, cap, onClick, badge }: { icon: string; name: string; cap: string; onClick: () => void; badge?: number }) => (
    <button onClick={onClick} style={{ textAlign: "left", background: C.greenLight, border: `1px solid #2c6b54`, borderRadius: 14, padding: "13px 13px 14px", cursor: "pointer", position: "relative" }}>
      {badge && badge > 0
        ? <span style={{ position: "absolute", top: 10, right: 10, minWidth: 20, height: 20, padding: "0 6px", borderRadius: 999, background: C.gold, color: "#0e3a2c", fontSize: 11.5, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{badge}</span>
        : <span style={{ position: "absolute", top: 12, right: 12, color: C.sage, fontSize: 14 }}>›</span>}
      <div style={{ fontSize: 20, lineHeight: 1 }}>{icon}</div>
      <div style={{ color: C.cream, fontWeight: 800, fontSize: 13.5, marginTop: 8 }}>{name}</div>
      <div style={{ color: C.sage, fontSize: 11, marginTop: 3, lineHeight: 1.35 }}>{cap}</div>
    </button>
  );
  const grid = (children: React.ReactNode) => (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>{children}</div>
  );
  const tierHead = (title: string, badge: string, badgeSuper: boolean, desc: string) => (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20 }}>
        <span style={{ fontFamily: "Georgia, serif", fontSize: 15, fontWeight: 700, color: C.cream }}>{title}</span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.04em", padding: "2px 8px", borderRadius: 999, color: badgeSuper ? "#0e3a2c" : C.sage, background: badgeSuper ? C.gold : "#173a2c", border: badgeSuper ? "none" : "1px solid #37624f" }}>{badge}</span>
      </div>
      <div style={{ color: C.faint, fontSize: 11, marginTop: 4 }}>{desc}</div>
    </>
  );

  if (view) {
    let title = ""; let panel: React.ReactNode = null;
    switch (view) {
      case "analytics": title = "Analytics"; panel = <><AdminAnalytics /><AdminExtraStats /><AdminDailyReport /><AdminEngagement /><AdminPowerUsers /></>; break;
      case "friction": title = "Friction review"; panel = <AdminFrictionReview />; break;
      case "operations": title = "Operations"; panel = <OpsMetrics />; break;
      case "diagnostics": title = "Diagnostics"; panel = <RoundSaveDiag />; break;
      case "activity": title = "Activity log"; panel = <ActivityTab />; break;
      case "oversight": title = "Clubs oversight"; panel = <AdminGroupsTab user={user} onEnterGroup={onEnterGroup} onExitGroup={onExitGroup} onGroupsChanged={onGroupsChanged} />; break;
      case "users": title = "Users"; panel = <AdminUsersTab user={user} isOwner={!!profile?.is_owner} />; break;
      case "players": title = "Player admin"; panel = <AdminPanel user={user} showAnalytics={false} />; break;
      case "feedback": title = "Feedback"; panel = <AdminFeedbackTab />; break;
      case "sandbaggers": title = "Sandbaggers"; panel = <AdminSandbaggers />; break;
      case "systools": title = "System tools"; panel = <SystemTools user={user} />; break;
    }
    return (
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
          <button onClick={() => setView(null)} style={{ ...btn(false), fontSize: 12, padding: "5px 11px" }}>‹ Admin</button>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 700, color: C.cream }}>{title}</div>
        </div>
        {panel}
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontFamily: "Georgia, serif", fontSize: 26, fontWeight: 700, color: C.cream }}>Admin</div>
      <div style={{ color: C.sage, fontSize: 12.5, marginTop: 2 }}>Everything that manages the club or the system, in one place.</div>

      {isClubAdmin && (
        <>
          {tierHead("Club admin", (activeGroupName || "This club").toUpperCase(), false, "Scoped to the club you're in. Any admin of this club sees this.")}
          {grid(<>
            <Card icon="👥" name="Members" cap="Handicaps, roles, add / remove players" onClick={() => onGoto("players")} />
            <Card icon="⚙︎" name="Club settings" cap="Name, default club, invite links" onClick={() => onGoto("groups")} />
          </>)}
        </>
      )}

      {isMaster && (
        <>
          {tierHead("System", "SYSTEM ADMIN", true, "Cross-club and system-wide. System admins only.")}
          {grid(<>
            <Card icon="📊" name="Analytics" cap="Usage, engagement & golf cadence" onClick={() => setView("analytics")} />
            <Card icon="🧭" name="Operations" cap="Nudge funnel, auto-finish, stale rounds & games" onClick={() => setView("operations")} badge={todos.stale_ready} />
            <Card icon="⚠︎" name="Friction review" cap="Data-integrity flags to review & clear" onClick={() => setView("friction")} badge={todos.friction_open} />
            <Card icon="📜" name="Activity log" cap="Audit trail across all clubs" onClick={() => setView("activity")} />
            <Card icon="🏟" name="Clubs oversight" cap="Approve clubs, support sessions" onClick={() => setView("oversight")} badge={todos.pending_clubs} />
            <Card icon="🧑‍🤝‍🧑" name="Users" cap="Global roster, suspend, merge" onClick={() => setView("users")} />
            <Card icon="🗂" name="Player admin" cap="Handicaps, scores, memberships, courses" onClick={() => setView("players")} />
            <Card icon="💬" name="Feedback" cap="User-submitted feedback" onClick={() => setView("feedback")} badge={todos.new_feedback} />
            <Card icon="🚩" name="Sandbaggers" cap="Entered index vs scoring (18+ rounds)" onClick={() => setView("sandbaggers")} />
            <Card icon="🩺" name="Diagnostics" cap="Round-save log & reproduce toggle" onClick={() => setView("diagnostics")} />
            <Card icon="🔧" name="System tools" cap="Test account, yardage backfill" onClick={() => setView("systools")} />
          </>)}
        </>
      )}

      {!isClubAdmin && !isMaster && (
        <div style={{ color: C.sage, fontSize: 13, marginTop: 20 }}>You don't have admin access to anything here.</div>
      )}
    </div>
  );
}

export function ActivityTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("activity_log").select("*").order("created_at", { ascending: false }).limit(300);
      setRows(data || []);
    })();
  }, []);

  const cats: Record<string, string[]> = {
    all: [],
    rounds: ["round_completed", "round_deleted"],
    players: ["handicap_changed", "member_added", "member_removed", "role_changed", "score_edited"],
    courses: ["course_created", "course_vetted", "course_unvetted", "course_removed"],
    games: ["game_created", "game_deleted"],
  };
  const shown = (rows || []).filter((r) => filter === "all" || cats[filter]?.includes(r.action));

  return (
    <div>
      <Eyebrow>★ ACTIVITY · AUDIT TRAIL</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Major changes across the app — who did what, and when. Newest first. Logging began when this feature was deployed, so earlier history isn't shown.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        {["all", "rounds", "players", "courses", "games"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ ...btn(filter === f), fontSize: 12, padding: "6px 12px", textTransform: "capitalize" }}>{f}</button>
        ))}
      </div>
      {rows === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
      {rows !== null && shown.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 20, marginTop: 14, color: C.sage, textAlign: "center" }}>
          No activity recorded yet{filter !== "all" ? " in this category" : ""}.
        </div>
      )}
      {shown.map((r) => (
        <div key={r.id} style={{ background: C.card, borderRadius: 12, padding: "11px 14px", marginTop: 8 }}>
          <div style={{ color: C.ink, fontSize: 14 }}>{r.summary}</div>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 3 }}>
            {r.actor_name || "Someone"} · {fmtDate(r.created_at)} at {new Date(r.created_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · {timeAgo(r.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ================= Master-admin oversight: all groups =================
export function AdminGroupsTab({ user, onEnterGroup, onExitGroup, onGroupsChanged }: {
  user: any;
  onEnterGroup?: (g: { group_id: string; name: string }) => Promise<void>;
  onExitGroup?: (g: { group_id: string; name: string }) => Promise<void>;
  onGroupsChanged?: () => Promise<void> | void;
}) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [filter, setFilter] = useState<"active" | "archived" | "all">("active");
  const [busy, setBusy] = useState<string | null>(null);
  const [mergeSrc, setMergeSrc] = useState<string | null>(null);
  const [mergeTo, setMergeTo] = useState("");

  const load = async () => {
    // Opportunistically clear any forgotten support sessions before showing the overview.
    await supabase.rpc("expire_support_sessions", { p_max_hours: 12 }).then(() => {}, () => {});
    const { data } = await supabase.rpc("admin_group_overview");
    const base = Array.isArray(data) ? data : [];
    const { data: flags } = await supabase.from("groups").select("id, is_test");
    const tmap = new Map((flags || []).map((f: any) => [f.id, !!f.is_test]));
    setRows(base.map((r: any) => ({ ...r, is_test: tmap.get(r.group_id) ?? false })));
  };
  useEffect(() => { load(); }, []);

  const shown = (rows || []).filter((r) =>
    filter === "all" || (filter === "archived" ? r.status === "archived" : r.status !== "archived"));

  const setStatus = async (g: any, next: "active" | "archived") => {
    const verb = next === "archived" ? "Archive" : "Restore";
    if (!confirm(`${verb} the club "${g.name}"?${next === "archived" ? " It disappears from members' club pickers — nothing is deleted, and you can restore it." : ""}`)) return;
    setBusy(g.group_id);
    try {
      const { error } = await supabase.rpc("admin_set_group_status", { p_group: g.group_id, p_status: next });
      if (error) { alert("Couldn't update — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: next === "archived" ? "group_archived" : "group_restored", group_id: g.group_id, summary: `${next === "archived" ? "Archived" : "Restored"} group "${g.name}"` });
      await load();
    } finally { setBusy(null); }
  };

  const delGroup = async (g: any) => {
    const hasData = (g.rounds_count || 0) > 0 || (g.games_count || 0) > 0;
    const msg = hasData
      ? `Delete "${g.name}"? This removes the club for everyone. Its ${g.games_count} game(s) will be deleted; ${g.rounds_count} posted round(s) stay in players' history but lose the club tag. This can't be undone.`
      : `Delete "${g.name}"? It has no rounds or games. This removes it for everyone and can't be undone.`;
    if (!confirm(msg)) return;
    setBusy(g.group_id);
    try {
      const { error } = await supabase.rpc("admin_delete_group", { p_group: g.group_id });
      if (error) { alert("Couldn't delete — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "group_deleted", group_id: null, summary: `Deleted group "${g.name}" (admin)` });
      await load();
      if (onGroupsChanged) await onGroupsChanged();
    } finally { setBusy(null); }
  };

  const setDefault = async (g: any) => {
    if (!confirm(`Make "${g.name}" the app's default club? New or stranded users (and their untagged rounds) will land here. This replaces any current default.`)) return;
    setBusy(g.group_id);
    try {
      const { error } = await supabase.rpc("admin_set_default_group", { p_group: g.group_id });
      if (error) { alert("Couldn't set default — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "group_set_default", group_id: g.group_id, summary: `Set "${g.name}" as the default group` });
      await load();
    } finally { setBusy(null); }
  };

  const wipeGroup = async (g: any) => {
    const typed = prompt(`Wipe ALL data in test club "${g.name}"? This deletes its games, rounds and money ledger but KEEPS the club and its members. Type the club name to confirm:`);
    if (typed == null) return;
    if (typed.trim() !== g.name) { alert("Name didn't match — nothing was wiped."); return; }
    setBusy(g.group_id);
    try {
      const { data, error } = await supabase.rpc("admin_wipe_group", { p_group: g.group_id });
      if (error) { alert("Couldn't wipe — " + error.message); return; }
      if (data === "wiped") {
        await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "group_wiped", group_id: g.group_id, summary: `Wiped test club "${g.name}" data` });
        alert(`Wiped all data in "${g.name}".`);
        await load();
        if (onGroupsChanged) await onGroupsChanged();
      } else if (data === "not_test") alert("Refused — this isn't a test club.");
      else alert("Couldn't wipe (permission or not found).");
    } finally { setBusy(null); }
  };

  const revokeInvites = async (g: any) => {
    if (!confirm(`Revoke all outstanding invite links for "${g.name}"? Existing members stay; only unused links stop working.`)) return;
    setBusy(g.group_id);
    try {
      const { error } = await supabase.rpc("admin_revoke_group_invites", { p_group: g.group_id });
      if (error) { alert("Couldn't revoke — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "group_invites_revoked", group_id: g.group_id, summary: `Revoked invite links for "${g.name}"` });
    } finally { setBusy(null); }
  };

  const doMerge = async (src: any) => {
    const target = (rows || []).find((r) => r.group_id === mergeTo);
    if (!target) return;
    if (!confirm(`Merge "${src.name}" INTO "${target.name}"? All of "${src.name}"'s members, rounds and games move into "${target.name}", then "${src.name}" is deleted. This can't be undone.`)) return;
    setBusy(src.group_id);
    try {
      const { error } = await supabase.rpc("admin_merge_group", { p_source: src.group_id, p_target: mergeTo });
      if (error) { alert("Couldn't merge — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "group_merged", group_id: mergeTo, summary: `Merged "${src.name}" into "${target.name}"` });
      setMergeSrc(null); setMergeTo("");
      await load();
      if (onGroupsChanged) await onGroupsChanged();
    } finally { setBusy(null); }
  };

  return (
    <div>
      <Eyebrow>★ OVERSIGHT · ALL CLUBS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Every group in Birdie Num Num, most recent activity first. Archiving hides a stale or abusive group from members&apos; pickers — it&apos;s reversible and deletes nothing. Counts are read-only; deeper tools arrive in later phases.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        {(["active", "archived", "all"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ ...btn(filter === f), fontSize: 12, padding: "6px 12px", textTransform: "capitalize" }}>{f}</button>
        ))}
      </div>
      {rows === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
      {rows !== null && shown.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 12, padding: 20, marginTop: 14, color: C.sage, textAlign: "center" }}>
          No {filter !== "all" ? filter : ""} groups.
        </div>
      )}
      {shown.map((g) => {
        const archived = g.status === "archived";
        return (
          <div key={g.group_id} style={{ background: C.card, borderRadius: 12, padding: "12px 14px", marginTop: 8, opacity: archived ? 0.6 : 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{g.name}</div>
              {g.is_default && <span style={{ color: C.gold, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>★ default</span>}
              {archived && <span style={{ color: C.faint, fontSize: 11, fontWeight: 700, textTransform: "uppercase" }}>· archived</span>}
              <div style={{ flex: 1 }} />
              {g.my_support ? (
                <button disabled={busy === g.group_id}
                  onClick={async () => { setBusy(g.group_id); try { await onExitGroup?.({ group_id: g.group_id, name: g.name }); await load(); } finally { setBusy(null); } }}
                  style={{ ...btn(true), fontSize: 12, padding: "5px 11px" }}>In session · Exit</button>
              ) : (
                <button disabled={busy === g.group_id}
                  onClick={async () => { setBusy(g.group_id); try { await onEnterGroup?.({ group_id: g.group_id, name: g.name }); } finally { setBusy(null); } }}
                  style={{ ...btn(false), fontSize: 12, padding: "5px 11px", opacity: busy === g.group_id ? 0.5 : 1 }}>Enter</button>
              )}
              <button disabled={busy === g.group_id} onClick={() => setStatus(g, archived ? "active" : "archived")}
                style={{ ...btn(false), fontSize: 12, padding: "5px 11px", opacity: busy === g.group_id ? 0.5 : 1 }}>
                {archived ? "Restore" : "Archive"}
              </button>
            </div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 4 }}>Admin: {g.admin_names || "—"}</div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
              {g.member_count} member{g.member_count === 1 ? "" : "s"} · {g.rounds_count} round{g.rounds_count === 1 ? "" : "s"} · {g.games_count} game{g.games_count === 1 ? "" : "s"} · last activity {g.last_activity ? fmtDate(g.last_activity) : "—"}
            </div>
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <button disabled={busy === g.group_id} onClick={() => revokeInvites(g)}
                style={{ background: "transparent", color: C.faint, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer", opacity: busy === g.group_id ? 0.4 : 1 }}>
                Revoke invites
              </button>
              <button disabled={busy === g.group_id} onClick={() => { setMergeSrc(mergeSrc === g.group_id ? null : g.group_id); setMergeTo(""); }}
                style={{ background: "transparent", color: C.faint, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer", opacity: busy === g.group_id ? 0.4 : 1 }}>
                Merge…
              </button>
              {!g.is_default && (
                <button disabled={busy === g.group_id} onClick={() => setDefault(g)}
                  style={{ background: "transparent", color: C.faint, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer", opacity: busy === g.group_id ? 0.4 : 1 }}>
                  Set as default
                </button>
              )}
              <button disabled={busy === g.group_id} onClick={() => delGroup(g)}
                style={{ background: "transparent", color: C.birdie, border: `1px solid ${C.birdie}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer", opacity: busy === g.group_id ? 0.4 : 1 }}>
                Delete group
              </button>
              {g.is_test && (
                <button disabled={busy === g.group_id} onClick={() => wipeGroup(g)}
                  style={{ background: "transparent", color: C.gold, border: `1px solid ${C.gold}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer", opacity: busy === g.group_id ? 0.4 : 1 }}>
                  Wipe data
                </button>
              )}
            </div>
            {mergeSrc === g.group_id && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", background: C.greenLight, borderRadius: 8, padding: 8 }}>
                <span style={{ color: C.sage, fontSize: 12 }}>Merge into:</span>
                <select value={mergeTo} onChange={(e) => setMergeTo(e.target.value)}
                  style={{ background: C.card, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, padding: "5px 8px" }}>
                  <option value="">Select target…</option>
                  {(rows || []).filter((r) => r.group_id !== g.group_id).map((r) => (
                    <option key={r.group_id} value={r.group_id}>{r.name}</option>
                  ))}
                </select>
                <button disabled={!mergeTo || busy === g.group_id} onClick={() => doMerge(g)}
                  style={{ background: C.gold, color: C.green, border: "none", borderRadius: 8, fontSize: 12, fontWeight: 800, padding: "5px 12px", cursor: "pointer", opacity: mergeTo ? 1 : 0.4 }}>Merge & delete source</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ================= Master-admin oversight: all users =================
export function AdminUsersTab({ user, isOwner }: { user: any; isOwner?: boolean }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [mergeKeep, setMergeKeep] = useState<string | null>(null);
  const [mergeRemove, setMergeRemove] = useState("");
  const [preview, setPreview] = useState<any | null>(null);

  const load = async () => {
    const { data } = await supabase.rpc("admin_list_users");
    setRows(Array.isArray(data) ? data : []);
  };
  useEffect(() => { load(); }, []);

  const setSystemAdmin = async (u: any, make: boolean) => {
    if (!confirm(make
      ? `Make ${u.display_name || u.email || "this user"} a system admin? They'll get full system-admin access across the app.`
      : `Remove system admin from ${u.display_name || u.email || "this user"}? They'll lose all system-admin access.`)) return;
    setBusy(u.id);
    try {
      // The RPC is owner-gated and writes its own audit entry, so no client-side logging here.
      const { error } = await supabase.rpc("admin_set_system_admin", { p_user: u.id, p_make: make });
      if (error) { alert("Couldn't update — " + error.message); return; }
      await load();
    } finally { setBusy(null); }
  };

  const shown = (rows || []).filter((r) => {
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return (r.display_name || "").toLowerCase().includes(s) || (r.email || "").toLowerCase().includes(s);
  });

  const setBanned = async (u: any, banned: boolean) => {
    if (!confirm(`${banned ? "Suspend" : "Restore"} ${u.display_name || u.email || "this user"}?${banned ? " They'll be blocked from the app until restored." : ""}`)) return;
    setBusy(u.id);
    try {
      const { error } = await supabase.rpc("admin_set_banned", { p_user: u.id, p_banned: banned });
      if (error) { alert("Couldn't update — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: banned ? "user_banned" : "user_unbanned", target_user_id: u.id, summary: `${banned ? "Suspended" : "Restored"} ${u.display_name || u.email || "a user"}` });
      await load();
    } finally { setBusy(null); }
  };

  const wipe = async (u: any) => {
    if (!confirm(`WIPE all data for ${u.display_name || u.email}? Deletes their rounds, stats, memberships and profile. Club games stay (they hold others' data). This CANNOT be undone.`)) return;
    if (!confirm(`Final confirm — permanently delete ${u.display_name || u.email}'s data?`)) return;
    setBusy(u.id);
    try {
      const { error } = await supabase.rpc("admin_wipe_user", { p_user: u.id });
      if (error) { alert("Couldn't wipe — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "user_wiped", target_user_id: u.id, summary: `Wiped data for ${u.display_name || u.email || "a user"}` });
      await load();
    } finally { setBusy(null); }
  };

  const runPreview = async (keepId: string) => {
    if (!mergeRemove) return;
    const { data } = await supabase.rpc("admin_merge_users_preview", { p_keep: keepId, p_remove: mergeRemove });
    setPreview(Array.isArray(data) ? data[0] : data);
  };

  const doMergeUsers = async (keep: any) => {
    const rem = (rows || []).find((r) => r.id === mergeRemove);
    if (!rem) return;
    if (!confirm(`Merge ${rem.display_name || rem.email} INTO ${keep.display_name || keep.email}? All of ${rem.display_name || rem.email}'s rounds, games and memberships move to ${keep.display_name || keep.email}, then their duplicate profile is deleted. This can't be undone.`)) return;
    setBusy(keep.id);
    try {
      const { error } = await supabase.rpc("admin_merge_users", { p_keep: keep.id, p_remove: mergeRemove });
      if (error) { alert("Couldn't merge — " + error.message); return; }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "users_merged", target_user_id: keep.id, summary: `Merged ${rem.display_name || rem.email} into ${keep.display_name || keep.email}` });
      setMergeKeep(null); setMergeRemove(""); setPreview(null);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div>
      <Eyebrow>★ OVERSIGHT · ALL USERS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Every account. Suspend a bad actor, wipe a user&apos;s data on request, or merge two accounts that are the same person (dedup). Merge and wipe are irreversible.{isOwner ? " As the owner, you can also grant or revoke system-admin access (app-wide — separate from club admin). Only you can." : ""}
      </div>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…"
        style={{ width: "100%", marginTop: 12, background: C.card, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", fontSize: 14 }} />
      {rows === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
      {shown.map((u) => {
        const banned = !!u.banned;
        const isSelf = u.id === user.id;
        return (
          <div key={u.id} style={{ background: C.card, borderRadius: 12, padding: "12px 14px", marginTop: 8, opacity: banned ? 0.65 : 1 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <div style={{ color: C.ink, fontWeight: 800, fontSize: 15 }}>{u.display_name || "(no name)"}</div>
              {u.is_owner ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>★ owner</span>
                : u.is_admin ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 800 }}>★ system admin</span> : null}
              {banned && <span style={{ color: C.birdie, fontSize: 11, fontWeight: 800, textTransform: "uppercase" }}>· suspended</span>}
            </div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{u.email || "—"}</div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
              {u.group_count} group{u.group_count === 1 ? "" : "s"} · {u.rounds_count} round{u.rounds_count === 1 ? "" : "s"}{u.handicap_index != null ? ` · hcp ${u.handicap_index}` : ""}
            </div>
            <div style={{ marginTop: 8, display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              {isOwner && !u.is_owner && !isSelf && (
                <button disabled={busy === u.id} onClick={() => setSystemAdmin(u, !u.is_admin)}
                  style={{ background: "transparent", color: u.is_admin ? C.birdie : C.sage, border: `1px solid ${u.is_admin ? C.birdie : C.sage}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer" }}>
                  {u.is_admin ? "Remove system admin" : "Make system admin"}
                </button>
              )}
              <button disabled={busy === u.id} onClick={() => { setMergeKeep(mergeKeep === u.id ? null : u.id); setMergeRemove(""); setPreview(null); }}
                style={{ background: "transparent", color: C.faint, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: "pointer" }}>
                Merge another into this…
              </button>
              <button disabled={busy === u.id || isSelf} onClick={() => setBanned(u, !banned)}
                style={{ background: "transparent", color: banned ? C.sage : C.birdie, border: `1px solid ${banned ? C.sage : C.birdie}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: isSelf ? "default" : "pointer", opacity: isSelf ? 0.3 : 1 }}>
                {banned ? "Restore" : "Suspend"}
              </button>
              <button disabled={busy === u.id || isSelf} onClick={() => wipe(u)}
                style={{ background: "transparent", color: C.birdie, border: `1px solid ${C.birdie}`, borderRadius: 8, fontSize: 11, fontWeight: 700, padding: "4px 10px", cursor: isSelf ? "default" : "pointer", opacity: isSelf ? 0.3 : 1 }}>
                Wipe data
              </button>
            </div>
            {mergeKeep === u.id && (
              <div style={{ marginTop: 8, background: C.greenLight, borderRadius: 8, padding: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ color: C.sage, fontSize: 12 }}>Merge a duplicate INTO {u.display_name || u.email}:</span>
                  <select value={mergeRemove} onChange={(e) => { setMergeRemove(e.target.value); setPreview(null); }}
                    style={{ background: C.card, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 8, fontSize: 12, padding: "5px 8px" }}>
                    <option value="">Select duplicate…</option>
                    {(rows || []).filter((r) => r.id !== u.id).map((r) => (
                      <option key={r.id} value={r.id}>{r.display_name || r.email}</option>
                    ))}
                  </select>
                  <button disabled={!mergeRemove} onClick={() => runPreview(u.id)}
                    style={{ background: "transparent", color: C.cream, border: `1px solid ${C.sage}`, borderRadius: 8, fontSize: 12, fontWeight: 700, padding: "5px 10px", cursor: "pointer", opacity: mergeRemove ? 1 : 0.4 }}>Preview</button>
                </div>
                {preview && (
                  <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
                    Will move: {preview.rounds} rounds · {preview.games_organized} games organized · {preview.game_player_rows} score rows · {preview.memberships} memberships. Then the duplicate profile is deleted.
                    <div style={{ marginTop: 8 }}>
                      <button disabled={busy === u.id} onClick={() => doMergeUsers(u)}
                        style={{ background: C.gold, color: C.green, border: "none", borderRadius: 8, fontSize: 12, fontWeight: 800, padding: "6px 12px", cursor: "pointer" }}>Confirm merge</button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ================= Help page =================
export function HelpPage({ isAdmin, user, displayName, groupId }: { isAdmin: boolean; user: any; displayName: string; groupId: string | null }) {
  const [fbPrefill, setFbPrefill] = useState<FeedbackPrefill>(null);
  const fbRef = React.useRef<HTMLDivElement>(null);
  const sendAsQuestion = (q: string) => {
    setFbPrefill({ kind: "question", message: q });
    setTimeout(() => fbRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 60);
  };
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>{title}</div>
      <div style={{ color: C.sage, fontSize: 13, marginTop: 8, lineHeight: 1.55 }}>{children}</div>
    </div>
  );
  return (
    <div>
      <Eyebrow>HELP · HOW BIRDIE NUM NUM WORKS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>A quick guide to the basics. Tap the SCREEN selector at the top to move around.</div>

      {(() => {
        const isTGC = effectiveGroupId(groupId) === TGC_GROUP_ID;
        const edition = isTGC ? "tgc" : "club";
        const cards = (capabilities.cards as { title: string; body: string; editions: string[] }[])
          .filter((c) => c.editions.includes("all") || c.editions.includes(edition));
        const pdf = isTGC ? "/BNN-onepager-tgc.pdf" : "/BNN-onepager-club.pdf";
        const exclusives = capabilities.tgcExclusives as { title: string; body: string }[];
        return (
          <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
              <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700, flex: 1 }}>What Birdie Num Num can do</div>
              <a href={pdf} target="_blank" rel="noopener noreferrer" style={{ background: C.gold, color: C.green, fontWeight: 800, fontSize: 12, borderRadius: 8, padding: "7px 12px", textDecoration: "none", whiteSpace: "nowrap" }}>Download one-pager (PDF)</a>
            </div>
            <div style={{ color: C.sage, fontSize: 12, marginTop: 4, lineHeight: 1.5 }}>{capabilities.tagline}</div>
            <div style={{ marginTop: 10, display: "grid", gap: 9 }}>
              {cards.map((c, i) => (
                <div key={i}>
                  <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>{c.title}</div>
                  <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5 }}>{c.body}</div>
                </div>
              ))}
              {isTGC && (
                <div style={{ marginTop: 2, borderTop: `1px solid ${C.greenMid}`, paddingTop: 9 }}>
                  <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>★ EXCLUSIVE TO YOUR CLUB</div>
                  {exclusives.map((x, i) => (
                    <div key={i} style={{ marginTop: 7 }}>
                      <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>{x.title}</div>
                      <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5 }}>{x.body}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      <HelpSearch onSendQuestion={sendAsQuestion} />

      <div ref={fbRef}>
        <FeedbackForm user={user} displayName={displayName} groupId={groupId} prefill={fbPrefill} onConsumePrefill={() => setFbPrefill(null)} />
      </div>

      <Section title="Recording a round">
        Tap <b>＋ New round</b>, pick a course and tee, set the date, then enter your score. You can go <b>hole-by-hole</b> (full stats: GIR, putts, penalties, Stableford) or enter a <b>quick total score</b> for a past round. Quick totals still count toward your handicap and scoring average — you can add hole detail later from the round.
      </Section>

      <Section title="Your handicap">
        As you log rounds, the app calculates a running handicap using the standard "best 8 of your last 20" differentials. You can also type in a handicap index on your Profile if you already have one. Your <b>My Dashboard</b> shows your trend, scoring averages, and stats.
      </Section>

      <Section title="Games with friends">
        In <b>Games</b>, an organizer creates a Stableford or match-play game and shares a 6-digit code. Players enter the code to join, or the organizer adds them. Tap the code to copy it for a text. The organizer can set everyone's handicap and manage the roster.
      </Section>

      <Section title="Courses">
        Browse <b>All App Courses</b> to see every saved course in Birdie Num Num, then add courses to your club library. Editing a course saves the correction for your club immediately and submits it to an app admin for global approval before other clubs see it.
      </Section>

      <Section title="Clubs">
        A club keeps games, players, and courses together for the people you play with. Club admins invite members with a one-time link, set roles, and manage players from the <b>Players</b> tab. Your dashboard and rounds always cover all of your clubs together.
      </Section>

      {isAdmin && (
        <Section title="Admin tools (you only)">
          As an app admin you can mark courses as vetted community courses (the ★), adjust any player's handicap, edit scores, and review the <b>Activity</b> tab — an audit trail of major changes across the app.
        </Section>
      )}

      <UpdateChecker />
    </div>
  );
}

// Manual "check for updates" — compares the app build bundled in this page
// with /app-version.json generated by the current deployment. This catches new
// app versions even when the browser does not report a waiting service worker.
function UpdateChecker() {
  const [status, setStatus] = React.useState<string>("");
  const [latest, setLatest] = React.useState<string | null>(null);
  const [latestBuild, setLatestBuild] = React.useState<string | null>(null);

  const check = async (autoReload = false) => {
    setStatus("Checking…");
    try {
      let waiting: ServiceWorker | null = null;
      if ("serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          await reg.update().catch(() => {});
          await new Promise((r) => setTimeout(r, 1200));
          waiting = reg.waiting;
          if (!waiting && reg.installing) {
            setStatus("Downloading the new version… it'll apply in a moment.");
            reg.installing.addEventListener("statechange", () => {
              if (reg.waiting) reg.waiting.postMessage("SKIP_WAITING");
            });
            return;
          }
        }
      }

      const res = await fetch(`/app-version.json?ts=${Date.now()}`, {
        cache: "no-store",
        headers: { "Cache-Control": "no-cache" },
      });
      const server = res.ok ? await res.json() : null;
      const serverVersion = typeof server?.version === "string" ? server.version : null;
      const serverBuild = typeof server?.buildId === "string" ? server.buildId : null;
      setLatest(serverVersion);
      setLatestBuild(serverBuild);

      if (waiting) {
        setStatus("New version found — updating…");
        waiting.postMessage("SKIP_WAITING");
      } else if (serverVersion && serverVersion !== APP_VERSION) {
        setStatus(`New version available: ${serverVersion}.`);
        if (autoReload) window.location.reload();
      } else if (serverVersion) {
        setStatus("You're on the latest version.");
      } else {
        setStatus("Couldn't confirm the current version — try again in a moment.");
      }
    } catch {
      setStatus("Couldn't check right now — try again in a moment.");
    }
  };

  React.useEffect(() => { check(false); }, []);

  const hasNewer = latest && latest !== APP_VERSION;
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>App version &amp; updates</div>
      <div style={{ color: C.sage, fontSize: 13, marginTop: 8, lineHeight: 1.55 }}>
        Installed as an app? This compares your installed build with the latest deployed build and reloads if needed.
      </div>
      <div style={{ color: C.cream, fontSize: 13, marginTop: 10, lineHeight: 1.7 }}>
        <div><b>Current version:</b> {APP_VERSION}</div>
        <div><b>Latest version:</b> {latest || "Not checked yet"}</div>
        <div style={{ color: C.faint, fontSize: 11, marginTop: 12, lineHeight: 1.6 }}>
          Birdie Num Num — created by Amit Sud
          <br />© 2026 Amit Sud. All rights reserved.
        </div>
      </div>
      {hasNewer ? (
        <button style={{ ...btn(true), marginTop: 12, fontSize: 13 }} onClick={() => check(true)}>Update to {latest}</button>
      ) : (
        <button style={{ ...btn(true), marginTop: 12, fontSize: 13 }} onClick={() => check(false)}>Check for updates</button>
      )}
      {status ? <div style={{ color: hasNewer ? C.gold : C.cream, fontSize: 12, marginTop: 10 }}>{status}</div> : null}
    </div>
  );
}
