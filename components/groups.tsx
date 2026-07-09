"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, inputStyle, Eyebrow, Avatar } from "@/components/ui";
import type { AppGroup } from "@/lib/groups";
import { logActivity } from "@/lib/activity";

const supabase = createClient();

type Member = {
  id: string;
  group_id: string;
  user_id: string | null;
  email: string;
  role: "admin" | "member";
  status: "active" | "invited" | "removed";
  profiles?: { display_name?: string | null; handicap_index?: number | null; phone?: string | null; ghin_number?: string | null; avatar_url?: string | null } | null;
};

export function GroupSelector({ groups, activeGroupId, onChange }: { groups: AppGroup[]; activeGroupId: string | null; onChange: (id: string) => void }) {
  if (!groups.length) return null;
  const active = groups.find((g) => g.id === activeGroupId) || groups[0];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.greenLight, borderRadius: 10, padding: "7px 10px" }}>
      <span style={{ color: C.sage, fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }}>CLUB</span>
      {groups.length === 1 ? (
        <span style={{ color: C.cream, fontSize: 13, fontWeight: 800 }}>{active.name}{active.role === "admin" ? " ★" : ""}</span>
      ) : (
        <select value={activeGroupId || groups[0].id} onChange={(e) => onChange(e.target.value)}
          style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, color: C.ink, fontWeight: 700, padding: "6px 8px", maxWidth: 180 }}>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role === "admin" ? " ★" : ""}</option>)}
        </select>
      )}
    </div>
  );
}

export function GroupsPanel({ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange, onGroupDeleted }: {
  user: any;
  groups: AppGroup[];
  activeGroupId: string | null;
  onGroupsChanged: () => Promise<void> | void;
  onActiveGroupChange: (id: string) => void;
  onGroupDeleted?: () => Promise<void> | void;
}) {
  const active = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const isAdmin = active?.role === "admin";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [newNote, setNewNote] = useState("");
  const [renameText, setRenameText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [linkKind, setLinkKind] = useState<"24h" | "7d" | "once">("24h");
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const loadMembers = useCallback(async () => {
    if (!active) { setMembers([]); return; }
    const { data } = await supabase
      .from("group_members")
      .select("id, group_id, user_id, email, role, status")
      .eq("group_id", active.id)
      .neq("status", "removed")
      .order("role")
      .order("email");
    const rows = (data || []) as Member[];
    const ids = rows.map((m) => m.user_id).filter(Boolean) as string[];
    let profilesById: Record<string, any> = {};
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("id, display_name, handicap_index, phone, ghin_number, avatar_url").in("id", ids);
      profilesById = Object.fromEntries((profs || []).map((p: any) => [p.id, p]));
    }
    setMembers(rows.map((m) => ({ ...m, profiles: m.user_id ? profilesById[m.user_id] || null : null })) as any);
  }, [active?.id]);

  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => {
    if (active) {
      setRenameText(active.name);
      setRenaming(false);
      setInviteLink(null);
      setCopyMsg(null);
    }
  }, [active?.id, active?.name]);

  const createGroup = async () => {
    const name = newGroup.trim();
    if (!name) return;
    setBusy(true); setMsg(null);
    try {
      // Members can't create groups directly — they submit a request the app admin approves.
      const { data: group, error } = await supabase.from("groups")
        .insert({ name, created_by: user.id, status: "pending", request_note: newNote.trim() || null })
        .select("id, name").single();
      if (error || !group) throw error || new Error("Could not submit request");
      // Pre-add the requester as the group's admin (kept hidden until the group is approved).
      const { error: mErr } = await supabase.from("group_members").insert({
        group_id: group.id, user_id: user.id, email: (user.email || "").toLowerCase(), role: "admin", status: "active",
      });
      if (mErr) throw mErr;
      // Notify every app admin that a request is waiting.
      const { data: admins } = await supabase.from("profiles").select("id").eq("is_admin", true);
      for (const a of admins || []) {
        try { await supabase.rpc("create_notification", { p_recipient: a.id, p_message: `New club request: "${name}" from ${user.email}. Approve or decline it in the admin panel.` }); } catch {}
      }
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "A member", action: "group_requested", summary: `Requested a new club "${name}"` });
      setNewGroup(""); setNewNote("");
      setMsg(`Request submitted for "${name}". An admin will review it — you'll be notified when it's approved.`);
    } catch (e: any) {
      setMsg("Couldn't submit request: " + (e.message || "error"));
    } finally { setBusy(false); }
  };

  const renameGroup = async () => {
    if (!active || !isAdmin) return;
    const name = renameText.trim();
    if (!name) { setMsg("Club name cannot be blank."); return; }
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.from("groups").update({ name }).eq("id", active.id);
      if (error) throw error;
      setRenaming(false);
      await onGroupsChanged();
      setMsg("Club renamed.");
    } catch (e: any) {
      setMsg("Couldn't rename club: " + (e.message || "error"));
    } finally { setBusy(false); }
  };

  const deleteGroup = async () => {
    if (!active || !isAdmin) return;
    // Only allow deleting an "empty" group — one where the admin is the only
    // active member left. Guard on the loaded member list.
    const activeOthers = (members || []).filter((m) => m.status === "active" && m.user_id !== user.id);
    if (activeOthers.length > 0) {
      setMsg(`Can't delete: ${activeOthers.length} other active member${activeOthers.length === 1 ? "" : "s"} still in this club. Remove them first.`);
      return;
    }
    if (!confirm(`Delete the club "${active.name}"? This permanently removes the club and its membership. Rounds you logged are kept on your account. This cannot be undone.`)) return;
    setBusy(true); setMsg(null);
    try {
      // Clear the group from anyone whose active group points at it.
      await supabase.from("profiles").update({ active_group_id: null }).eq("active_group_id", active.id);
      // Tables whose group_id FK is "no action" (rounds, games, favorites,
      // notifications) would block the group delete while pointing at it. Null
      // their group_id first so the rows are preserved but no longer reference the
      // group. (group_members / group_invites / group_courses cascade automatically.)
      await supabase.from("rounds").update({ group_id: null }).eq("group_id", active.id);
      await supabase.from("favorite_courses").update({ group_id: null }).eq("group_id", active.id);
      await supabase.from("games").update({ group_id: null }).eq("group_id", active.id);
      await supabase.from("notifications").update({ group_id: null }).eq("group_id", active.id);
      // IMPORTANT ORDER: delete the GROUP row FIRST, while we are still its admin.
      // is_group_admin() checks the group_members table, so if we deleted our own
      // membership first, the group-delete permission check would then fail and
      // silently remove nothing. Delete the group, verify it went, then clean up
      // the now-orphaned dependent rows.
      const { data: deleted, error } = await supabase
        .from("groups").delete().eq("id", active.id).select("id");
      if (error) throw error;
      if (!deleted || deleted.length === 0) {
        setMsg("Couldn't delete this club — your account may not have permission (nothing was changed).");
        setBusy(false);
        return;
      }
      // Group is gone; remove its dependent rows.
      await supabase.from("group_members").delete().eq("group_id", active.id);
      await supabase.from("group_invites").delete().eq("group_id", active.id);
      await supabase.from("group_courses").delete().eq("group_id", active.id);
      await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "group_deleted", summary: `Deleted group "${active.name}"` });
      setMsg("Club deleted.");
      if (onGroupDeleted) await onGroupDeleted();
      else await onGroupsChanged();
    } catch (e: any) {
      setMsg("Couldn't delete club: " + (e.message || "error"));
    } finally { setBusy(false); }
  };

  const generateInvite = async () => {
    if (!active || !isAdmin) return;
    setBusy(true); setMsg(null); setInviteLink(null); setCopyMsg(null);
    try {
      let code = "";
      if (linkKind === "once") {
        const { data, error } = await supabase.rpc("create_group_invite", {
          group_uuid: active.id,
          invite_role: "member",
          valid_days: 30,
        });
        if (error) throw error;
        code = String(data || "");
      } else {
        const { data, error } = await supabase.rpc("create_group_invite_multi", {
          invite_group: active.id,
          invite_role: "member",
          hours: linkKind === "7d" ? 168 : 24,
          uses: null,
        });
        if (error) throw error;
        code = String(data || "");
      }
      if (!/^\d{6}$/.test(code)) throw new Error("Invite code was not generated correctly.");
      const origin = typeof window !== "undefined" ? window.location.origin : "https://birdienumnum.vercel.app";
      const link = `${origin}/join/${code}`;
      setInviteLink(link);
      setMsg(linkKind === "once"
        ? "One-time invite link generated. Send it to a single player."
        : `Invite link generated — anyone can use it for the next ${linkKind === "7d" ? "7 days" : "24 hours"}.`);
    } catch (e: any) {
      setMsg("Couldn't generate invite link: " + (e.message || "error"));
    } finally { setBusy(false); }
  };

  const copyInviteLink = async () => {
    if (!inviteLink) return;
    try {
      await navigator.clipboard?.writeText(inviteLink);
      setCopyMsg("Copied ✓");
      setTimeout(() => setCopyMsg(null), 1800);
    } catch {
      setCopyMsg("Copy failed — select the link and copy it manually.");
    }
  };

  const updateMember = async (m: Member, patch: Partial<Member>) => {
    if (!active || !isAdmin) return;
    // Guard: never let a group lose its last admin. Block demoting the only admin
    // to member, or removing the only admin from the group.
    const admins = (members || []).filter((x) => x.role === "admin" && x.status === "active");
    const demotingThisAdmin = patch.role === "member" && m.role === "admin";
    const removingThisAdmin = patch.status === "removed" && m.role === "admin";
    if ((demotingThisAdmin || removingThisAdmin) && admins.length <= 1) {
      setMsg("This is the club's only admin. Make someone else an admin first, so the club always has at least one.");
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.from("group_members").update(patch).eq("id", m.id);
      if (error) throw error;
      const who = m.profiles?.display_name || m.email;
      if (patch.status === "removed") {
        await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "member_removed", group_id: active.id, target_user_id: m.user_id, summary: `Removed ${who} from ${active.name}` });
      } else if (patch.role) {
        await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Group admin", action: "role_changed", group_id: active.id, target_user_id: m.user_id, summary: `Made ${who} a ${patch.role} in ${active.name}` });
      }
      await loadMembers();
      await onGroupsChanged();
    } catch (e: any) { setMsg("Couldn't update member: " + (e.message || "error")); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <Eyebrow>CLUBS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Clubs keep games, players, and shared courses limited to the people in that club. Your personal dashboard still includes your own rounds across every club.
      </div>

      <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
        <Eyebrow>REQUEST A NEW CLUB</Eyebrow>
        <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
          New clubs are approved by an app admin. Fill in the name and a short note on what it's for — you'll be notified when it's approved.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
          <input style={{ ...inputStyle, maxWidth: 360 }} placeholder="Club name (e.g. Saturday Nassau)" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <input style={{ ...inputStyle, maxWidth: 360 }} placeholder="What's it for? (optional)" value={newNote} onChange={(e) => setNewNote(e.target.value)} />
          <button style={{ ...btn(true), maxWidth: 200, opacity: newGroup.trim() && !busy ? 1 : 0.5 }} disabled={!newGroup.trim() || busy} onClick={createGroup}>Submit request</button>
        </div>
      </div>

      {active && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Eyebrow>ACTIVE CLUB</Eyebrow>
            <select value={active.id} onChange={(e) => onActiveGroupChange(e.target.value)}
              style={{ ...inputStyle, maxWidth: 260, padding: "7px 10px", fontSize: 14 }}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role === "admin" ? " ★ admin" : ""}</option>)}
            </select>
          </div>
          <div style={{ marginTop: 10 }}>
            {isAdmin && renaming ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <input style={{ ...inputStyle, maxWidth: 320 }} value={renameText} onChange={(e) => setRenameText(e.target.value)} />
                <button style={{ ...btn(true), opacity: renameText.trim() && !busy ? 1 : 0.5 }} disabled={!renameText.trim() || busy} onClick={renameGroup}>Save name</button>
                <button style={btn(false)} disabled={busy} onClick={() => { setRenaming(false); setRenameText(active.name); }}>Cancel</button>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 800 }}>{active.name}</div>
                {isAdmin && <button style={{ ...btn(false), fontSize: 12, padding: "7px 10px" }} onClick={() => setRenaming(true)}>Rename</button>}
                {isAdmin && (members || []).filter((m) => m.status === "active" && m.user_id !== user.id).length === 0 && (
                  <button style={{ ...btn(false), fontSize: 12, padding: "7px 10px", background: "#7A2F28" }} disabled={busy} onClick={deleteGroup}>Delete club</button>
                )}
              </div>
            )}
          </div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>Your role: {active.role}</div>

          {isAdmin && (
            <div style={{ marginTop: 16 }}>
              <Eyebrow>INVITE MEMBERS</Eyebrow>
              <div style={{ color: C.sage, fontSize: 12, marginTop: 6 }}>
                Generate a link to share. Anyone who opens it is added to this club after Google sign-in. Pick how long it stays valid.
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {([["24h", "Lasts 24 hours"], ["7d", "7 days"], ["once", "One-time (single player)"]] as const).map(([k, lbl]) => (
                  <button key={k} onClick={() => { setLinkKind(k); setInviteLink(null); }}
                    style={{ ...btn(linkKind === k), fontSize: 12, padding: "7px 12px" }}>{lbl}</button>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button style={{ ...btn(true), opacity: !busy ? 1 : 0.5 }} disabled={busy} onClick={generateInvite}>Generate invite link</button>
                {inviteLink && <button style={btn(false)} onClick={copyInviteLink}>Copy link</button>}
                {copyMsg && <span style={{ color: C.gold, fontSize: 12 }}>{copyMsg}</span>}
              </div>
              {inviteLink && (
                <div style={{ background: C.card, borderRadius: 10, padding: 12, marginTop: 10 }}>
                  <div style={{ color: C.faint, fontSize: 11, letterSpacing: 1, fontWeight: 800 }}>SHARE THIS LINK</div>
                  <div style={{ color: C.green, fontSize: 13, marginTop: 6, wordBreak: "break-all", fontWeight: 800 }}>{inviteLink}</div>
                  <div style={{ color: C.faint, fontSize: 11, marginTop: 6 }}>Expires in 30 days and can only be used once.</div>
                </div>
              )}
            </div>
          )}

          {msg && <div style={{ color: C.gold, fontSize: 12, marginTop: 10 }}>{msg}</div>}

          <div style={{ marginTop: 16 }}>
            <Eyebrow>MEMBERS</Eyebrow>
            {members === null && <div style={{ color: C.sage, marginTop: 10 }}>Loading members…</div>}
            {members?.map((m) => {
              const name = m.profiles?.display_name || m.email;
              const self = m.user_id === user.id;
              return (
                <div key={m.id} style={{ background: C.card, borderRadius: 12, padding: "12px 14px", marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <Avatar src={m.profiles?.avatar_url} name={name} size={40} />
                  <div style={{ flex: 1, minWidth: 190 }}>
                    <div style={{ color: C.ink, fontWeight: 800 }}>{name}{self ? " (you)" : ""}</div>
                    <div style={{ color: C.faint, fontSize: 12 }}>{m.email} · {m.status}{m.role === "admin" ? " · admin" : ""}</div>
                  </div>
                  {isAdmin && !self && m.status !== "removed" && (
                    <>
                      <button style={{ ...btn(false), fontSize: 12, padding: "7px 10px" }} disabled={busy} onClick={() => updateMember(m, { role: m.role === "admin" ? "member" : "admin" })}>{m.role === "admin" ? "Make member" : "Make admin"}</button>
                      <button style={{ ...btn(false), fontSize: 12, padding: "7px 10px", color: C.birdie }} disabled={busy} onClick={() => { if (confirm(`Remove ${m.email} from ${active.name}?`)) updateMember(m, { status: "removed" }); }}>Remove</button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
