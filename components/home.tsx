"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole, allocateStrokes } from "@/lib/golf";
import { logActivity } from "@/lib/activity";
import { btn, Wordmark } from "@/components/ui";
import Tournaments from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell, PlayersTab, ActivityTab, HelpPage } from "@/components/manage";
import { RoundSetup } from "@/components/round-setup";
import { RoundEditor } from "@/components/round-editor";
import { RoundDetail } from "@/components/round-detail";
import { Dashboard } from "@/components/dashboard";
import { RoundsList } from "@/components/rounds-list";
import { GroupSelector, GroupsPanel } from "@/components/groups";

import type { AppGroup } from "@/lib/groups";

const supabase = createClient();

type Tab = "dashboard" | "rounds" | "games" | "courses" | "players" | "groups" | "activity" | "help" | "profile";

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
      .select("group_id, role, status, groups(id, name, status)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    let list: AppGroup[] = (data || [])
      // Hide groups still awaiting admin approval (legacy groups have no status → treated as active).
      .filter((m: any) => (m.groups?.status ?? "active") === "active")
      .map((m: any) => ({
        id: m.groups?.id || m.group_id,
        name: m.groups?.name || "Group",
        role: m.role,
        status: m.status,
      })).filter((g: AppGroup) => !!g.id);

    if (!list.length) {
      // Safety net: every user gets one personal "Main" group (active, no approval needed).
      const { data: g } = await supabase.from("groups").insert({ name: "Main", created_by: user.id, status: "active" }).select("id, name").single();
      if (g) {
        await supabase.from("group_members").insert({ group_id: g.id, user_id: user.id, email: (user.email || "").toLowerCase(), role: "admin", status: "active" });
        list = [{ id: g.id, name: g.name, role: "admin", status: "active" }];
      }
    }

    setGroups(list);
    const preferred = profile?.active_group_id || null;
    const next = (preferred && list.some((g) => g.id === preferred)) ? preferred : list[0]?.id || null;
    setActiveGroupId(next);
    if (next && next !== profile?.active_group_id) {
      supabase.from("profiles").update({ active_group_id: next }).eq("id", user.id).then(() => {});
      setProfile((p: any) => p ? ({ ...p, active_group_id: next }) : p);
    }
    setGroupsLoading(false);
  }, [activateEmailInvites, user.id, user.email, profile?.active_group_id]);

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
  useEffect(() => { if (profile) loadGroups(); }, [loadGroups, profile]);

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
    const r = rounds.find((x) => x.id === id);
    await supabase.from("rounds").delete().eq("id", id);
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "round_deleted", summary: `Deleted a round${r ? ` at ${r.course}` : ""}` });
    await loadRounds();
  };

  const chooseGroup = async (id: string) => {
    setActiveGroupId(id);
    setProfile((p: any) => p ? ({ ...p, active_group_id: id }) : p);
    await supabase.from("profiles").update({ active_group_id: id }).eq("id", user.id);
  };

  const inFlow = stage || viewing;
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const isAdminOfAnyGroup = groups.some((g) => g.role === "admin");
  const showGroupsTab = isAdminOfAnyGroup || groups.length > 1;

  if (groupsLoading) {
    return <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px", color: C.sage }}>Loading groups…</div>;
  }

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Wordmark width={150} />
        <div style={{ color: C.sage, fontSize: 13 }}>{displayName}{index != null ? ` · HCP ${index}` : ""}</div>
        <GroupSelector groups={groups} activeGroupId={activeGroupId} onChange={chooseGroup} />
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
        {(() => {
          const labels: Record<string, string> = {
            dashboard: "My Dashboard", rounds: "My Rounds", games: "Games",
            courses: "Courses", players: "Players", groups: "Groups",
            activity: "Activity ★", help: "Help",
          };
          const keys: string[] = ["dashboard", "rounds", "games", "courses", "players"];
          if (showGroupsTab) keys.push("groups");
          if (profile?.is_admin) keys.push("activity");
          keys.push("help");
          return keys.map((k) => (
            <button key={k} onClick={() => { setTab(k as Tab); setStage(null); setViewing(null); }}
              style={{
                background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
                color: tab === k && !inFlow ? C.gold : C.sage,
                borderBottom: tab === k && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
              }}>{labels[k]}</button>
          ));
        })()}
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
          <PlayersTab user={user} activeGroupId={activeGroup.id} isGroupAdmin={activeGroup.role === "admin"} onChanged={loadGroups} />
        ) : tab === "groups" ? (
          <GroupsPanel user={user} groups={groups} activeGroupId={activeGroupId} onGroupsChanged={loadGroups} onActiveGroupChange={chooseGroup} />
        ) : tab === "activity" && profile?.is_admin ? (
          <ActivityTab />
        ) : tab === "help" ? (
          <HelpPage isAdmin={!!profile?.is_admin} />
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
