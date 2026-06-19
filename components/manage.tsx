"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole, strokesReceived, stablefordPts, toParStr, fmtDate, played, strokesOf, validateStrokeIndexes } from "@/lib/golf";
import { buildCustomCourse, Course, CourseHole, courseLabel, loadCoursesForGroup, linkCourseToGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { btn, inputStyle, Eyebrow, NumPicker, Avatar } from "@/components/ui";
import { resizeToAvatar } from "@/lib/image";
import { APP_VERSION, APP_BUILT_AT } from "@/lib/app-version";
import { courseChangeLines, buildCourseChangeSummary, hasMaterialCourseChanges } from "@/lib/course-diff";

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
          <div><b>Group:</b> {req.group_name || "Unknown group"}</div>
          <div><b>Submitted at:</b> {formatDateTime(req.created_at)}</div>
          <div><b>Reason:</b> {req.reason?.trim() || "No reason provided."}</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
        <div style={{ background: C.cream, borderRadius: 10, padding: 10, border: `1px solid ${C.line}` }}>
          <div style={{ color: C.faint, fontSize: 10, letterSpacing: 1.5, fontWeight: 800 }}>CURRENT GLOBAL</div>
          <div style={{ color: C.ink, fontWeight: 800, marginTop: 5 }}>{current ? courseLabel(current) : "Unknown course"}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{current?.location || "No location"}</div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 3 }}>{current?.tees?.length || 0} tee{(current?.tees?.length || 0) === 1 ? "" : "s"} · {current?.holes?.length || 0} holes</div>
        </div>
        <div style={{ background: C.cream, borderRadius: 10, padding: 10, border: `1px solid ${C.gold}` }}>
          <div style={{ color: C.gold, fontSize: 10, letterSpacing: 1.5, fontWeight: 800 }}>PROPOSED GLOBAL</div>
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
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_added_to_group", group_id: activeGroupId, summary: `Added course "${courseCardTitle(c)}" to the group library` });
    setBusyId(null);
    setMsg(`Added "${courseCardTitle(c)}" to your group library.`);
    await load();
    setTab("group");
  };

  // Remove a course FROM THIS GROUP only (unlink). The global record and other groups are untouched.
  const remove = async (id: string, courseName: string) => {
    await supabase.from("group_courses").delete().eq("group_id", activeGroupId).eq("course_id", id);
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_removed", group_id: activeGroupId, summary: `Removed course "${courseName}" from a group` });
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
      setMsg("Course edit approved globally. The local group override was cleared because the global record now matches it.");
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
      setMsg("Course edit kept for the submitting group only. The global course record was not changed.");
      await load();
    } catch (e: any) {
      setMsg("Couldn't keep edit group-only: " + (e.message || "error"));
    } finally {
      setBusyId(null);
    }
  };

  const rejectAndRemoveCourseEdit = async (req: CourseEditRequest) => {
    if (!isAdmin) return;
    if (!confirm(`Reject this course edit and remove the local override for ${req.group_name || "the submitting group"}?\n\nThe group will revert to the current global course data.`)) return;
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
      await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_edit_rejected_removed", group_id: req.group_id, summary: `Rejected course edit for "${req.proposed_name}" and removed the group override` });
      setMsg("Course edit rejected and the submitting group's override was removed.");
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
            {c.group_override ? <span style={{ color: C.gold, fontSize: 11, fontWeight: 700 }}> · group edit pending review</span> : c.data?.corrected ? <span style={{ color: C.sage, fontSize: 11, fontWeight: 700 }}> · ⚑ corrected</span> : null}
          </div>
          <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
            {c.location ? c.location + " · " : ""}{c.data.tees?.length || 0} tee{(c.data.tees?.length || 0) === 1 ? "" : "s"} · tap to view/edit{c.group_override ? " · this group sees a local correction" : ""}
          </div>
        </button>
        {source === "group" ? (
          <button title="Remove from group library"
            onClick={() => { if (confirm(`Remove "${courseCardTitle(c)}" from this group's library?\n\nThe course remains in the global app library and can be added back later.`)) remove(c.id, courseCardTitle(c)); }}
            style={{ background: "none", border: "none", borderLeft: `1px solid ${C.line}`, color: C.birdie, fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px" }}>✕</button>
        ) : inGroup ? (
          <div style={{ display: "flex", alignItems: "center", borderLeft: `1px solid ${C.line}`, padding: "0 14px", color: C.green, fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>In Group ✓</div>
        ) : (
          <button style={{ ...btn(true), borderRadius: 0, padding: "0 14px", fontSize: 12, opacity: busyId === c.id ? 0.5 : 1 }} disabled={busyId === c.id} onClick={() => addToMyGroup(c)}>＋ Add to Group</button>
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
        Browse every course saved in Birdie Num Num, then add the ones your group plays to your group library. Your group library is what appears in New Round and Create Game.
      </div>

      <input
        style={{ ...inputStyle, marginTop: 12 }}
        value={search}
        placeholder="Search all courses..."
        onChange={(e) => setSearch(e.target.value)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button style={{ ...btn(tab === "group"), fontSize: 13 }} onClick={() => setTab("group")}>My Group Courses ({groupCourses?.length ?? 0})</button>
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
                <button style={{ ...btn(false), fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => keepCourseEditGroupOnly(r)}>Keep changes in group only</button>
                <button style={{ ...btn(false), background: "#7A2F28", fontSize: 12, opacity: busyId === r.id ? 0.5 : 1 }} disabled={busyId === r.id} onClick={() => rejectAndRemoveCourseEdit(r)}>Reject and remove override</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "group" && (
        <div style={{ marginTop: 16 }}>
          <Eyebrow>YOUR GROUP COURSES</Eyebrow>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
            These courses are available to everyone in your current group when creating rounds and games.
          </div>
          {groupCourses === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
          {groupCourses !== null && filteredGroup.length === 0 && (
            <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 14, color: C.sage, textAlign: "center" }}>
              {search.trim() ? "No group courses match your search." : "No courses in this group yet. Open All App Courses and add the courses your group plays."}
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
    setCourse(buildCustomCourse("New course", "", 72, 72, 113));
    setMode("form");
  };

  if (mode === "choose") {
    return (
      <div style={{ maxWidth: 600 }}>
        <Eyebrow>ADD A COURSE</Eyebrow>
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
  return <CourseForm user={user} activeGroupId={activeGroupId} course={course} setCourse={setCourse} existingId={existingId} saving={saving} setSaving={setSaving} err={err} setErr={setErr} onCancel={onCancel} onSaved={onSaved} />;
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
          await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_linked", group_id: activeGroupId, summary: `Saved course "${name}" to this group library with no course-data changes` });
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
        await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Someone", action: "course_edit_submitted", group_id: activeGroupId, summary: `Edited course "${name}" for this group and submitted it for global review` });
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
      <Eyebrow>{existingId ? "EDIT COURSE FOR THIS GROUP" : "NEW COURSE"}</Eyebrow>
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
        {course.tees.map((t, i) => (
          <div key={i} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 8, background: C.greenLight, borderRadius: 10, padding: 10 }}>
            <div style={{ flex: 2, minWidth: 120 }}>
              <label style={{ color: C.sage, fontSize: 10 }}>Name</label>
              <input style={{ ...inputStyle, marginTop: 2 }} value={t.name} onChange={(e) => updateTee(i, { name: e.target.value })} />
            </div>
            <div style={{ flex: 1, minWidth: 80 }}>
              <label style={{ color: C.sage, fontSize: 10 }}>Rating</label>
              <input style={{ ...inputStyle, marginTop: 2 }} inputMode="decimal" placeholder="72.1"
                value={ratingTexts[i] ?? ""} onChange={(e) => setRating(i, e.target.value)} />
            </div>
            <div style={{ flex: 1, minWidth: 80 }}>
              <label style={{ color: C.sage, fontSize: 10 }}>Slope</label>
              <input style={{ ...inputStyle, marginTop: 2 }} inputMode="numeric" placeholder="130"
                value={t.slope ?? ""} onChange={(e) => updateTee(i, { slope: e.target.value === "" ? 0 : parseInt(e.target.value, 10) || 0 })} />
            </div>
            {course.tees.length > 1 && (
              <button onClick={() => removeTee(i)} style={{ background: "none", border: "none", color: C.birdie, cursor: "pointer", fontWeight: 800, padding: "10px 6px" }}>✕</button>
            )}
          </div>
        ))}
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
                <div style={{ display: "grid", gridTemplateColumns: "40px 1fr 1fr", gap: 6, padding: "0 2px 5px", color: C.faint, fontSize: 9, letterSpacing: 1, fontWeight: 700, borderBottom: `1px solid ${C.line}` }}>
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

// ================= Profile panel (+ admin) =================
export function ProfilePanel({ profile, user, onSaved }: { profile: any; user: any; onSaved: () => void }) {
  const [name, setName] = useState(profile?.display_name || "");
  const [ghin, setGhin] = useState(profile?.ghin_number || "");
  const [phone, setPhone] = useState(profile?.phone || "");
  const [idxStr, setIdxStr] = useState(profile?.handicap_index != null ? String(profile.handicap_index) : "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(profile?.avatar_url || null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.display_name || "");
    setGhin(profile?.ghin_number || "");
    setPhone(profile?.phone || "");
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
    if (!name.trim()) { setMsg("Please enter your name so others in your group can recognize you."); return; }
    setSaving(true); setMsg(null);
    const idx = idxStr.trim() === "" ? null : parseFloat(idxStr);
    const { error } = await supabase.from("profiles").update({
      display_name: name.trim(),
      ghin_number: ghin.trim() || null,
      phone: phone.trim() || null,
      handicap_index: idx,
    }).eq("id", user.id);
    setSaving(false);
    if (error) { setMsg("Couldn't save: " + error.message); return; }
    setMsg("Saved ✓");
    onSaved();
  };

  return (
    <div style={{ maxWidth: 560 }}>
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

      {profile?.is_admin && <AdminPanel user={user} />}

      <div style={{ marginTop: 22, paddingTop: 18, borderTop: `1px solid ${C.greenMid}` }}>
        <button style={{ ...btn(false), fontSize: 13 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    </div>
  );
}

// ================= Admin panel =================
function AdminPanel({ user }: { user: any }) {
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
    await notify(p.id, `An admin added you to a group.`);
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
    if (!confirm(`Deactivate ${p.display_name || p.email}?\n\nThey'll be removed from all groups and blocked from using the app, but their rounds and history are kept. You can reactivate them later.`)) return;
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

  // Hard delete: erase the player and all their data permanently.
  const deletePlayer = async (p: any) => {
    const typed = prompt(`PERMANENTLY DELETE ${p.display_name || p.email} and ALL their rounds and scores?\n\nThis cannot be undone. Type DELETE to confirm.`);
    if (typed !== "DELETE") return;
    // Remove their rounds (and holes cascade if FK set), group memberships, then profile.
    const { data: rs } = await supabase.from("rounds").select("id").eq("user_id", p.id);
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
    if (g.created_by) await notify(g.created_by, `Your group "${g.name}" was approved. It's now active.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: "Admin", action: "group_approved", group_id: g.id, summary: `Approved the group "${g.name}"` });
    await load();
  };

  // Decline a request → mark declined (kept for the record) and notify the requester.
  const declineGroup = async (g: any) => {
    if (!confirm(`Decline the group request "${g.name}"?`)) return;
    await supabase.from("groups").update({ status: "declined" }).eq("id", g.id);
    if (g.created_by) await notify(g.created_by, `Your group request "${g.name}" was declined.`);
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
              if (mine.length === 0) return <div style={{ color: C.birdie, fontSize: 12, marginTop: 2 }}>Groups: none</div>;
              return (
                <div style={{ color: C.green, fontSize: 12, marginTop: 2, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  <span style={{ color: C.faint }}>Groups:</span>
                  {mine.map((m) => {
                    const g = allGroups.find((x) => x.id === m.group_id);
                    return (
                      <span key={m.id} style={{ background: C.greenLight, color: C.cream, borderRadius: 12, padding: "1px 9px", fontSize: 11, fontWeight: 700 }}>
                        {g?.name || "Group"}{m.role === "admin" ? " ★" : ""}
                      </span>
                    );
                  })}
                </div>
              );
            })()}
            <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>active {timeAgo(p.last_active)}</div>
          </div>
          <div>
            <label style={{ color: C.sage, fontSize: 10 }}>Handicap index</label>
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
              <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800 }}>GROUPS</div>
              {(() => {
                const mine = memberships.filter((m) => m.user_id === p.id);
                const myGroupIds = new Set(mine.map((m) => m.group_id));
                return (
                  <>
                    {mine.length === 0 && <div style={{ color: C.faint, fontSize: 12, marginTop: 6 }}>Not in any group.</div>}
                    {mine.map((m) => {
                      const g = allGroups.find((x) => x.id === m.group_id);
                      return (
                        <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${C.greenMid}` }}>
                          <span style={{ flex: 1, color: C.cream, fontSize: 13 }}>{g?.name || "Group"}{m.role === "admin" ? " · admin" : ""}</span>
                          <button style={{ ...btn(false), padding: "4px 10px", fontSize: 11, color: C.birdie }} onClick={() => removeFromGroup(p, m, g?.name || "this group")}>Remove</button>
                        </div>
                      );
                    })}
                    <div style={{ display: "flex", gap: 6, marginTop: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <label style={{ color: C.sage, fontSize: 11 }}>Add to group:</label>
                      <select defaultValue="" onChange={(e) => { if (e.target.value) { addToGroup(p, e.target.value); e.target.value = ""; } }}
                        style={{ ...inputStyle, padding: "6px 8px", fontSize: 12, maxWidth: 180 }}>
                        <option value="">Select…</option>
                        {allGroups.filter((g) => !myGroupIds.has(g.id)).map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                    </div>

                    <div style={{ borderTop: `1px solid ${C.greenMid}`, marginTop: 12, paddingTop: 10 }}>
                      <div style={{ color: C.sage, fontSize: 11, letterSpacing: 1, fontWeight: 800 }}>REMOVE FROM APP</div>
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
                      <div style={{ color: C.sage, fontSize: 10, marginTop: 6 }}>
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
        <Eyebrow>★ GROUP REQUESTS{pendingGroups.length ? ` (${pendingGroups.length})` : ""}</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
          New groups need your approval. Approve to make a group active for its members, or decline the request.
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
export function NotificationBell({ user }: { user: any }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);

  const load = useCallback(async () => {
    const { data } = await supabase.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30);
    setItems(data || []);
  }, [user.id]);
  useEffect(() => { load(); }, [load]);

  const unread = items.filter((n) => !n.read).length;

  const openPanel = async () => {
    setOpen((v) => !v);
    if (!open && unread > 0) {
      await supabase.from("notifications").update({ read: true }).eq("user_id", user.id).eq("read", false);
      setItems((xs) => xs.map((n) => ({ ...n, read: true })));
    }
  };

  return (
    <div style={{ position: "relative" }}>
      <button onClick={openPanel} style={{ ...btn(false), fontSize: 14, padding: "8px 12px", position: "relative" }}>
        🔔
        {unread > 0 && (
          <span style={{ position: "absolute", top: -4, right: -4, background: C.birdie, color: "#fff", borderRadius: 10, fontSize: 10, fontWeight: 800, padding: "1px 6px" }}>{unread}</span>
        )}
      </button>
      {open && (
        <div style={{ position: "absolute", right: 0, top: 44, width: 280, maxHeight: 360, overflowY: "auto", background: C.card, borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", zIndex: 50, padding: 8 }}>
          <div style={{ color: C.faint, fontSize: 11, letterSpacing: 2, fontWeight: 700, padding: "6px 8px" }}>NOTIFICATIONS</div>
          {items.length === 0 && <div style={{ color: C.faint, fontSize: 13, padding: 12 }}>Nothing yet.</div>}
          {items.map((n) => (
            <div key={n.id} style={{ padding: "10px 8px", borderTop: `1px solid ${C.line}` }}>
              <div style={{ color: C.ink, fontSize: 13 }}>{n.message}</div>
              <div style={{ color: C.faint, fontSize: 11, marginTop: 2 }}>{timeAgo(n.created_at)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Exported so other parts of the app (e.g. admin score edits) can raise notifications.
export { notify };

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
    const { data: rs } = await supabase.from("rounds").select("*").eq("user_id", player.id).order("played_at", { ascending: false });
    if (!rs) { setRounds([]); return; }
    const ids = rs.map((r: any) => r.id);
    const { data: hs } = await supabase.from("holes").select("*").in("round_id", ids.length ? ids : ["none"]);
    const byRound: Record<string, Hole[]> = {};
    (hs || []).forEach((h: any) => { (byRound[h.round_id] ||= []).push(h); });
    const merged: Round[] = rs.map((r: any) => ({
      ...r,
      holes: (byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number)
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
          <div style={{ display: "grid", gridTemplateColumns: "44px 40px 1fr 1fr", gap: 6, padding: "0 2px 6px", color: C.faint, fontSize: 10, letterSpacing: 1, fontWeight: 700, borderBottom: `1px solid ${C.line}` }}>
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
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "role_changed", group_id: activeGroupId, target_user_id: row.user_id, summary: `Changed ${row.profiles?.display_name || row.email} to ${row.role === "admin" ? "member" : "admin"}` });
    setBusyId(null);
    await load(); onChanged?.();
  };

  // Group admin: remove a member from THIS group (does not delete their account or other groups).
  const removeFromGroup = async (row: any) => {
    if (!confirm(`Remove ${row.profiles?.display_name || row.email} from this group?\n\nThis only affects this group — their account and other groups are untouched.`)) return;
    setBusyId(row.id); setMsg(null);
    await supabase.from("group_members").update({ status: "removed" }).eq("id", row.id);
    if (row.user_id && row.user_id !== user.id) await notify(row.user_id, `You were removed from a group by an admin.`);
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "member_removed", group_id: activeGroupId, target_user_id: row.user_id, summary: `Removed ${row.profiles?.display_name || row.email} from a group` });
    setBusyId(null);
    await load(); onChanged?.();
  };

  return (
    <div>
      <Eyebrow>PLAYERS · CURRENT GROUP</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Members and invited players in the selected group. Tap a phone number to call or text.
        {isGroupAdmin ? " As a group admin you can set handicaps, change roles, and remove players from this group." : ""}
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
              <Avatar src={row.avatar_url} name={p.display_name || row.email || "?"} size={48} />
              <div style={{ flex: 1, minWidth: 150 }}>
                <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{p.display_name || row.email}{self ? " (you)" : ""}{row.role === "admin" ? " · admin" : ""}</div>
                <div style={{ color: C.faint, fontSize: 12 }}>
                  {p.handicap_index != null ? `Handicap ${p.handicap_index}` : row.status === "invited" ? "Invited" : "No handicap set"}
                  {p.ghin_number ? ` · GHIN ${p.ghin_number}` : ""}
                </div>
              </div>
              {p.phone ? (
                <a href={`tel:${p.phone}`} style={{ color: C.green, fontWeight: 700, fontSize: 14, textDecoration: "none", background: C.cream, borderRadius: 8, padding: "8px 12px" }}>{p.phone}</a>
              ) : (
                <span style={{ color: C.faint, fontSize: 12 }}>{row.email}</span>
              )}
            </div>

            {isGroupAdmin && row.user_id && (
              <div style={{ display: "flex", gap: 8, marginTop: 10, alignItems: "flex-end", flexWrap: "wrap", borderTop: `1px solid ${C.line}`, paddingTop: 10 }}>
                <div>
                  <label style={{ color: C.sage, fontSize: 10 }}>Handicap index</label>
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
                    <button style={{ ...btn(false), padding: "7px 10px", fontSize: 12 }} disabled={busyId === row.id} onClick={() => toggleRole(row)}>{row.role === "admin" ? "Make member" : "Make admin"}</button>
                    <button style={{ ...btn(false), padding: "7px 10px", fontSize: 12, color: C.birdie }} disabled={busyId === row.id} onClick={() => removeFromGroup(row)}>Remove</button>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ================= Admin Activity (audit trail) =================
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
            {r.actor_name || "Someone"} · {timeAgo(r.created_at)} · {fmtDate(r.created_at)}
          </div>
        </div>
      ))}
    </div>
  );
}

// ================= Help page =================
export function HelpPage({ isAdmin }: { isAdmin: boolean }) {
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
        Browse <b>All App Courses</b> to see every saved course in Birdie Num Num, then add courses to your group library. Editing a course saves the correction for your group immediately and submits it to an app admin for global approval before other groups see it.
      </Section>

      <Section title="Groups">
        A group keeps games, players, and courses together for the people you play with. Group admins invite members with a one-time link, set roles, and manage players from the <b>Players</b> tab. Your dashboard and rounds always cover all of your groups together.
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
        {APP_BUILT_AT ? <div style={{ color: C.sage, fontSize: 11 }}>Built: {new Date(APP_BUILT_AT).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</div> : null}
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
