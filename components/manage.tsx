"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole, strokesReceived, stablefordPts, toParStr, fmtDate, played, strokesOf, validateStrokeIndexes } from "@/lib/golf";
import { buildCustomCourse, Course, CourseHole, loadCoursesForGroup, linkCourseToGroup } from "@/lib/courses";
import { logActivity } from "@/lib/activity";
import { btn, inputStyle, Eyebrow, NumPicker } from "@/components/ui";

const supabase = createClient();

// Create an in-app notification for a user.
async function notify(userId: string, message: string) {
  try { await supabase.from("notifications").insert({ user_id: userId, message }); } catch {}
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
type LibCourse = { id: string; name: string; location: string; user_id: string; data: Course; vetted?: boolean };

export function CoursesLibrary({ user, activeGroupId }: { user: any; activeGroupId: string }) {
  const [courses, setCourses] = useState<LibCourse[] | null>(null);
  const [community, setCommunity] = useState<LibCourse[] | null>(null);
  const [editing, setEditing] = useState<null | "new" | { id: string; data: Course; user_id: string }>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showCommunity, setShowCommunity] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>("Someone");

  const load = useCallback(async () => {
    // This group's courses (via the group_courses link table — one shared record per course).
    const linked = await loadCoursesForGroup(supabase, activeGroupId);
    const list = linked
      .map((f: any) => ({ id: f.id, name: f.name, location: f.location || "", user_id: f.user_id, data: normalize(f.data), vetted: !!f.vetted }));
    list.sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    setCourses(list);

    // Community (vetted) courses NOT already linked to this group — available to add by reference.
    const linkedIds = new Set(list.map((c: LibCourse) => c.id));
    const { data: vet } = await supabase.from("favorite_courses").select("*").eq("vetted", true).order("name");
    const vlist = (vet || [])
      .filter((f: any) => !f.deleted && !linkedIds.has(f.id))
      .map((f: any) => ({ id: f.id, name: f.name, location: f.location || "", user_id: f.user_id, data: normalize(f.data), vetted: true }));
    vlist.sort((a: any, b: any) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    setCommunity(vlist);

    const { data: prof } = await supabase.from("profiles").select("is_admin, display_name").eq("id", user.id).maybeSingle();
    setIsAdmin(!!prof?.is_admin);
    setMyName(prof?.display_name || user.email || "Someone");
  }, [user.id, activeGroupId]);
  useEffect(() => { load(); }, [load]);

  // App-admin toggles whether a course is part of the shared community library.
  const toggleVetted = async (c: LibCourse) => {
    setBusyId(c.id); setMsg(null);
    const next = !c.vetted;
    await supabase.from("favorite_courses").update({ vetted: next }).eq("id", c.id);
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: next ? "course_vetted" : "course_unvetted", summary: `${next ? "Vetted" : "Un-vetted"} community course "${c.name}"` });
    setBusyId(null);
    await load();
  };

  // Add a vetted community course to this group BY REFERENCE (one shared record, no copy).
  const addToMyGroup = async (c: LibCourse) => {
    setBusyId(c.id); setMsg(null);
    await linkCourseToGroup(supabase, activeGroupId, c.id, user.id);
    setBusyId(null);
    setMsg(`Added "${c.name}" to your group.`);
    await load();
  };

  // Remove a course FROM THIS GROUP only (unlink). The shared record and other groups are untouched.
  const remove = async (id: string, courseName: string) => {
    await supabase.from("group_courses").delete().eq("group_id", activeGroupId).eq("course_id", id);
    await logActivity(supabase, { actor_id: user.id, actor_name: myName, action: "course_removed", group_id: activeGroupId, summary: `Removed course "${courseName}" from a group` });
    await load();
  };

  if (editing) {
    return <CourseEditor
      user={user}
      activeGroupId={activeGroupId}
      initial={editing === "new" ? null : editing.data}
      existingId={editing === "new" ? null : editing.id}
      onCancel={() => setEditing(null)}
      onSaved={async () => { setEditing(null); await load(); }}
    />;
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <Eyebrow>COURSE LIBRARY</Eyebrow>
        <div style={{ flex: 1 }} />
        <button style={btn(true)} onClick={() => setEditing("new")}>＋ Add course</button>
      </div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Courses in your group's library. Anyone can add, edit, or delete a course (deleting archives it for an admin to restore).
        {isAdmin ? " As an app admin, tap the ★ to mark a course as a vetted community course available to every group." : ""}
      </div>

      {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>{msg}</div>}

      {courses === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
      {courses?.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 14, color: C.sage, textAlign: "center" }}>
          No courses in this group yet. Add one, or browse the community courses below.
        </div>
      )}
      {courses?.map((c) => (
        <div key={c.id} style={{ display: "flex", alignItems: "stretch", marginTop: 10, background: C.card, borderRadius: 12, overflow: "hidden" }}>
          {isAdmin && (
            <button title={c.vetted ? "Vetted community course — tap to unshare" : "Mark as vetted community course"}
              onClick={() => toggleVetted(c)} disabled={busyId === c.id}
              style={{ background: "none", border: "none", borderRight: `1px solid ${C.line}`, color: c.vetted ? C.gold : C.faint, fontSize: 18, cursor: "pointer", padding: "0 14px" }}>
              {c.vetted ? "★" : "☆"}
            </button>
          )}
          <button onClick={() => setEditing({ id: c.id, data: c.data, user_id: c.user_id })}
            style={{ flex: 1, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "13px 16px" }}>
            <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{c.name}{c.vetted ? <span style={{ color: C.gold, fontSize: 12 }}> · community ★</span> : null}</div>
            <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
              {c.location ? c.location + " · " : ""}{c.data.tees?.length || 0} tee{(c.data.tees?.length || 0) === 1 ? "" : "s"} · tap to edit
            </div>
          </button>
          <button title="Delete course"
            onClick={() => { if (confirm(`Remove "${c.name}" from this group's library?\n\nThe course itself isn't deleted — other groups keep it, and you can re-add it from Community Courses if it's vetted.`)) remove(c.id, c.name); }}
            style={{ background: "none", border: "none", borderLeft: `1px solid ${C.line}`, color: C.birdie, fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px" }}>✕</button>
        </div>
      ))}

      {/* Community (vetted) courses anyone can add */}
      <div style={{ marginTop: 24 }}>
        <button onClick={() => setShowCommunity((v) => !v)}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", alignItems: "center", gap: 8 }}>
          <Eyebrow>★ COMMUNITY COURSES{community ? ` (${community.length})` : ""}</Eyebrow>
          <span style={{ color: C.sage, fontSize: 12 }}>{showCommunity ? "hide" : "browse"}</span>
        </button>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
          Vetted courses shared by the whole community. Add any to your group's library with one tap — the whole community benefits as more get vetted.
        </div>
        {showCommunity && (
          <div style={{ marginTop: 10 }}>
            {community === null && <div style={{ color: C.sage }}>Loading…</div>}
            {community?.length === 0 && <div style={{ color: C.faint, fontSize: 13 }}>No community courses have been vetted yet.</div>}
            {community?.map((c) => {
              const inGroup = (courses || []).some((x) => x.name.toLowerCase() === c.name.toLowerCase());
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, background: C.card, borderRadius: 12, padding: "12px 16px", flexWrap: "wrap" }}>
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{c.name}</div>
                    <div style={{ color: C.faint, fontSize: 12 }}>{c.location ? c.location + " · " : ""}{c.data.tees?.length || 0} tee{(c.data.tees?.length || 0) === 1 ? "" : "s"}</div>
                  </div>
                  {inGroup ? (
                    <span style={{ color: C.sage, fontSize: 12 }}>in your group ✓</span>
                  ) : (
                    <button style={{ ...btn(true), padding: "7px 12px", fontSize: 12, opacity: busyId === c.id ? 0.5 : 1 }} disabled={busyId === c.id} onClick={() => addToMyGroup(c)}>＋ Add to my group</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
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
  const pick = async (id: number) => {
    setLoadingId(id); setErr(null);
    try {
      const res = await fetch(`/api/courses?id=${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Load failed");
      setCourse(data.course); setMode("form");
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
          <button key={r.id} onClick={() => pick(r.id)} disabled={loadingId != null}
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
    const siErr = validateStrokeIndexes(course.holes.map((h) => ({ n: h.n, si: h.si })));
    if (siErr) { setErr("Can't save — " + siErr); return; }
    setSaving(true); setErr(null);
    try {
      const name = course.name.trim();
      if (existingId) {
        // Editing the shared record — affects every group that references it.
        const { error } = await supabase.from("favorite_courses").update({ name, location: course.location || "", data: course }).eq("id", existingId);
        if (error) throw error;
        await linkCourseToGroup(supabase, activeGroupId, existingId, user.id);
      } else {
        // New course: if a canonical record with this name already exists, link it; otherwise create it.
        const { data: existsByName } = await supabase.from("favorite_courses").select("id").eq("name", name).maybeSingle();
        let courseId = existsByName?.id as string | undefined;
        if (courseId) {
          await supabase.from("favorite_courses").update({ location: course.location || "", data: course }).eq("id", courseId);
        } else {
          const { data: created, error } = await supabase.from("favorite_courses")
            .insert({ group_id: activeGroupId, name, location: course.location || "", data: course, user_id: user.id })
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
      <Eyebrow>{existingId ? "EDIT COURSE" : "NEW COURSE"}</Eyebrow>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ flex: 2, minWidth: 200 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Course name</label>
          <input style={{ ...inputStyle, marginTop: 4 }} value={course.name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ flex: 1, minWidth: 140 }}>
          <label style={{ color: C.sage, fontSize: 12 }}>Location</label>
          <input style={{ ...inputStyle, marginTop: 4 }} value={course.location} onChange={(e) => setLoc(e.target.value)} />
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
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.display_name || "");
    setGhin(profile?.ghin_number || "");
    setPhone(profile?.phone || "");
    setIdxStr(profile?.handicap_index != null ? String(profile.handicap_index) : "");
  }, [profile]);

  const save = async () => {
    setSaving(true); setMsg(null);
    const idx = idxStr.trim() === "" ? null : parseFloat(idxStr);
    const { error } = await supabase.from("profiles").update({
      display_name: name.trim() || "Golfer",
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
        <div>
          <label style={{ color: C.sage, fontSize: 12 }}>Display name</label>
          <input style={{ ...inputStyle, marginTop: 6 }} value={name} onChange={(e) => setName(e.target.value)} />
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

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("last_active", { ascending: false });
    setProfiles(data || []);
    const { data: del } = await supabase.from("favorite_courses").select("*").eq("deleted", true).order("deleted_at", { ascending: false });
    setDeletedCourses(del || []);
  }, []);
  useEffect(() => { load(); }, [load]);

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
          <div style={{ color: C.cream, fontWeight: 800, fontSize: 22, fontFamily: "Georgia, serif" }}>{profiles?.length ?? "—"}</div>
          <div style={{ color: C.sage, fontSize: 11 }}>Total users</div>
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

      {profiles === null && <div style={{ color: C.sage, marginTop: 12 }}>Loading…</div>}
      {profiles?.map((p) => (
        <div key={p.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <div style={{ color: C.ink, fontWeight: 700 }}>{p.display_name || "Golfer"}{p.id === user.id ? " (you)" : ""}{p.is_admin ? " ★" : ""}</div>
            <div style={{ color: C.faint, fontSize: 12 }}>
              {p.email || "no email"}{p.phone ? ` · ${p.phone}` : ""}{p.ghin_number ? ` · GHIN ${p.ghin_number}` : ""}
            </div>
            <div style={{ color: C.faint, fontSize: 11, marginTop: 1 }}>active {timeAgo(p.last_active)}</div>
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
        </div>
      ))}

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
      .select("id, user_id, email, role, status")
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
        Each group has its own course list. Anyone can add a course (search or type it from a scorecard). Fixing a course's pars or stroke indexes fixes it for everyone using it. Browse <b>★ Community Courses</b> to add vetted courses other groups have shared.
      </Section>

      <Section title="Groups">
        A group keeps games, players, and courses together for the people you play with. Group admins invite members with a one-time link, set roles, and manage players from the <b>Players</b> tab. Your dashboard and rounds always cover all of your groups together.
      </Section>

      {isAdmin && (
        <Section title="Admin tools (you only)">
          As an app admin you can mark courses as vetted community courses (the ★), adjust any player's handicap, edit scores, and review the <b>Activity</b> tab — an audit trail of major changes across the app.
        </Section>
      )}
    </div>
  );
}
