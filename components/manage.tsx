"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { buildCustomCourse, Course, CourseHole } from "@/lib/courses";
import { btn, inputStyle, Eyebrow } from "@/components/ui";

const supabase = createClient();

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
export function CoursesLibrary({ user }: { user: any }) {
  const [courses, setCourses] = useState<{ id: string; name: string; location: string; user_id: string; data: Course }[] | null>(null);
  const [editing, setEditing] = useState<null | "new" | { id: string; data: Course; user_id: string }>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("favorite_courses").select("*").order("name");
    setCourses((data || []).map((f: any) => ({ id: f.id, name: f.name, location: f.location || "", user_id: f.user_id, data: normalize(f.data) })));
    const { data: prof } = await supabase.from("profiles").select("is_admin").eq("id", user.id).maybeSingle();
    setIsAdmin(!!prof?.is_admin);
  }, [user.id]);
  useEffect(() => { load(); }, [load]);

  const remove = async (id: string) => {
    await supabase.from("favorite_courses").delete().eq("id", id);
    await load();
  };

  if (editing) {
    return <CourseEditor
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
        These courses are shared with everyone using the app. Anyone can add or edit a course; only the person who added it (or an admin) can delete it. Fixing a course here fixes it for the whole group.
      </div>

      {courses === null && <div style={{ color: C.sage, marginTop: 14 }}>Loading…</div>}
      {courses?.length === 0 && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 24, marginTop: 14, color: C.sage, textAlign: "center" }}>
          No courses yet. Add one — search the database or enter it from a scorecard.
        </div>
      )}
      {courses?.map((c) => {
        const canDelete = c.user_id === user.id || isAdmin;
        return (
          <div key={c.id} style={{ display: "flex", alignItems: "stretch", marginTop: 10, background: C.card, borderRadius: 12, overflow: "hidden" }}>
            <button onClick={() => setEditing({ id: c.id, data: c.data, user_id: c.user_id })}
              style={{ flex: 1, textAlign: "left", cursor: "pointer", background: "none", border: "none", padding: "13px 16px" }}>
              <div style={{ color: C.ink, fontWeight: 700, fontSize: 15 }}>{c.name}</div>
              <div style={{ color: C.faint, fontSize: 12, marginTop: 2 }}>
                {c.location ? c.location + " · " : ""}{c.data.tees?.length || 0} tee{(c.data.tees?.length || 0) === 1 ? "" : "s"} · tap to edit
              </div>
            </button>
            {canDelete && (
              <button title="Delete course"
                onClick={() => { if (confirm(`Delete "${c.name}" from the shared library?`)) remove(c.id); }}
                style={{ background: "none", border: "none", borderLeft: `1px solid ${C.line}`, color: C.birdie, fontSize: 16, fontWeight: 800, cursor: "pointer", padding: "0 16px" }}>✕</button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ================= Course editor (add/edit a library course) =================
function CourseEditor({ initial, existingId, onCancel, onSaved }: {
  initial: Course | null; existingId: string | null; onCancel: () => void; onSaved: () => void;
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
  return <CourseForm course={course} setCourse={setCourse} existingId={existingId} saving={saving} setSaving={setSaving} err={err} setErr={setErr} onCancel={onCancel} onSaved={onSaved} />;
}

function CourseForm({ course, setCourse, existingId, saving, setSaving, err, setErr, onCancel, onSaved }: {
  course: Course; setCourse: (c: Course) => void; existingId: string | null;
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
    setSaving(true); setErr(null);
    try {
      const payload = { name: course.name.trim(), location: course.location || "", data: course };
      if (existingId) {
        const { error } = await supabase.from("favorite_courses").update(payload).eq("id", existingId);
        if (error) throw error;
      } else {
        // Avoid duplicates: update a same-named course if one already exists.
        const { data: dup } = await supabase.from("favorite_courses").select("id").eq("name", payload.name).maybeSingle();
        if (dup) {
          const { error } = await supabase.from("favorite_courses").update({ location: payload.location, data: payload.data }).eq("id", dup.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("favorite_courses").insert(payload);
          if (error) throw error;
        }
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
        <div style={{ background: C.card, borderRadius: 10, padding: 10, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              <tr>
                <td style={{ color: C.faint, fontSize: 10, padding: "2px 4px" }}>Hole</td>
                {course.holes.map((h) => <td key={h.n} style={{ textAlign: "center", color: C.faint, fontSize: 10, padding: "2px" }}>{h.n}</td>)}
              </tr>
              <tr>
                <td style={{ color: C.sage, fontSize: 10, padding: "2px 4px" }}>Par</td>
                {course.holes.map((h, j) => (
                  <td key={j} style={{ padding: 2 }}>
                    <select value={h.par ?? 4} onChange={(e) => updateHole(j, { par: parseInt(e.target.value, 10) })}
                      style={{ ...inputStyle, padding: "3px 0", width: 38, textAlign: "center", fontSize: 13 }}>
                      {[3, 4, 5, 6].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
              <tr>
                <td style={{ color: C.sage, fontSize: 10, padding: "2px 4px" }}>S.I.</td>
                {course.holes.map((h, j) => (
                  <td key={j} style={{ padding: 2 }}>
                    <select value={h.si ?? ""} onChange={(e) => updateHole(j, { si: e.target.value === "" ? null : parseInt(e.target.value, 10) })}
                      style={{ ...inputStyle, padding: "3px 0", width: 42, textAlign: "center", fontSize: 13 }}>
                      <option value="">–</option>
                      {Array.from({ length: 18 }, (_, k) => k + 1).map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
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
  const [idxStr, setIdxStr] = useState(profile?.handicap_index != null ? String(profile.handicap_index) : "");
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(profile?.display_name || "");
    setGhin(profile?.ghin_number || "");
    setIdxStr(profile?.handicap_index != null ? String(profile.handicap_index) : "");
  }, [profile]);

  const save = async () => {
    setSaving(true); setMsg(null);
    const idx = idxStr.trim() === "" ? null : parseFloat(idxStr);
    const { error } = await supabase.from("profiles").update({
      display_name: name.trim() || "Golfer",
      ghin_number: ghin.trim() || null,
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

  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("display_name");
    setProfiles(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const saveHandicap = async (id: string) => {
    const raw = edits[id];
    const idx = raw === undefined ? undefined : (raw.trim() === "" ? null : parseFloat(raw));
    if (idx === undefined) return;
    setSavingId(id);
    await supabase.from("profiles").update({ handicap_index: idx }).eq("id", id);
    setSavingId(null);
    await load();
  };

  return (
    <div style={{ marginTop: 24 }}>
      <Eyebrow>★ ADMIN · ALL PLAYERS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>You can view every player and adjust their handicap index. Changes affect their net scores in games.</div>
      {profiles === null && <div style={{ color: C.sage, marginTop: 12 }}>Loading…</div>}
      {profiles?.map((p) => (
        <div key={p.id} style={{ background: C.card, borderRadius: 12, padding: "12px 16px", marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ color: C.ink, fontWeight: 700 }}>{p.display_name || "Golfer"}{p.id === user.id ? " (you)" : ""}{p.is_admin ? " ★" : ""}</div>
            <div style={{ color: C.faint, fontSize: 12 }}>{p.ghin_number ? `GHIN ${p.ghin_number}` : "no GHIN"}</div>
          </div>
          <div>
            <label style={{ color: C.sage, fontSize: 10 }}>Handicap index</label>
            <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
              <input inputMode="decimal" defaultValue={p.handicap_index != null ? String(p.handicap_index) : ""}
                onChange={(e) => { const v = e.target.value; if (v === "" || /^\d*\.?\d*$/.test(v)) setEdits((m) => ({ ...m, [p.id]: v })); }}
                style={{ ...inputStyle, padding: "6px 8px", width: 80, textAlign: "center" }} />
              <button style={{ ...btn(true), padding: "6px 12px", fontSize: 12, opacity: savingId === p.id ? 0.5 : 1 }} disabled={savingId === p.id} onClick={() => saveHandicap(p.id)}>Save</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
