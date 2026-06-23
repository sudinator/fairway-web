"use client";
import React, { useState, useEffect, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, inputStyle, Eyebrow } from "@/components/ui";
import { APP_VERSION } from "@/lib/app-version";

export type FeedbackPrefill = { kind: "bug" | "wish" | "question"; message: string } | null;

const KIND_LABEL: Record<string, string> = { bug: "Bug", wish: "Feature idea", question: "Question" };
const KIND_COLOR: Record<string, string> = { bug: "#B83A2E", wish: "#2E5AB8", question: "#C9A227" };

// ---------------- Submit form (lives in the Help section) ----------------
export function FeedbackForm({
  user,
  displayName,
  groupId,
  prefill,
  onConsumePrefill,
}: {
  user: any;
  displayName: string;
  groupId: string | null;
  prefill?: FeedbackPrefill;
  onConsumePrefill?: () => void;
}) {
  const [kind, setKind] = useState<"bug" | "wish" | "question">("bug");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (prefill) {
      setKind(prefill.kind);
      setMsg(prefill.message);
      setSent(false);
      onConsumePrefill?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const submit = async () => {
    if (!msg.trim()) return;
    setBusy(true);
    setErr("");
    const supabase = createClient();
    const { error } = await supabase.from("feedback").insert({
      user_id: user.id,
      user_name: displayName,
      kind,
      message: msg.trim(),
      app_version: APP_VERSION,
      group_id: groupId ?? null,
      context: "Help",
    });
    setBusy(false);
    if (error) {
      setErr("Couldn't send just now — please try again.");
    } else {
      setSent(true);
      setMsg("");
    }
  };

  const tab = (k: "bug" | "wish" | "question", label: string) => (
    <button
      onClick={() => { setKind(k); setSent(false); }}
      style={{
        ...btn(kind === k),
        fontSize: 12.5,
        padding: "7px 12px",
        ...(kind === k ? { background: KIND_COLOR[k], color: "#fff" } : {}),
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>
        Report a bug or request a feature
      </div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
        Found something broken or have an idea? Tell us &mdash; it goes straight to the team.
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {tab("bug", "🐛 Bug")}
        {tab("wish", "💡 Feature idea")}
        {tab("question", "❓ Question")}
      </div>

      <textarea
        style={{ ...inputStyle, width: "100%", marginTop: 10, minHeight: 90, resize: "vertical", lineHeight: 1.45 }}
        placeholder={
          kind === "bug"
            ? "What happened, and what did you expect? Which screen were you on?"
            : kind === "wish"
            ? "What would you like the app to do?"
            : "What are you trying to figure out?"
        }
        value={msg}
        onChange={(e) => { setMsg(e.target.value); setSent(false); }}
      />

      <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>
        We'll automatically include your app version ({APP_VERSION}) and current group to help us track it down.
      </div>

      {err && <div style={{ color: "#f0a99f", fontSize: 12, marginTop: 8 }}>{err}</div>}

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <button onClick={submit} disabled={busy || !msg.trim()} style={{ ...btn(true), opacity: busy || !msg.trim() ? 0.5 : 1 }}>
          {busy ? "Sending…" : "Send"}
        </button>
        {sent && <span style={{ color: C.sage, fontSize: 13 }}>✓ Thanks — sent. We read every one.</span>}
      </div>
    </div>
  );
}

// ---------------- Admin review surface ----------------
type Row = {
  id: string;
  user_name: string | null;
  kind: string;
  message: string;
  app_version: string | null;
  context: string | null;
  status: string;
  created_at: string;
};

export function AdminFeedbackTab() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "new" | "triaged" | "done">("new");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("feedback").select("*").order("created_at", { ascending: false });
    setRows((data as Row[]) || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const setStatus = async (id: string, status: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, status } : r))); // optimistic
    const supabase = createClient();
    await supabase.from("feedback").update({ status }).eq("id", id);
  };
  const remove = async (id: string) => {
    if (!confirm("Delete this feedback item?")) return;
    setRows((rs) => rs.filter((r) => r.id !== id));
    const supabase = createClient();
    await supabase.from("feedback").delete().eq("id", id);
  };

  const shown = rows.filter((r) => filter === "all" || r.status === filter);
  const counts = {
    new: rows.filter((r) => r.status === "new").length,
    triaged: rows.filter((r) => r.status === "triaged").length,
    done: rows.filter((r) => r.status === "done").length,
  };

  const fmt = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); }
    catch { return iso; }
  };

  const fbtn = (k: "all" | "new" | "triaged" | "done", label: string) => (
    <button onClick={() => setFilter(k)} style={{ ...btn(filter === k), fontSize: 12, padding: "6px 11px" }}>{label}</button>
  );

  return (
    <div>
      <Eyebrow>FEEDBACK · BUGS &amp; REQUESTS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        {counts.new} new · {counts.triaged} triaged · {counts.done} done
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {fbtn("new", "New")}
        {fbtn("triaged", "Triaged")}
        {fbtn("done", "Done")}
        {fbtn("all", "All")}
      </div>

      {loading ? (
        <div style={{ color: C.sage, fontSize: 13, marginTop: 16 }}>Loading…</div>
      ) : shown.length === 0 ? (
        <div style={{ color: C.faint, fontSize: 13, marginTop: 16 }}>Nothing here.</div>
      ) : (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {shown.map((r) => (
            <div key={r.id} style={{ background: C.card, borderRadius: 12, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ background: KIND_COLOR[r.kind] || C.faint, color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: ".05em", textTransform: "uppercase", padding: "3px 8px", borderRadius: 6 }}>
                  {KIND_LABEL[r.kind] || r.kind}
                </span>
                <span style={{ color: C.ink, fontWeight: 700, fontSize: 13 }}>{r.user_name || "Someone"}</span>
                <span style={{ color: C.faint, fontSize: 11.5 }}>{fmt(r.created_at)}</span>
                {r.app_version && <span style={{ color: C.faint, fontSize: 11 }}>· v{r.app_version}</span>}
                {r.status !== "new" && (
                  <span style={{ marginLeft: "auto", color: r.status === "done" ? "#1f8f54" : C.gold, fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".05em" }}>{r.status}</span>
                )}
              </div>
              <div style={{ color: C.ink, fontSize: 13, lineHeight: 1.5, marginTop: 8, whiteSpace: "pre-wrap" }}>{r.message}</div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {r.status !== "new" && <button onClick={() => setStatus(r.id, "new")} style={{ ...btn(false), fontSize: 11.5, padding: "5px 10px" }}>Mark new</button>}
                {r.status !== "triaged" && <button onClick={() => setStatus(r.id, "triaged")} style={{ ...btn(false), fontSize: 11.5, padding: "5px 10px" }}>Triaged</button>}
                {r.status !== "done" && <button onClick={() => setStatus(r.id, "done")} style={{ ...btn(true), fontSize: 11.5, padding: "5px 10px" }}>Done</button>}
                <button onClick={() => remove(r.id)} style={{ background: "none", border: "none", color: C.faint, fontSize: 11.5, cursor: "pointer", marginLeft: "auto" }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
