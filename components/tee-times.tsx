"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, courseHandicap } from "@/lib/golf";
import { Avatar, btn, inputStyle, Eyebrow, FieldLabel } from "@/components/ui";
import { loadFormDraft, saveFormDraft, clearFormDraft, draftAgeLabel } from "@/lib/form-draft";

const supabase = createClient();

type TeeTime = {
  id: string; group_id: string; created_by: string | null; seq: number | null;
  title: string | null; kind: string | null; course: string | null; play_date: string;
  tee_off_times: string[] | null; signup_opens_at: string | null; signup_deadline: string | null;
  max_spots: number | null; notes: string | null; status: string; captain_user_id: string | null; game_id: string | null;
};
type Rsvp = { id: string; tee_time_id: string; user_id: string; choice: "in" | "out" | "maybe"; guest_names: string[]; signup_order: number | null };
type Member = { id: string; display_name: string; avatar_url: string | null; handicap_index: number | null };

const KINDS = [
  { k: "scheduled", label: "Scheduled", bg: "#E6F0EA", fg: C.green },
  { k: "major", label: "Major", bg: "#f6e3c4", fg: "#8a5a12" },
  { k: "friendly", label: "Friendly", bg: "#e7eef7", fg: C.bogey },
];
const kindOf = (k: string | null) => KINDS.find((x) => x.k === (k || "scheduled")) || KINDS[0];
const CHOICE: Record<string, { c: string; label: string; icon: string }> = {
  in: { c: "#1a7a3a", label: "In", icon: "✓" },
  maybe: { c: "#C9821F", label: "Maybe", icon: "?" },
  out: { c: C.birdie, label: "Out", icon: "✕" },
};

const fmtFull = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
const dow = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
const dayN = (d: string) => new Date(d + "T12:00:00").getDate();
const monN = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short" }).toUpperCase();
const shortCourse = (c: string | null) => (c ? (c.split(/\s[\u2013-]\s/).pop() || c).trim() : "");
const shortDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
const teeName = (t: { title: string | null; kind: string | null; course: string | null; play_date: string }) =>
  (t.title && t.title.trim()) || [kindOf(t.kind).label, shortCourse(t.course), shortDate(t.play_date)].filter(Boolean).join(" \u00b7 ");

// Section-label spacing for Tee Times (gold eyebrows were flush against the cards).

function DateBadge({ d }: { d: string }) {
  return (
    <div style={{ width: 46, textAlign: "center", background: C.sage, borderRadius: 10, padding: "6px 0", flex: "none" }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: C.green, letterSpacing: 0.5 }}>{dow(d)}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.ink, lineHeight: 1 }}>{dayN(d)}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.green }}>{monN(d)}</div>
    </div>
  );
}

export function TeeTimes({ user, activeGroupId, activeGroupName, canManage, initialTeeId, onConsumedDeepLink, onSpawnGame, onOpenGame }: {
  user: { id: string };
  activeGroupId: string;
  activeGroupName: string;
  canManage: boolean;
  initialTeeId?: string | null;
  onConsumedDeepLink?: () => void;
  onSpawnGame?: (seed: { teeTimeId: string; course: string | null; playDate: string; memberIds: string[]; guests: { name: string; sponsorUserId: string }[] }) => void;
  onOpenGame?: (gameId: string) => void;
}) {
  const [tees, setTees] = useState<TeeTime[]>([]);
  const [rsvps, setRsvps] = useState<Rsvp[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"upcoming" | "past" | "cancelled">("upcoming");
  const [screen, setScreen] = useState<"list" | "detail" | "create">("list");
  const [selId, setSelId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<"info" | "signups" | "activity">("info");
  const [rsvpOpen, setRsvpOpen] = useState(false);
  const [captainPickerOpen, setCaptainPickerOpen] = useState(false);
  const [dutiesOpen, setDutiesOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [courseData, setCourseData] = useState<Record<string, { slope: number; rating: number; par: number }>>({});
  const [activity, setActivity] = useState<any[]>([]);
  const [copied, setCopied] = useState(false);
  const [remindCopied, setRemindCopied] = useState(false);
  const [signupCopied, setSignupCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dlDone, setDlDone] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: tt } = await supabase.from("tee_times").select("*").eq("group_id", activeGroupId).order("play_date", { ascending: false });
    const list = (tt || []) as TeeTime[];
    setTees(list);
    const ids = list.map((t) => t.id);
    if (ids.length) {
      const { data: rs } = await supabase.from("tee_time_rsvps").select("*").in("tee_time_id", ids);
      setRsvps((rs || []) as Rsvp[]);
    } else setRsvps([]);
    const rpc = await supabase.rpc("group_roster", { p_group: activeGroupId });
    setMembers(((rpc.data as any[]) || []).map((m) => ({ id: m.id, display_name: m.display_name, avatar_url: m.avatar_url, handicap_index: m.handicap_index })));
    const { data: fc } = await supabase.from("favorite_courses").select("name, data").eq("group_id", activeGroupId);
    const cmap: Record<string, { slope: number; rating: number; par: number }> = {};
    (fc || []).forEach((row: any) => {
      const d = row?.data || {};
      let holes = d.holes; const tees = Array.isArray(d.tees) ? d.tees : [];
      if ((!holes || !holes.length) && tees.length) { const t = tees.find((x: any) => x.holes && x.holes.length); if (t) holes = t.holes; }
      const tee = tees[0];
      const par = Array.isArray(holes) ? holes.reduce((sum: number, h: any) => sum + (h.par || 0), 0) : (d.par || null);
      if (tee && tee.rating != null && tee.slope != null && par) cmap[row.name] = { slope: Number(tee.slope), rating: Number(tee.rating), par: Number(par) };
    });
    setCourseData(cmap);
    const { data: act } = await supabase.from("group_activity").select("*").eq("group_id", activeGroupId).like("action", "tt%").order("created_at", { ascending: false }).limit(300);
    setActivity((act || []) as any[]);
    setLoading(false);
  }, [activeGroupId]);
  useEffect(() => { load(); }, [load]);

  const memberOf = (id: string) => members.find((m) => m.id === id);
  const rsvpsFor = (ttId: string) => rsvps.filter((r) => r.tee_time_id === ttId);
  const myRsvp = (ttId: string) => rsvpsFor(ttId).find((r) => r.user_id === user.id);
  const inList = (ttId: string) => rsvpsFor(ttId).filter((r) => r.choice === "in").sort((a, b) => (a.signup_order || 0) - (b.signup_order || 0));
  const spotsUsed = (ttId: string) => inList(ttId).reduce((s, r) => s + 1 + (r.guest_names?.length || 0), 0);

  const midnight = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
  const isPast = (t: TeeTime) => new Date(t.play_date + "T12:00:00") < midnight();
  const upcoming = tees.filter((t) => t.status !== "cancelled" && !isPast(t)).sort((a, b) => +new Date(a.play_date) - +new Date(b.play_date));
  const past = tees.filter((t) => t.status !== "cancelled" && isPast(t));
  const cancelled = tees.filter((t) => t.status === "cancelled");
  const pending = upcoming.filter((t) => !myRsvp(t.id));
  const shown = filter === "upcoming" ? upcoming : filter === "past" ? past : cancelled;
  const sel = tees.find((t) => t.id === selId) || null;

  // Append-only audit trail to group_activity (immutable, member-visible) so a
  // disputed "but I signed up" has a timestamped record. tt-prefixed actions are
  // filtered out of the Money log so they don't bleed into it.
  async function logTee(action: string, summary: string, meta: Record<string, any>) {
    try { await supabase.from("group_activity").insert({ group_id: activeGroupId, actor_user_id: user.id, action, summary, meta }); } catch { /* logging never blocks the action */ }
  }

  async function submitRsvp(tt: TeeTime, choice: "in" | "out" | "maybe", guestNames: string[]) {
    setBusy(true); setActionErr(null);
    const existing = myRsvp(tt.id);
    const order = existing?.signup_order ?? rsvpsFor(tt.id).length + 1;
    const { error } = await supabase.from("tee_time_rsvps").upsert(
      { tee_time_id: tt.id, user_id: user.id, choice, guest_names: choice === "in" ? guestNames : [], signup_order: order, responded_at: new Date().toISOString() },
      { onConflict: "tee_time_id,user_id" },
    );
    if (error) { setBusy(false); if (typeof window !== "undefined") window.alert("Couldn't save your RSVP — please try again."); return; }
    const gtxt = choice === "in" && guestNames.length ? ` (+${guestNames.length} guest${guestNames.length > 1 ? "s" : ""})` : "";
    await logTee("tt_rsvp", `responded ${CHOICE[choice].label}${gtxt} for tee time #${tt.seq ?? "?"}`, { tee_time_id: tt.id, seq: tt.seq, choice, guests: choice === "in" ? guestNames.length : 0 });
    setBusy(false); setRsvpOpen(false); await load();
  }
  async function orgSetRsvp(tt: TeeTime, memberId: string, choice: "in" | "out" | "maybe") {
    setBusy(true); setActionErr(null);
    const existing = rsvpsFor(tt.id).find((r) => r.user_id === memberId);
    const order = existing?.signup_order ?? rsvpsFor(tt.id).length + 1;
    // Guests only ride along on an IN response. When marking a member out/maybe,
    // clear their guests too (matches what a member's own RSVP does) so guests
    // don't linger on the row or reappear if they're later marked back in.
    const { error } = await supabase.from("tee_time_rsvps").upsert(
      { tee_time_id: tt.id, user_id: memberId, choice, guest_names: choice === "in" ? (existing?.guest_names || []) : [], signup_order: order, responded_at: new Date().toISOString() },
      { onConflict: "tee_time_id,user_id" },
    );
    if (error) { setBusy(false); setActionErr("Couldn't update that RSVP — please try again."); return; }
    await logTee("tt_rsvp_org", `marked ${shortName(memberOf(memberId)?.display_name || "a member")} ${CHOICE[choice].label} for tee time #${tt.seq ?? "?"}`, { tee_time_id: tt.id, seq: tt.seq, choice, target_user_id: memberId });
    setBusy(false); await load();
  }
  async function cancelTeeTime(tt: TeeTime) {
    setBusy(true); setActionErr(null);
    const { error } = await supabase.from("tee_times").update({ status: "cancelled" }).eq("id", tt.id);
    if (error) { setBusy(false); setActionErr("Couldn't cancel this tee time — please try again."); return; }
    await logTee("tt_cancelled", `cancelled tee time #${tt.seq ?? "?"} (${teeName(tt)})`, { tee_time_id: tt.id, seq: tt.seq });
    setBusy(false); setScreen("list"); await load();
  }
  async function setCaptain(tt: TeeTime, memberId: string | null) {
    setBusy(true); setActionErr(null);
    const { error } = await supabase.rpc("set_tee_time_captain", { p_tee_time_id: tt.id, p_new_captain: memberId });
    if (error) { setBusy(false); setActionErr(error.message?.includes("In for this round") ? "That player needs to RSVP \u201cIn\u201d before they can be captain." : error.message?.includes("Not authorized") ? "Only an admin, the tee-time creator, or the current captain can set the captain." : "Couldn't update the captain — please try again."); return; }
    await logTee("tt_captain", memberId ? `assigned ${shortName(memberOf(memberId)?.display_name || "a member")} as captain for tee time #${tt.seq ?? "?"}` : `cleared the captain for tee time #${tt.seq ?? "?"}`, { tee_time_id: tt.id, seq: tt.seq, target_user_id: memberId });
    setBusy(false); setCaptainPickerOpen(false); await load();
  }
  async function promote(tt: TeeTime, memberId: string) {
    const list = inList(tt.id);
    const minOrder = Math.min(...list.map((r) => r.signup_order || 0));
    setBusy(true); setActionErr(null);
    const { error } = await supabase.from("tee_time_rsvps").update({ signup_order: minOrder - 1 }).eq("tee_time_id", tt.id).eq("user_id", memberId);
    if (error) { setBusy(false); setActionErr("Couldn't move that member up — please try again."); return; }
    await logTee("tt_promote", `moved ${shortName(memberOf(memberId)?.display_name || "a member")} up from the waitlist for tee time #${tt.seq ?? "?"}`, { tee_time_id: tt.id, seq: tt.seq, target_user_id: memberId });
    setBusy(false); await load();
  }
  const deadlinePassed = (t: TeeTime) => !!t.signup_deadline && new Date(t.signup_deadline) < new Date();
  // Organizer removes a single guest from a member's IN row, freeing exactly one
  // spot. The field/waitlist split recomputes by signup order on reload, so the
  // next waitlisted member moves into the field automatically.
  async function dropGuest(tt: TeeTime, memberId: string, guestIdx: number) {
    const r = rsvpsFor(tt.id).find((x) => x.user_id === memberId);
    if (!r || !r.guest_names || guestIdx < 0 || guestIdx >= r.guest_names.length) return;
    const gname = r.guest_names[guestIdx] || "Guest";
    const hostName = memberOf(memberId)?.display_name || "a member";
    if (typeof window !== "undefined" && !window.confirm(`Remove guest "${gname}" from ${hostName}'s signup? This frees a spot for the waitlist.`)) return;
    const next = r.guest_names.filter((_, i) => i !== guestIdx);
    setBusy(true); setActionErr(null);
    const { error } = await supabase.from("tee_time_rsvps").update({ guest_names: next }).eq("tee_time_id", tt.id).eq("user_id", memberId);
    if (error) { setBusy(false); setActionErr("Couldn't remove that guest — please try again."); return; }
    await logTee("tt_guest_removed", `removed ${shortName(hostName)}'s guest "${gname}" from tee time #${tt.seq ?? "?"}`, { tee_time_id: tt.id, seq: tt.seq, target_user_id: memberId, guest_name: gname });
    if (memberId !== user.id) {
      try { await supabase.rpc("create_notification", { p_recipient: memberId, p_message: `An organizer removed your guest "${gname}" from tee time #${tt.seq ?? "?"} (${teeName(tt)}) to free a spot.`, p_group_id: activeGroupId }); } catch { /* notification is best-effort */ }
    }
    setBusy(false); await load();
  }
  const copyExport = async (tt: TeeTime) => { try { await navigator.clipboard.writeText(teeExport(tt, inList(tt.id), memberOf, courseData, activeGroupName)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* clipboard unavailable */ } };
  const copyReminder = async (tt: TeeTime) => {
    const respondedIds = new Set(rsvpsFor(tt.id).map((r) => r.user_id));
    const notResponded = members.filter((m) => !respondedIds.has(m.id)).length;
    try { await navigator.clipboard.writeText(teeReminderExport(tt, inList(tt.id), notResponded, activeGroupName)); setRemindCopied(true); setTimeout(() => setRemindCopied(false), 2000); } catch { /* clipboard unavailable */ }
  };
  // Admin only: mint a multi-use group invite code and build a link that lets a BRAND-NEW
  // player join the group and land straight on this tee time to RSVP. Members who tap it
  // are simply taken to the tee time (redeem is a no-op for an existing member).
  const copySignupLink = async (tt: TeeTime) => {
    setBusy(true);
    try {
      const { data: code, error } = await supabase.rpc("create_group_invite_multi", {
        invite_group: activeGroupId, invite_role: "member", hours: 336, uses: null,
      });
      if (error || !code) { setBusy(false); return; }
      const origin = (typeof window !== "undefined" && window.location?.origin) ? window.location.origin : "https://birdienumnum.vercel.app";
      const link = `${origin}/join/${code}?tt=${tt.id}`;
      await navigator.clipboard.writeText(teeSignupExport(tt, link, activeGroupName));
      setSignupCopied(true); setTimeout(() => setSignupCopied(false), 2000);
    } catch { /* clipboard/rpc unavailable */ }
    setBusy(false);
  };

  const open = (id: string) => { setSelId(id); setDetailTab("info"); setScreen("detail"); };
  const openEdit = (id: string) => { setEditId(id); setScreen("create"); };

  // Deep link (from a WhatsApp reminder, e.g. birdienumnum.vercel.app/?tt=<id>):
  // once tee times have loaded, jump straight to that tee time and open its RSVP
  // window (unless it's cancelled or already in the past). Fires only once.
  useEffect(() => {
    if (loading || dlDone || !initialTeeId) return;
    const t = tees.find((x) => x.id === initialTeeId);
    if (t) {
      setSelId(t.id); setDetailTab("info"); setScreen("detail");
      if (t.status !== "cancelled" && !isPast(t)) setRsvpOpen(true);
    }
    setDlDone(true);
    onConsumedDeepLink?.();
  }, [loading, dlDone, initialTeeId, tees]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------- CREATE ----------------
  if (screen === "create") return <CreateForm user={user} groupId={activeGroupId} editing={editId ? tees.find((t) => t.id === editId) || null : null} existingSeqs={tees.map((t) => t.seq).filter((n): n is number => n != null)} onCancel={() => { setEditId(null); setScreen("list"); }} onCreated={async () => { setEditId(null); setScreen("list"); await load(); }} />;

  // ---------------- DETAIL ----------------
  if (screen === "detail" && sel) {
    const k = kindOf(sel.kind);
    const mine = myRsvp(sel.id);
    const ins = inList(sel.id);
    const maybes = rsvpsFor(sel.id).filter((r) => r.choice === "maybe");
    const outs = rsvpsFor(sel.id).filter((r) => r.choice === "out");
    const used = spotsUsed(sel.id);
    const spotsLeft = sel.max_spots != null ? sel.max_spots - used : null;
    const responded = new Set(rsvpsFor(sel.id).map((r) => r.user_id));
    const notResponded = members.filter((m) => !responded.has(m.id));
    // waitlist: cumulative In spots beyond max, with each waitlisted member's
    // position (#1, #2, …) by signup order so we can show "Waitlist #N".
    let cum = 0; let wc = 0;
    const waitSet = new Set<string>();
    const waitPos = new Map<string, number>();
    if (sel.max_spots != null) ins.forEach((r) => { cum += 1 + (r.guest_names?.length || 0); if (cum > sel.max_spots!) { wc++; waitSet.add(r.user_id); waitPos.set(r.user_id, wc); } });
    const canOrganizeTee = canManage || sel.created_by === user.id; // admin OR the tee-time creator
    const isCaptain = sel.captain_user_id === user.id;
    const frozen = isPast(sel) && !canOrganizeTee;
    const hasGameBtn = sel.status !== "cancelled" && (!!sel.game_id || (ins.length > 0 && (canOrganizeTee || isCaptain)));
    const spawnGame = () => onSpawnGame?.({ teeTimeId: sel.id, course: sel.course, playDate: sel.play_date, memberIds: ins.map((r) => r.user_id), guests: ins.flatMap((r) => (r.guest_names || []).map((name) => ({ name, sponsorUserId: r.user_id }))) });

    const memberRow = (r: Rsvp, showOrg: boolean, wait?: boolean) => {
      const m = memberOf(r.user_id);
      const name = m?.display_name || "Member";
      const cdSel = courseData[sel.course || ""];
      const chSel = cdSel && m?.handicap_index != null ? courseHandicap(Number(m.handicap_index), cdSel.slope, cdSel.rating, cdSel.par) : null;
      return (
        <div key={r.user_id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
          <Avatar src={m?.avatar_url || undefined} name={name} size={34} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{name}{r.user_id === user.id ? " (you)" : ""}</div>
            <div style={{ fontSize: 11, color: C.faint }}>
              {m?.handicap_index != null ? `Idx ${m.handicap_index}${chSel != null ? ` \u00b7 CH ${chSel}` : ""}` : "no idx"}
              {r.guest_names?.length && !canOrganizeTee ? ` · +${r.guest_names.length} guest: ${r.guest_names.join(", ")}` : ""}
            </div>
            {canOrganizeTee && r.guest_names?.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                {r.guest_names.map((gn, gi) => (
                  <span key={gi} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#eef3ee", border: `1px solid ${C.line}`, borderRadius: 999, padding: "2px 6px 2px 9px", fontSize: 11, color: C.ink }}>
                    {gn || "Guest"}
                    <button onClick={() => dropGuest(sel, r.user_id, gi)} disabled={busy} aria-label={`Remove guest ${gn || ""}`} title="Remove guest (frees a spot)" style={{ background: "none", border: "none", color: C.birdie, cursor: "pointer", fontSize: 12, padding: 0, lineHeight: 1 }}>✕</button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>
          {wait ? <span style={{ fontSize: 11, fontWeight: 800, background: "#fbe9cf", color: "#9a6a12", borderRadius: 20, padding: "3px 9px" }}>Waitlist{waitPos.get(r.user_id) ? ` #${waitPos.get(r.user_id)}` : ""}</span> : null}
          {wait && canOrganizeTee ? <button onClick={() => promote(sel, r.user_id)} disabled={busy} style={{ ...btn(false), fontSize: 11, padding: "5px 9px" }}>Move up</button> : null}
          {showOrg && canOrganizeTee ? (
            <button onClick={() => orgSetRsvp(sel, r.user_id, r.choice === "in" ? "out" : "in")} disabled={busy}
              style={{ ...btn(false), fontSize: 11, padding: "5px 9px" }}>{r.choice === "in" ? "Mark out" : "Mark in"}</button>
          ) : null}
        </div>
      );
    };

    return (
      <div>
        <div style={{ background: `linear-gradient(160deg,#0b2f24,${C.greenLight})`, padding: 16, borderRadius: 14, color: C.cream }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button onClick={() => setScreen("list")} style={{ ...btn(false), fontSize: 12, padding: "6px 10px" }}>‹ Back</button>
            {canOrganizeTee && <button onClick={() => openEdit(sel.id)} style={{ ...btn(false), fontSize: 12, padding: "6px 10px" }}>Edit</button>}
          </div>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, letterSpacing: 0.4, marginTop: 10 }}>TEE TIME #{sel.seq ?? "—"}</div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 3 }}>{teeName(sel)}</div>
          <div style={{ fontSize: 13, opacity: 0.78, marginTop: 3 }}>
            {fmtFull(sel.play_date)}{sel.tee_off_times?.length ? ` · ${sel.tee_off_times.join("/")}` : ""}{sel.course ? ` · ${sel.course}` : ""}
          </div>
          {sel.status === "cancelled" ? <div style={{ marginTop: 8, display: "inline-block", background: "rgba(184,58,46,0.3)", borderRadius: 6, padding: "2px 8px", fontSize: 11, fontWeight: 800 }}>CANCELLED</div> : null}
        </div>

        {actionErr && (
          <div onClick={() => setActionErr(null)} style={{ background: "rgba(184,58,46,0.18)", border: `1px solid ${C.birdie}`, color: "#ffd9cf", borderRadius: 10, padding: "10px 12px", margin: "10px 0", fontSize: 12.5, cursor: "pointer" }}>
            {actionErr} <span style={{ opacity: 0.7 }}>(tap to dismiss)</span>
          </div>
        )}

        {sel.status !== "cancelled" && (
          <div style={{ background: C.sage, borderRadius: 12, margin: "10px 0", padding: "11px 14px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontSize: 13, color: C.ink }}>
              {frozen ? "This tee time has passed" : mine ? <>Your response: <b style={{ color: CHOICE[mine.choice].c }}>{CHOICE[mine.choice].label}</b>{mine.choice === "in" && sel.max_spots != null ? (waitSet.has(user.id) ? <span style={{ color: "#9a6a12", fontWeight: 700 }}> — Waitlist #{waitPos.get(user.id)}</span> : <span style={{ color: "#1a7a3a", fontWeight: 700 }}> — In the field</span>) : null}</> : "You haven't responded"}
            </div>
            {!frozen && <button onClick={() => setRsvpOpen(true)} style={{ ...btn(true), fontSize: 12, padding: "7px 12px" }}>{mine ? "Change" : "RSVP"}</button>}
          </div>
        )}

        <div style={{ display: "flex", background: C.greenMid, borderRadius: 10, overflow: "hidden", margin: "10px 0" }}>
          {(["info", "signups", "activity"] as const).map((t) => (
            <button key={t} onClick={() => setDetailTab(t)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: "11px 0", fontSize: 12, fontWeight: 700, color: detailTab === t ? C.cream : C.sage, borderBottom: detailTab === t ? `2px solid ${C.gold}` : "2px solid transparent" }}>{t === "info" ? "Info" : t === "signups" ? "Signups" : "Activity"}</button>
          ))}
        </div>

        {detailTab === "info" ? (
          <>
          <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
            {[["Tee time", "#" + (sel.seq ?? "—")], ["Date", fmtFull(sel.play_date)], ["Tee-off", sel.tee_off_times?.length ? sel.tee_off_times.join("/") : "—"], ["Course", sel.course || "—"], ["Type", kindOf(sel.kind).label], ["Spots", sel.max_spots != null ? `${used} / ${sel.max_spots}` : `${used}`], ["Notes", sel.notes || "—"]].map(([l, v], i, arr) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", padding: "11px 14px", borderBottom: i < arr.length - 1 ? `1px solid ${C.line}` : "none" }}>
                <div style={{ fontSize: 12, color: C.faint }}>{l}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.ink, textAlign: "right", maxWidth: "62%" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ background: C.card, borderRadius: 14, padding: "11px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: C.faint }}>Captain</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{sel.captain_user_id ? (memberOf(sel.captain_user_id)?.display_name || "Assigned") : "Not assigned"}</div>
            </div>
            {(canOrganizeTee || isCaptain) && !isPast(sel) && sel.status !== "cancelled" && <button onClick={() => setCaptainPickerOpen(true)} style={{ ...btn(false), fontSize: 11, padding: "5px 9px" }}>{sel.captain_user_id ? "Change" : "Assign"}</button>}
            <button onClick={() => setDutiesOpen(true)} style={{ ...btn(false), fontSize: 11, padding: "5px 9px" }}>Duties</button>
          </div>
          {sel.status !== "cancelled" && !isPast(sel) && (
            sel.game_id ? (
              (canOrganizeTee || isCaptain) ? <button onClick={() => onOpenGame?.(sel.game_id!)} style={{ ...btn(true), width: "100%", marginTop: 10, fontSize: 13 }}>Open linked game ›</button> : null
            ) : ins.length === 0 ? (
              (canOrganizeTee || isCaptain) ? <div style={{ background: "#14352b", borderRadius: 12, padding: "11px 14px", marginTop: 10, fontSize: 12.5, color: C.sage, lineHeight: 1.45 }}>Once players sign up, the captain can create the game from here.</div> : null
            ) : !sel.captain_user_id ? (
              <div style={{ background: "#14352b", borderRadius: 12, padding: "12px 14px", marginTop: 10 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.cream }}>Assign a captain to create the game</div>
                <div style={{ fontSize: 12, color: C.sage, marginTop: 3, lineHeight: 1.45 }}>The captain sets up and runs the game for this round. {canOrganizeTee ? "Pick anyone who's In — you can choose yourself." : "An organizer will assign one soon."}</div>
                {canOrganizeTee ? <button onClick={() => setCaptainPickerOpen(true)} style={{ ...btn(true), width: "100%", marginTop: 10, fontSize: 13 }}>Assign captain</button> : null}
                {canOrganizeTee && !ins.some((r) => r.user_id === user.id) ? <div style={{ fontSize: 11, color: C.sage, opacity: 0.75, marginTop: 6 }}>To captain it yourself, RSVP “In” first.</div> : null}
              </div>
            ) : isCaptain ? (
              <div style={{ marginTop: 10 }}>
                <div style={{ background: "#14352b", borderRadius: 12, padding: "11px 14px", fontSize: 12.5, color: C.sage, lineHeight: 1.45 }}>You're the captain — set up the game when you're ready.</div>
                <button onClick={spawnGame} style={{ ...btn(true), width: "100%", marginTop: 8, fontSize: 13 }}>Create game from this tee time</button>
              </div>
            ) : (
              <div style={{ background: "#14352b", borderRadius: 12, padding: "11px 14px", marginTop: 10, fontSize: 12.5, color: C.sage, lineHeight: 1.45 }}>
                <span><b style={{ color: C.cream }}>{memberOf(sel.captain_user_id)?.display_name || "The captain"}</b> is the captain and will set up the game.</span>
                {canManage ? <button onClick={spawnGame} style={{ ...btn(true), width: "100%", marginTop: 10, fontSize: 13 }}>Create game from this tee time (admin)</button> : null}
              </div>
            )
          )}
          <button onClick={() => copyExport(sel)} style={{ ...btn(!hasGameBtn), width: "100%", marginTop: hasGameBtn ? 8 : 10, fontSize: 13 }}>{copied ? "Copied ✓" : "Copy for WhatsApp"}</button>
          {canOrganizeTee && sel.status !== "cancelled" && !isPast(sel) && (
            <button onClick={() => copyReminder(sel)} style={{ ...btn(false), width: "100%", marginTop: 8, fontSize: 13 }}>{remindCopied ? "Reminder copied ✓" : "Copy reminder for WhatsApp"}</button>
          )}
          {canOrganizeTee && sel.status !== "cancelled" && !isPast(sel) && (
            <button onClick={() => copySignupLink(sel)} disabled={busy} style={{ ...btn(false), width: "100%", marginTop: 8, fontSize: 13, opacity: busy ? 0.6 : 1 }}>{signupCopied ? "Sign-up link copied ✓" : "Copy sign-up link (new players)"}</button>
          )}
          </>
        ) : detailTab === "signups" ? (
          <div>
            <div style={{ background: C.card, borderRadius: 14, overflow: "hidden", display: "flex", marginBottom: 10 }}>
              {[["In", ins.reduce((s, r) => s + 1 + (r.guest_names?.length || 0), 0), "#1a7a3a"], ["Maybe", maybes.length, "#C9821F"], ["Out", outs.length, C.birdie], ["Left", spotsLeft ?? "—", C.green]].map(([l, n, col], i) => (
                <div key={l as string} style={{ flex: 1, textAlign: "center", padding: "12px 0", borderRight: i < 3 ? `1px solid ${C.line}` : "none" }}>
                  <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "Georgia, serif", color: col as string }}>{n as any}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.6, color: C.faint, textTransform: "uppercase" }}>{l}</div>
                </div>
              ))}
            </div>
            {ins.length > 0 && <><Eyebrow>{`In — ${ins.reduce((s, r) => s + 1 + (r.guest_names?.length || 0), 0)}${sel.max_spots != null ? ` of ${sel.max_spots} spots` : ""}`}</Eyebrow><div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>{ins.map((r) => memberRow(r, true, waitSet.has(r.user_id)))}</div></>}
            {maybes.length > 0 && <><Eyebrow>{`Maybe (${maybes.length})`}</Eyebrow><div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>{maybes.map((r) => memberRow(r, true))}</div></>}
            {outs.length > 0 && <><Eyebrow>{`Out (${outs.length})`}</Eyebrow><div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>{outs.map((r) => memberRow(r, true))}</div></>}
            {canOrganizeTee && notResponded.length > 0 && (
              <><Eyebrow>{`Not responded (${notResponded.length})`}</Eyebrow>
                <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
                  {notResponded.map((m) => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
                      <Avatar src={m.avatar_url || undefined} name={m.display_name} size={34} />
                      <div style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 700, color: C.ink }}>{m.display_name}</div>
                      <button onClick={() => orgSetRsvp(sel, m.id, "in")} disabled={busy} style={{ ...btn(true), fontSize: 11, padding: "5px 9px" }}>In</button>
                      <button onClick={() => orgSetRsvp(sel, m.id, "out")} disabled={busy} style={{ ...btn(false), fontSize: 11, padding: "5px 9px" }}>Out</button>
                    </div>
                  ))}
                </div></>
            )}
          </div>
        ) : (
          <div>
            {(() => {
              const rows = activity.filter((a) => a?.meta?.tee_time_id === sel.id);
              if (rows.length === 0) return <div style={{ background: C.card, borderRadius: 14, padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>No activity yet.</div>;
              return (
                <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
                  {rows.map((a) => {
                    const who = shortName(memberOf(a.actor_user_id)?.display_name || "Someone");
                    const when = new Date(a.created_at).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                    return (
                      <div key={a.id} style={{ padding: "10px 14px", borderBottom: `1px solid ${C.line}` }}>
                        <div style={{ fontSize: 13, color: C.ink }}><b>{who}</b> {a.summary}</div>
                        <div style={{ fontSize: 11, color: C.faint, marginTop: 2 }}>{when}</div>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {canOrganizeTee && sel.status !== "cancelled" && (
          <button onClick={() => cancelTeeTime(sel)} disabled={busy} style={{ ...btn(false), width: "100%", marginTop: 14, fontSize: 13, color: C.birdie, borderColor: C.birdie }}>Cancel this tee time</button>
        )}

        {rsvpOpen && <RsvpSheet tt={sel} mine={mine} spotsLeft={spotsLeft} warn={deadlinePassed(sel) && !canManage} busy={busy} onClose={() => setRsvpOpen(false)} onSubmit={(choice, guests) => submitRsvp(sel, choice, guests)} />}
        {captainPickerOpen && <CaptainPicker candidates={ins.map((r) => members.find((m) => m.id === r.user_id)).filter(Boolean) as Member[]} current={sel.captain_user_id} busy={busy} onClose={() => setCaptainPickerOpen(false)} onPick={(id) => setCaptain(sel, id)} />}
        {dutiesOpen && <DutiesModal onClose={() => setDutiesOpen(false)} />}
      </div>
    );
  }

  // ---------------- LIST ----------------
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, color: C.cream }}>Tee Times</div>
          <div style={{ fontSize: 11, color: C.sage, textTransform: "uppercase", letterSpacing: 1 }}>{activeGroupName}</div>
        </div>
        <button onClick={() => setScreen("create")} style={{ ...btn(true), fontSize: 13, padding: "9px 14px" }}>+ New</button>
      </div>

      <div style={{ display: "flex", gap: 6, margin: "6px 0 4px" }}>
        {(["upcoming", "past", "cancelled"] as const).map((f) => (
          <button key={f} onClick={() => setFilter(f)} style={{ flex: 1, textAlign: "center", fontSize: 12, fontWeight: 700, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer", color: filter === f ? "#1c1706" : C.sage, background: filter === f ? C.gold : C.greenMid }}>{f[0].toUpperCase() + f.slice(1)}</button>
        ))}
      </div>

      {loading ? <div style={{ color: C.sage, textAlign: "center", padding: 40 }}>Loading tee times…</div> : (
        <>
          {filter === "upcoming" && pending.length > 0 && (
            <>
              <Eyebrow>{`Needs your response (${pending.length})`}</Eyebrow>
              <div style={{ background: C.card, borderRadius: 14, overflow: "hidden", border: `1.5px solid ${C.gold}`, marginBottom: 10 }}>
                {pending.map((t) => (
                  <div key={t.id} onClick={() => open(t.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer", borderBottom: `1px solid ${C.line}` }}>
                    <DateBadge d={t.play_date} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.green }}>TEE TIME #{t.seq ?? "—"}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>{teeName(t)}</div>
                      <div style={{ fontSize: 12, color: C.faint }}>{[t.course, (t.tee_off_times || []).join("/")].filter(Boolean).join(" · ")}</div>
                    </div>
                    <button onClick={(e) => { e.stopPropagation(); open(t.id); }} style={{ ...btn(true), fontSize: 12, padding: "7px 12px" }}>RSVP</button>
                  </div>
                ))}
              </div>
            </>
          )}

          <Eyebrow>{filter === "upcoming" ? "All upcoming" : filter === "past" ? "Past" : "Cancelled"}</Eyebrow>
          {shown.length === 0 ? (
            <div style={{ background: C.card, borderRadius: 14, padding: 24, textAlign: "center", color: C.faint, fontSize: 13 }}>Nothing here yet.</div>
          ) : (
            <div style={{ background: C.card, borderRadius: 14, overflow: "hidden" }}>
              {shown.map((t, i) => {
                const mine = myRsvp(t.id);
                const k = kindOf(t.kind);
                const used = spotsUsed(t.id);
                const over = t.max_spots != null && used > t.max_spots;
                return (
                  <div key={t.id} onClick={() => open(t.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", cursor: "pointer", borderBottom: i < shown.length - 1 ? `1px solid ${C.line}` : "none" }}>
                    <DateBadge d={t.play_date} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 800, color: C.green }}>TEE TIME #{t.seq ?? "—"}</div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: C.ink, textDecoration: t.status === "cancelled" ? "line-through" : "none" }}>{teeName(t)}</div>
                      <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                        <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 6, padding: "2px 7px", background: k.bg, color: k.fg }}>{k.label}</span>
                        {t.max_spots != null && <span style={{ fontSize: 11, color: C.faint }}>{used} / {t.max_spots} spots{over ? ` · waitlist ${used - t.max_spots}` : ""}</span>}
                      </div>
                    </div>
                    {mine ? <span style={{ fontSize: 11, fontWeight: 800, borderRadius: 20, padding: "3px 9px", background: CHOICE[mine.choice].c + "22", color: CHOICE[mine.choice].c }}>{CHOICE[mine.choice].label.toUpperCase()}</span> : <span style={{ color: C.faint, fontSize: 18 }}>›</span>}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------- RSVP SHEET ----------------
function RsvpSheet({ tt, mine, spotsLeft, warn, busy, onClose, onSubmit }: {
  tt: TeeTime; mine: Rsvp | undefined; spotsLeft: number | null; warn?: boolean; busy: boolean;
  onClose: () => void; onSubmit: (choice: "in" | "out" | "maybe", guests: string[]) => void;
}) {
  const [choice, setChoice] = useState<"in" | "out" | "maybe">(mine?.choice || "in");
  const [gCount, setGCount] = useState<number>(mine?.guest_names?.length || 0);
  const [gNames, setGNames] = useState<string[]>(mine?.guest_names || []);
  const setName = (i: number, v: string) => setGNames((p) => { const n = [...p]; n[i] = v; return n; });

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 70, background: C.green, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "8px 0 calc(16px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
        <div style={{ width: 40, height: 4, background: C.greenMid, borderRadius: 2, margin: "6px auto 10px" }} />
        <div style={{ padding: "0 16px 8px" }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.gold, letterSpacing: 0.4 }}>TEE TIME #{tt.seq ?? "—"} · {dow(tt.play_date)} {monN(tt.play_date)} {dayN(tt.play_date)}</div>
          <div style={{ fontSize: 19, fontWeight: 800, color: C.cream, marginTop: 2 }}>Your response</div>
          {spotsLeft != null && <div style={{ fontSize: 12, fontWeight: 700, color: spotsLeft <= 0 ? "#ff9d7a" : C.sage, marginTop: 3 }}>{spotsLeft > 0 ? `${spotsLeft} of ${tt.max_spots} spots left` : "This tee time's full — sign up and you'll join the waitlist, moving into the field automatically if a spot opens. Your RSVP still counts; no further action needed."}</div>}
        </div>
        {warn && <div style={{ margin: "4px 16px 8px", background: "#5a3a10", color: "#f6d98a", borderRadius: 10, padding: "9px 12px", fontSize: 12, lineHeight: 1.4 }}>Signup deadline has passed — you can still respond, but a spot isn't guaranteed.</div>}
        {(["in", "maybe", "out"] as const).map((c) => (
          <div key={c} onClick={() => setChoice(c)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 16px", cursor: "pointer", background: choice === c ? CHOICE[c].c + "1A" : "none", borderBottom: `1px solid ${C.greenMid}` }}>
            <div style={{ width: 40, height: 40, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, flex: "none", background: CHOICE[c].c + "2E", color: CHOICE[c].c }}>{CHOICE[c].icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: C.cream }}>{CHOICE[c].label}</div>
              <div style={{ fontSize: 12, color: C.sage }}>{c === "in" ? "I'm playing" : c === "maybe" ? "Not sure yet" : "Can't make it"}</div>
            </div>
            {choice === c ? <span style={{ color: CHOICE[c].c, fontSize: 18, fontWeight: 800 }}>●</span> : null}
          </div>
        ))}
        {choice === "in" && (
          <div style={{ padding: "12px 16px 0" }}>
            <FieldLabel style={{ marginBottom: 8 }}>Guests</FieldLabel>
            <div style={{ display: "flex", gap: 8 }}>
              {[0, 1, 2].map((n) => (
                <div key={n} onClick={() => setGCount(n)} style={{ flex: 1, textAlign: "center", padding: 9, borderRadius: 9, cursor: "pointer", fontWeight: 800, color: gCount === n ? "#1c1706" : C.cream, background: gCount === n ? C.gold : C.greenMid }}>{n}</div>
              ))}
            </div>
            {Array.from({ length: gCount }, (_, i) => (
              <input key={i} value={gNames[i] || ""} onChange={(e) => setName(i, e.target.value)} placeholder={`Guest ${i + 1} name`} style={{ ...inputStyle, width: "100%", marginTop: 8 }} />
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 10, padding: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ ...btn(false), flex: 1, fontSize: 13 }}>Cancel</button>
          <button onClick={() => onSubmit(choice, gNames.slice(0, gCount).filter(Boolean))} disabled={busy} style={{ ...btn(true), flex: 1, fontSize: 13 }}>{busy ? "Saving…" : "Confirm"}</button>
        </div>
      </div>
    </>
  );
}

// ---------------- CREATE FORM ----------------
function CreateForm({ user, groupId, editing, existingSeqs, onCancel, onCreated }: {
  user: { id: string }; groupId: string; editing?: TeeTime | null; existingSeqs: number[]; onCancel: () => void; onCreated: () => void;
}) {
  const [courses, setCourses] = useState<string[]>([]);
  const [kind, setKind] = useState(editing?.kind || "scheduled");
  const [title, setTitle] = useState(editing?.title || "");
  const [date, setDate] = useState(editing?.play_date || "");
  const [times, setTimes] = useState((editing?.tee_off_times || []).join(", "));
  const [course, setCourse] = useState(editing?.course || "");
  const [maxSpots, setMaxSpots] = useState(editing?.max_spots != null ? String(editing.max_spots) : "12");
  const [deadline, setDeadline] = useState(editing?.signup_deadline ? editing.signup_deadline.slice(0, 10) : "");
  const [notes, setNotes] = useState(editing?.notes || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const todayStr = (() => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; })();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("favorite_courses").select("name").eq("group_id", groupId);
      const names = Array.from(new Set(((data as any[]) || []).map((c) => c.name).filter(Boolean)));
      setCourses(names);
    })();
  }, [groupId]);

  const resumingRef = React.useRef(false);
  // auto-fill deadline 3 days before date
  useEffect(() => {
    if (resumingRef.current) { resumingRef.current = false; return; } // don't clobber a resumed deadline
    if (!date || editing) return;
    const d = new Date(date + "T12:00:00"); d.setDate(d.getDate() - 3);
    let dd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    if (dd < todayStr) dd = todayStr; // never default into the past (e.g. a round tomorrow)
    if (dd > date) dd = date;         // never default after the play date
    setDeadline(dd);
  }, [date, editing]);

  // ---- Resume an interrupted tee-time (device-local draft, new tee times only) ----
  type TeeDraftData = { kind: string; title: string; date: string; times: string; course: string; maxSpots: string; deadline: string; notes: string };
  const isNew = !editing;
  const teeDraftKey = `bnn_teetime_draft:${groupId}`;
  const teeHasProgress = (d: TeeDraftData) => !!(d.course || d.date || d.title.trim() || d.notes.trim() || d.times.trim());
  const [teeDraft, setTeeDraft] = useState<{ savedAt: number; data: TeeDraftData } | null>(null);
  const [teeDraftDismissed, setTeeDraftDismissed] = useState(false);
  const teeHydratedRef = React.useRef(false);

  useEffect(() => {
    if (!isNew) { teeHydratedRef.current = true; return; }
    const d = loadFormDraft<TeeDraftData>(teeDraftKey);
    if (d && teeHasProgress(d.data)) setTeeDraft(d);
    else teeHydratedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyTeeDraft = (data: TeeDraftData) => {
    resumingRef.current = true;
    setKind(data.kind); setTitle(data.title); setDate(data.date); setTimes(data.times);
    setCourse(data.course); setMaxSpots(data.maxSpots); setDeadline(data.deadline); setNotes(data.notes);
    setTeeDraft(null); setTeeDraftDismissed(true); teeHydratedRef.current = true;
  };
  const startFreshTee = () => {
    clearFormDraft(teeDraftKey); setTeeDraft(null); setTeeDraftDismissed(true); teeHydratedRef.current = true;
  };

  useEffect(() => {
    if (!isNew || !teeHydratedRef.current) return;
    const data: TeeDraftData = { kind, title, date, times, course, maxSpots, deadline, notes };
    if (teeHasProgress(data)) saveFormDraft(teeDraftKey, data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, title, date, times, course, maxSpots, deadline, notes]);

  // Display preview only — the database assigns the authoritative number on insert
  // (atomically, collision-safe). This estimate may differ by one in a rare race.
  const yy = Number(String(new Date((date || new Date().toISOString().slice(0, 10)) + "T12:00:00").getFullYear()).slice(-2));
  const seq = editing?.seq != null ? editing.seq : yy * 100 + existingSeqs.filter((n) => Math.floor(n / 100) === yy).length + 1;

  async function post() {
    if (!date) { setErr("Pick a play date."); return; }
    if (!editing && date < todayStr) { setErr("Play date can't be in the past."); return; }
    if (deadline && deadline > date) { setErr("Signup deadline can't be after the play date."); return; }
    if (!editing && deadline && deadline < todayStr) { setErr("Signup deadline can't be in the past."); return; }
    const parsedTimes = times.split(",").map((t) => t.trim()).filter(Boolean);
    if (!parsedTimes.length) { setErr("Add at least one tee-off time."); return; }
    const rawCap = maxSpots.trim();
    let cap = 60; // blank => the 60-player max
    if (rawCap !== "") {
      const n = Number(rawCap);
      if (!Number.isInteger(n) || n < 1 || n > 60) { setErr("Max spots must be a whole number from 1 to 60 (leave blank for the 60-player max)."); return; }
      cap = n;
    }
    setBusy(true); setErr(null);
    if (editing) {
      const { error } = await supabase.from("tee_times").update({ kind, title: title.trim() || null, course: course || null, play_date: date, tee_off_times: parsedTimes, signup_deadline: deadline ? new Date(deadline + "T12:00:00").toISOString() : null, max_spots: cap, notes: notes.trim() || null, updated_at: new Date().toISOString() }).eq("id", editing.id);
      setBusy(false);
      if (error) { setErr("Couldn't save — please try again."); return; }
      onCreated(); return;
    }
    const payload = {
      group_id: groupId, created_by: user.id, kind,
      title: title.trim() || null,
      course: course || null,
      play_date: date,
      tee_off_times: parsedTimes,
      signup_deadline: deadline ? new Date(deadline + "T12:00:00").toISOString() : null,
      max_spots: cap,
      notes: notes.trim() || null,
      status: "upcoming",
    };
    const { data: created, error } = await supabase.from("tee_times").insert(payload).select("id, seq").single();
    setBusy(false);
    if (error) { setErr("Couldn't post — please try again."); return; }
    const assignedSeq = (created as any)?.seq ?? seq; // DB-assigned number is authoritative
    const nm = (title.trim() || [kindOf(kind).label, shortCourse(course || null), shortDate(date)].filter(Boolean).join(" \u00b7 "));
    try { await supabase.from("group_activity").insert({ group_id: groupId, actor_user_id: user.id, action: "tt_posted", summary: `posted tee time #${assignedSeq} (${nm})`, meta: { tee_time_id: (created as any)?.id, seq: assignedSeq } }); } catch { /* logging never blocks the post */ }
    clearFormDraft(teeDraftKey); // posted — drop the local draft
    onCreated();
  }

  const label = (t: string) => <FieldLabel style={{ marginTop: 12 }}>{t}</FieldLabel>;
  const hint = (t: string) => <div style={{ fontSize: 11, color: C.sage, opacity: 0.72, margin: "5px 0 2px", lineHeight: 1.35 }}>{t}</div>;
  const dateStyle: React.CSSProperties = { ...inputStyle, width: "100%", maxWidth: "100%", minWidth: 0, WebkitAppearance: "none", appearance: "none" };

  return (
    <div>
      <div style={{ fontSize: 20, fontWeight: 800, color: C.cream }}>{editing ? "Edit" : "New"} Tee Time <span style={{ fontSize: 13, color: C.gold }}>#{seq}</span></div>
      {teeDraft && !teeDraftDismissed && isNew && (
        <div style={{ marginTop: 12, background: "#14352b", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px" }}>
          <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>Resume your tee time?</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3, lineHeight: 1.45 }}>
            You left an unfinished tee time {draftAgeLabel(teeDraft.savedAt)}. Pick up where you left off, or start fresh.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button onClick={() => applyTeeDraft(teeDraft.data)} style={{ ...btn(true), fontSize: 13 }}>Resume</button>
            <button onClick={startFreshTee} style={{ ...btn(false), fontSize: 13 }}>Start fresh</button>
          </div>
        </div>
      )}
      {label("Type")}
      <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ ...inputStyle, width: "100%" }}>{KINDS.map((k) => <option key={k.k} value={k.k}>{k.label}</option>)}</select>
      {label("Title (optional)")}
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Saturday Meadow" style={{ ...inputStyle, width: "100%" }} />
      {label("Play date")}
      <input type="date" value={date} min={editing ? undefined : todayStr} onChange={(e) => setDate(e.target.value)} style={dateStyle} />
      {hint("Tap to choose the round date.")}
      {label("Tee-off time(s) — required, comma separated")}
      <input value={times} onChange={(e) => setTimes(e.target.value)} placeholder="e.g. 8:10 AM, 8:20 AM" style={{ ...inputStyle, width: "100%" }} />
      {label("Course")}
      <select value={course} onChange={(e) => setCourse(e.target.value)} style={{ ...inputStyle, width: "100%" }}>
        <option value="">— none —</option>
        {courses.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {label("Max spots")}
      <input value={maxSpots} onChange={(e) => setMaxSpots(e.target.value)} type="number" min={1} max={60} step={1} placeholder="Blank = 60 (max)" style={{ ...inputStyle, width: "100%" }} />
      {label("Signup deadline")}
      <input type="date" value={deadline} min={editing ? undefined : todayStr} max={date || undefined} onChange={(e) => setDeadline(e.target.value)} style={dateStyle} />
      {hint("Auto-set 3 days before — tap to change. Can't be in the past.")}
      {label("Notes")}
      <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" style={{ ...inputStyle, width: "100%" }} />
      {err && <div style={{ color: C.birdie, fontSize: 12, marginTop: 10 }}>{err}</div>}
      <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
        <button onClick={onCancel} disabled={busy} style={{ ...btn(false), flex: 1, fontSize: 13 }}>Cancel</button>
        <button onClick={post} disabled={busy} style={{ ...btn(true), flex: 1, fontSize: 13 }}>{busy ? "Saving…" : editing ? "Save changes" : `Post #${seq}`}</button>
      </div>
    </div>
  );
}

// ---------------- CAPTAIN PICKER ----------------
function CaptainPicker({ candidates, current, busy, onClose, onPick }: {
  candidates: Member[]; current: string | null; busy: boolean; onClose: () => void; onPick: (id: string | null) => void;
}) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 70, background: C.green, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "8px 0 calc(16px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
        <div style={{ width: 40, height: 4, background: C.greenMid, borderRadius: 2, margin: "6px auto 10px" }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: C.cream, padding: "0 16px 10px" }}>Assign captain</div>
        {candidates.length === 0 ? (
          <div style={{ padding: "0 16px 12px", fontSize: 13, color: C.sage }}>No one is signed up as "In" yet.</div>
        ) : candidates.map((m) => (
          <div key={m.id} onClick={() => onPick(m.id)} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", cursor: "pointer", borderBottom: `1px solid ${C.greenMid}` }}>
            <Avatar src={m.avatar_url || undefined} name={m.display_name} size={34} />
            <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.cream }}>{m.display_name}</div>
            {current === m.id ? <span style={{ color: C.gold, fontSize: 18, fontWeight: 800 }}>●</span> : null}
          </div>
        ))}
        <div style={{ display: "flex", gap: 10, padding: 16 }}>
          {current && <button onClick={() => onPick(null)} disabled={busy} style={{ ...btn(false), flex: 1, fontSize: 13, color: C.birdie, borderColor: C.birdie }}>Clear</button>}
          <button onClick={onClose} disabled={busy} style={{ ...btn(false), flex: 1, fontSize: 13 }}>Close</button>
        </div>
      </div>
    </>
  );
}

// ---------------- CAPTAIN DUTIES ----------------
const DEFAULT_DUTIES: [string, string][] = [
  ["Set up groups & handicaps", "Configure the playing groups and confirm each player's course handicap before the round."],
  ["Confirm the tee sheet", "Check that the names and times on the course's tee sheet match the signups."],
  ["Cart / walking prefs", "Confirm each player's riding, walking, or push-cart preference."],
  ["Rally the group", "A few days out, nudge anyone who hasn't confirmed their spot."],
];
function DutiesModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 60 }} />
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 70, background: C.card, borderTopLeftRadius: 18, borderTopRightRadius: 18, padding: "8px 0 calc(16px + env(safe-area-inset-bottom))", maxWidth: 520, margin: "0 auto" }}>
        <div style={{ width: 40, height: 4, background: C.line, borderRadius: 2, margin: "6px auto 12px" }} />
        <div style={{ fontSize: 16, fontWeight: 800, color: C.ink, padding: "0 16px 4px" }}>Captain duties</div>
        <div style={{ fontSize: 12, color: C.faint, padding: "0 16px 8px" }}>Responsibilities for the round captain.</div>
        {DEFAULT_DUTIES.map(([t, d], i) => (
          <div key={t} style={{ display: "flex", gap: 12, padding: "12px 16px", borderTop: `1px solid ${C.line}` }}>
            <div style={{ width: 26, height: 26, borderRadius: "50%", background: C.green, color: C.cream, fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>{i + 1}</div>
            <div><div style={{ fontSize: 14, fontWeight: 700, color: C.ink }}>{t}</div><div style={{ fontSize: 12, color: C.faint, marginTop: 2, lineHeight: 1.4 }}>{d}</div></div>
          </div>
        ))}
        <div style={{ padding: 16 }}><button onClick={onClose} style={{ ...btn(true), width: "100%", fontSize: 13 }}>Got it</button></div>
      </div>
    </>
  );
}

// ---------------- WHATSAPP EXPORT ----------------
function shortName(n: string) {
  const p = (n || "").trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}` : (p[0] || "");
}
function teeExport(tt: TeeTime, ins: Rsvp[], memberOf: (id: string) => Member | undefined, courseData: Record<string, { slope: number; rating: number; par: number }>, groupName: string): string {
  const cd = courseData[tt.course || ""];
  let cum = 0; const field: Rsvp[] = []; const wait: Rsvp[] = [];
  ins.forEach((r) => { cum += 1 + (r.guest_names?.length || 0); if (tt.max_spots != null && cum > tt.max_spots) wait.push(r); else field.push(r); });
  const used = field.reduce((sm, r) => sm + 1 + (r.guest_names?.length || 0), 0);
  const line = (r: Rsvp) => {
    const m = memberOf(r.user_id);
    const idx = m?.handicap_index;
    const ch = cd && idx != null ? courseHandicap(Number(idx), cd.slope, cd.rating, cd.par) : null;
    const hcp = idx != null ? `Idx ${idx}${ch != null ? ` · CH ${ch}` : ""}` : (ch != null ? `CH ${ch}` : "—");
    const g = r.guest_names?.length ? ` +${r.guest_names.length} guest: ${r.guest_names.join(", ")}` : "";
    return `${shortName(m?.display_name || "Member")} (${hcp})${g}`;
  };
  const cap = tt.captain_user_id ? memberOf(tt.captain_user_id)?.display_name : null;
  const L: string[] = [];
  L.push(`🏌️ ${groupName} · Tee Time #${tt.seq ?? "—"} — ${teeName(tt)} (${kindOf(tt.kind).label})`);
  L.push(`📅 ${fmtFull(tt.play_date)}${tt.tee_off_times?.length ? ` · ${tt.tee_off_times.join("/")}` : ""}`);
  if (tt.course) L.push(`📍 ${tt.course}`);
  if (cap) L.push(`🧢 Captain: ${shortName(cap)}`);
  if (tt.signup_deadline) L.push(`⏱ Sign up by ${fmtFull(tt.signup_deadline.slice(0, 10))}`);
  L.push("");
  L.push(`IN — ${used}${tt.max_spots != null ? ` of ${tt.max_spots}` : ""}`);
  field.forEach((r) => L.push(line(r)));
  if (wait.length) { L.push(""); L.push(`WAITLIST (${wait.length})`); wait.forEach((r) => L.push(line(r))); }
  const origin = (typeof window !== "undefined" && window.location?.origin) ? window.location.origin : "https://birdienumnum.vercel.app";
  L.push("");
  L.push(`👉 Open in the app to RSVP or view: ${origin}/?tt=${tt.id}`);
  return L.join("\n");
}

// Short "please RSVP" nudge for pasting into the group chat. Ends with a deep link
// that opens the app straight on this tee time's RSVP window (see home.tsx / page.tsx).
function teeReminderExport(tt: TeeTime, ins: Rsvp[], notResponded: number, groupName: string): string {
  const used = ins.reduce((sm, r) => sm + 1 + (r.guest_names?.length || 0), 0);
  const origin = (typeof window !== "undefined" && window.location?.origin) ? window.location.origin : "https://birdienumnum.vercel.app";
  const link = `${origin}/?tt=${tt.id}`;
  const spots = tt.max_spots != null ? `${used}/${tt.max_spots} in` : `${used} in`;
  const L: string[] = [];
  L.push(`⏰ ${groupName} · Tee Time #${tt.seq ?? "—"} — please RSVP`);
  L.push(`🏌️ ${teeName(tt)} (${kindOf(tt.kind).label})`);
  L.push(`📅 ${fmtFull(tt.play_date)}${tt.tee_off_times?.length ? ` · ${tt.tee_off_times.join("/")}` : ""}`);
  if (tt.course) L.push(`📍 ${tt.course}`);
  L.push(`✅ ${spots}${notResponded > 0 ? ` · ${notResponded} still to respond` : ""}`);
  if (tt.signup_deadline) L.push(`⏱ Sign up by ${fmtFull(tt.signup_deadline.slice(0, 10))}`);
  L.push("");
  L.push(`👉 Tap to RSVP: ${link}`);
  return L.join("\n");
}

// Sign-up link for brand-NEW players (admin only). Carries a multi-use group invite code
// plus this tee time, so tapping it signs them in, joins the group, and drops them on the
// tee time to RSVP. Existing members who tap it just land on the tee time (join is a no-op).
function teeSignupExport(tt: TeeTime, link: string, groupName: string): string {
  const L: string[] = [];
  L.push(`🏌️ ${groupName} · Tee Time #${tt.seq ?? "—"} — ${teeName(tt)} (${kindOf(tt.kind).label})`);
  L.push(`📅 ${fmtFull(tt.play_date)}${tt.tee_off_times?.length ? ` · ${tt.tee_off_times.join("/")}` : ""}`);
  if (tt.course) L.push(`📍 ${tt.course}`);
  if (tt.signup_deadline) L.push(`⏱ Sign up by ${fmtFull(tt.signup_deadline.slice(0, 10))}`);
  L.push("");
  L.push(`👉 New here? Tap to join ${groupName} and RSVP: ${link}`);
  L.push(`(Already in the club? Same link takes you straight to RSVP.)`);
  return L.join("\n");
}
