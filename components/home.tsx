"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole, allocateStrokes } from "@/lib/golf";
import { btn, Wordmark } from "@/components/ui";
import Tournaments from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell, PlayersTab } from "@/components/manage";
import { RoundSetup } from "@/components/round-setup";
import { RoundEditor } from "@/components/round-editor";
import { RoundDetail } from "@/components/round-detail";
import { Dashboard } from "@/components/dashboard";
import { RoundsList } from "@/components/rounds-list";

import type { AppGroup } from "@/lib/groups";

const supabase = createClient();

type Tab = "dashboard" | "rounds" | "games" | "courses" | "players" | "groups" | "profile";

export function Home({ session }: { session: any }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stage, setStage] = useState<null | "setup" | { round: Round }>(null);
  const [viewing, setViewing] = useState<Round | null>(null);

  const user = session.user;
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
  const index = profile?.handicap_index ?? null;

  const activateEmailInvites = useCallback(async () => {
    const email = (user.email || "").toLowerCase();
    if (!email) return;
    await supabase.from("group_members").update({ user_id: user.id, status: "active" }).eq("email", email).eq("status", "invited");
  }, [user.id, user.email]);

  const loadGroups = useCallback(async () => {
    setGroupsLoading(true);
    await activateEmailInvites();
    const { data } = await supabase
      .from("group_members")
      .select("group_id, role, status, groups(id, name)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    let list: AppGroup[] = (data || []).map((m: any) => ({
      id: m.groups?.id || m.group_id,
      name: m.groups?.name || "Group",
      role: m.role,
      status: m.status,
    })).filter((g: AppGroup) => !!g.id);

    if (!list.length) {
      // Safety net for brand-new databases: create a Main group for the first signed-in user.
      const { data: g } = await supabase.from("groups").insert({ name: "Main", created_by: user.id }).select("id, name").single();
      if (g) {
        await supabase.from("group_members").insert({ group_id: g.id, user_id: user.id, email: (user.email || "").toLowerCase(), role: "admin", status: "active" });
        list = [{ id: g.id, name: g.name, role: "admin", status: "active" }];
      }
    }

    setGroups(list);
    const saved = typeof window !== "undefined" ? window.localStorage.getItem("birdienumnum.activeGroupId") : null;
    const next = (saved && list.some((g) => g.id === saved)) ? saved : list[0]?.id || null;
    setActiveGroupId(next);
    if (next && typeof window !== "undefined") window.localStorage.setItem("birdienumnum.activeGroupId", next);
    setGroupsLoading(false);
  }, [activateEmailInvites, user.id, user.email]);

  // Load (or create) this user's profile: display name, handicap index, GHIN number.
  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (data) {
      setProfile(data);
      supabase.from("profiles").update({ last_active: new Date().toISOString(), email: user.email }).eq("id", user.id).then(() => {});
      return;
    }
    const fallbackName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
    const { data: created } = await supabase.from("profiles")
      .insert({ id: user.id, display_name: fallbackName, email: user.email, last_active: new Date().toISOString() }).select().maybeSingle();
    setProfile(created || { id: user.id, display_name: fallbackName, handicap_index: null, ghin_number: null, is_admin: false });
  }, [user.id, user.email, user.user_metadata]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { loadGroups(); }, [loadGroups]);

  const saveIndex = async (idx: number | null) => {
    setProfile((p: any) => ({ ...p, handicap_index: idx }));
    await supabase.from("profiles").update({ handicap_index: idx }).eq("id", user.id);
  };

  const loadRounds = useCallback(async () => {
    setLoading(true);
    // Personal views intentionally show this user's rounds across every group.
    const { data: rs } = await supabase
      .from("rounds").select("*, groups(name)").eq("user_id", user.id).order("played_at", { ascending: false });
    if (!rs) { setRounds([]); setLoading(false); return; }
    const ids = rs.map((r: any) => r.id);
    const { data: hs } = await supabase
      .from("holes").select("*").in("round_id", ids.length ? ids : ["none"]);
    const byRound: Record<string, Hole[]> = {};
    (hs || []).forEach((h: any) => { (byRound[h.round_id] ||= []).push(h); });
    const merged: Round[] = rs.map((r: any) => {
      const sorted = (byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number);
      const alloc = allocateStrokes(sorted, r.course_handicap);
      const holes = sorted.map((h) => ({ ...h, recv: alloc[h.hole_number] || 0 }));
      return { ...r, group_name: r.groups?.name || null, holes };
    });
    setRounds(merged);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { loadRounds(); }, [loadRounds]);

  const deleteRound = async (id: string) => {
    await supabase.from("rounds").delete().eq("id", id);
    await loadRounds();
  };

  const chooseGroup = (id: string) => {
    setActiveGroupId(id);
    if (typeof window !== "undefined") window.localStorage.setItem("birdienumnum.activeGroupId", id);
  };

  const inFlow = stage || viewing;
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0] || null;

  if (groupsLoading) {
    return <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px", color: C.sage }}>Loading groups…</div>;
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Wordmark width={150} />
        <div style={{ color: C.sage, fontSize: 13 }}>{displayName}{index != null ? ` · HCP ${index}` : ""}</div>
        
        <div style={{ flex: 1 }} />
        <NotificationBell user={user} />
        <button style={{ ...btn(false), fontSize: 12 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button style={{ ...btn(true), opacity: activeGroup ? 1 : 0.5 }} disabled={!activeGroup} onClick={() => { setStage("setup"); setViewing(null); }}>＋ New round</button>
      </div>

      {!activeGroup && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 18, color: C.sage }}>
          You are not in a group yet. Create one from the Groups tab.
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: `1px solid ${C.greenMid}`, flexWrap: "wrap" }}>
        {(["dashboard", "rounds", "games", "courses", "players", "groups"] as const).map((k) => (
          <button key={k} onClick={() => { setTab(k); setStage(null); setViewing(null); }}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
              color: tab === k && !inFlow ? C.gold : C.sage,
              borderBottom: tab === k && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
            }}>{k === "dashboard" ? "My Dashboard" : k === "rounds" ? "My Rounds" : k === "games" ? "Games" : k === "courses" ? "Courses" : k === "players" ? "Players" : "Groups"}</button>
        ))}
        <button onClick={() => { setTab("profile"); setStage(null); setViewing(null); }}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
            color: tab === "profile" && !inFlow ? C.gold : C.sage,
            borderBottom: tab === "profile" && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
          }}>Profile{profile?.is_admin ? " ★" : ""}</button>
      </div>

      <div style={{ marginTop: 20 }}>
        {stage === "setup" && activeGroup ? (
          <RoundSetup index={index} saveIndex={saveIndex} activeGroupId={activeGroup.id} activeGroupName={activeGroup.name} onCancel={() => setStage(null)}
            onReady={(round) => setStage({ round })} />
        ) : stage && typeof stage === "object" && "round" in stage ? (
          <RoundEditor round={stage.round} onCancel={() => setStage(null)}
            onSaved={async () => { await loadRounds(); setStage(null); setTab("rounds"); }} />
        ) : viewing ? (
          <RoundDetail round={viewing} onBack={() => setViewing(null)}
            onEdit={() => { setStage({ round: viewing }); setViewing(null); }}
            onDelete={async () => { await deleteRound(viewing.id); setViewing(null); }} />
        ) : tab === "courses" && activeGroup ? (
          <CoursesLibrary user={user} activeGroupId={activeGroup.id} />
        ) : tab === "players" && activeGroup ? (
          <PlayersTab activeGroupId={activeGroup.id} />
        ) : tab === "groups" ? (
          <div />
        ) : tab === "profile" ? (
          <ProfilePanel profile={profile} user={user} onSaved={loadProfile} />
        ) : tab === "games" && activeGroup ? (
          <Tournaments session={session} activeGroupId={activeGroup.id} />
        ) : loading ? (
          <div style={{ color: C.sage, textAlign: "center", padding: 40 }}>Loading your rounds…</div>
        ) : tab === "dashboard" ? (
          <Dashboard rounds={rounds} name={displayName} onOpen={setViewing} currentIndex={index} saveIndex={saveIndex} />
        ) : (
          <RoundsList rounds={rounds} onOpen={setViewing} />
        )}
      </div>
    </div>
  );
}
