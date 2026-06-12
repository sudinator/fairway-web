"use client";

import React, { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn, inputStyle, Eyebrow } from "@/components/ui";
import type { AppGroup } from "@/lib/groups";

const supabase = createClient();

type Member = {
  id: string;
  group_id: string;
  user_id: string | null;
  email: string;
  role: "admin" | "member";
  status: "active" | "invited" | "removed";
  profiles?: { display_name?: string | null; handicap_index?: number | null; phone?: string | null; ghin_number?: string | null } | null;
};

export function GroupSelector({ groups, activeGroupId, onChange }: { groups: AppGroup[]; activeGroupId: string | null; onChange: (id: string) => void }) {
  if (!groups.length) return null;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, background: C.greenLight, borderRadius: 10, padding: "7px 10px" }}>
      <span style={{ color: C.sage, fontSize: 11, letterSpacing: 1.5, fontWeight: 800 }}>GROUP</span>
      <select value={activeGroupId || groups[0].id} onChange={(e) => onChange(e.target.value)}
        style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 8, color: C.ink, fontWeight: 700, padding: "6px 8px", maxWidth: 180 }}>
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role === "admin" ? " ★" : ""}</option>)}
      </select>
    </div>
  );
}

export function GroupsPanel({ user, groups, activeGroupId, onGroupsChanged, onActiveGroupChange }: {
  user: any;
  groups: AppGroup[];
  activeGroupId: string | null;
  onGroupsChanged: () => Promise<void> | void;
  onActiveGroupChange: (id: string) => void;
}) {
  const active = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const isAdmin = active?.role === "admin";
  const [members, setMembers] = useState<Member[] | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
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
      const { data: profs } = await supabase.from("profiles").select("id, display_name, handicap_index, phone, ghin_number").in("id", ids);
      profilesById = Object.fromEntries((profs || []).map((p: any) => [p.id, p]));
    }
    setMembers(rows.map((m) => ({ ...m, profiles: m.user_id ? profilesById[m.user_id] || null : null })) as any);
  }, [active?.id]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const createGroup = async () => {
    const name = newGroup.trim();
    if (!name) return;
    setBusy(true); setMsg(null);
    try {
      const { data: group, error } = await supabase.from("groups").insert({ name, created_by: user.id }).select("id, name").single();
      if (error || !group) throw error || new Error("Could not create group");
      const { error: mErr } = await supabase.from("group_members").insert({
        group_id: group.id,
        user_id: user.id,
        email: (user.email || "").toLowerCase(),
        role: "admin",
        status: "active",
      });
      if (mErr) throw mErr;
      setNewGroup("");
      await onGroupsChanged();
      onActiveGroupChange(group.id);
      setMsg(`Created ${name}.`);
    } catch (e: any) {
      setMsg("Couldn't create group: " + (e.message || "error"));
    } finally { setBusy(false); }
  };

  const invite = async () => {
    if (!active || !isAdmin) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) { setMsg("Enter a valid email address."); return; }
    setBusy(true); setMsg(null);
    try {
      const { data: prof } = await supabase.from("profiles").select("id").ilike("email", email).maybeSingle();
      const { error } = await supabase.from("group_members").upsert({
        group_id: active.id,
        user_id: prof?.id || null,
        email,
        role: "member",
        status: prof?.id ? "active" : "invited",
      }, { onConflict: "group_id,email" });
      if (error) throw error;
      setInviteEmail("");
      await loadMembers();
      setMsg(prof?.id ? `Added ${email}.` : `Invited ${email}. They will join this group when they sign in with that email.`);
    } catch (e: any) {
      setMsg("Couldn't invite member: " + (e.message || "error"));
    } finally { setBusy(false); }
  };

  const updateMember = async (m: Member, patch: Partial<Member>) => {
    if (!active || !isAdmin) return;
    setBusy(true); setMsg(null);
    try {
      const { error } = await supabase.from("group_members").update(patch).eq("id", m.id);
      if (error) throw error;
      await loadMembers();
      await onGroupsChanged();
    } catch (e: any) { setMsg("Couldn't update member: " + (e.message || "error")); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <Eyebrow>GROUPS</Eyebrow>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 8 }}>
        Groups keep games, players, and shared courses limited to the people in that group. Your personal dashboard still includes your own rounds across every group.
      </div>

      <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 14 }}>
        <Eyebrow>CREATE NEW GROUP</Eyebrow>
        <div style={{ display: "flex", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
          <input style={{ ...inputStyle, maxWidth: 320 }} placeholder="e.g. Saturday Nassau" value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button style={{ ...btn(true), opacity: newGroup.trim() && !busy ? 1 : 0.5 }} disabled={!newGroup.trim() || busy} onClick={createGroup}>Create group</button>
        </div>
      </div>

      {active && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <Eyebrow>ACTIVE GROUP</Eyebrow>
            <select value={active.id} onChange={(e) => onActiveGroupChange(e.target.value)}
              style={{ ...inputStyle, maxWidth: 260, padding: "7px 10px", fontSize: 14 }}>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}{g.role === "admin" ? " ★ admin" : ""}</option>)}
            </select>
          </div>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 24, fontWeight: 800, marginTop: 10 }}>{active.name}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>Your role: {active.role}</div>

          {isAdmin && (
            <div style={{ marginTop: 16 }}>
              <Eyebrow>INVITE MEMBER</Eyebrow>
              <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <input style={{ ...inputStyle, maxWidth: 340 }} placeholder="friend@example.com" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
                <button style={{ ...btn(true), opacity: inviteEmail.trim() && !busy ? 1 : 0.5 }} disabled={!inviteEmail.trim() || busy} onClick={invite}>Invite / add</button>
              </div>
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
