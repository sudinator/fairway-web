"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole, allocateStrokes } from "@/lib/golf";
import { logActivity } from "@/lib/activity";
import { loadDraft, draftHasScores } from "@/lib/draft";
import { loadActiveGame, saveAppBootCache, loadAppBootCache } from "@/lib/draft";
import { btn, Wordmark, inputStyle } from "@/components/ui";
import Tournaments from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell, PlayersTab, ActivityTab, AdminGroupsTab, AdminUsersTab, HelpPage } from "@/components/manage";
import { AdminFeedbackTab } from "@/components/feedback";
import { MoneyTab } from "@/components/money";
import { RoundSetup } from "@/components/round-setup";
import { RoundEditor } from "@/components/round-editor";
import { RoundDetail } from "@/components/round-detail";
import { Dashboard } from "@/components/dashboard";
import { RoundsList } from "@/components/rounds-list";
import { GroupsPanel } from "@/components/groups";
import { InstallHint } from "@/components/install-hint";
import { PullToRefresh } from "@/components/pull-to-refresh";

import type { AppGroup } from "@/lib/groups";

const supabase = createClient();

type Tab = "dashboard" | "rounds" | "games" | "courses" | "players" | "groups" | "activity" | "oversight" | "users" | "feedback" | "help" | "profile" | "money";

export function Home({ session }: { session: any }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [dbInProgress, setDbInProgress] = useState<Round | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [stage, setStage] = useState<null | "setup" | { round: Round }>(null);
  // Tracks the in-progress round draft so we can show a "Resume" banner from any
  // screen. Re-read from storage whenever navigation happens (see refreshDraft).
  const [draftRound, setDraftRound] = useState<Round | null>(null);
  const refreshDraft = useCallback(() => {
    const d = loadDraft();
    setDraftRound(d && draftHasScores(d.round) ? d.round : null);
  }, []);
  // Keep the resume banner in sync: re-check storage on mount and whenever we
  // leave the editor (stage changes), so the banner appears/disappears correctly.
  useEffect(() => { refreshDraft(); }, [refreshDraft, stage, tab]);
  const [viewing, setViewing] = useState<Round | null>(null);
  const [resumeChecked, setResumeChecked] = useState(false);

  // On open, resume an in-progress round straight into the scorecard.
  // Priority: an active game → this device's round draft → the server's in-progress round.
  useEffect(() => {
    if (resumeChecked) return;
    // If the user was in a game room, reopen the Games tab so it can restore the room.
    if (loadActiveGame()) {
      setResumeChecked(true);
      setStage(null);
      setTab("games");
      return;
    }
    const d = loadDraft();
    if (d && draftHasScores(d.round)) {
      setResumeChecked(true);
      setStage({ round: d.round });
      return;
    }
    // No local draft — wait until rounds have loaded, then check the server.
    if (loading) return;
    setResumeChecked(true);
    if (dbInProgress && draftHasScores(dbInProgress)) {
      setStage({ round: dbInProgress });
    }
  }, [resumeChecked, loading, dbInProgress]);

  const user = session.user;
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
  const index = profile?.handicap_index ?? null;

  const activateEmailInvites = useCallback(async () => {
    const email = (user.email || "").toLowerCase();
    if (!email) return;
    await supabase.from("group_members").update({ user_id: user.id, status: "active" }).eq("email", email).eq("status", "invited");
  }, [user.id, user.email]);

  const loadGroups = useCallback(async (preferId?: string | null) => {
    // Offline: don't sit on "Loading groups…" waiting for a request that can't land.
    // Hydrate groups + active group from cache immediately.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const cache = loadAppBootCache();
      if (cache?.groups?.length) {
        setGroups(cache.groups as any);
        setActiveGroupId(cache.activeGroupId ?? cache.groups[0]?.id ?? null);
      } else { setGroups([]); setActiveGroupId(null); }
      setGroupsLoading(false);
      return;
    }
    setGroupsLoading(true);
    await activateEmailInvites();
    const { data } = await supabase
      .from("group_members")
      .select("group_id, role, status, is_support, groups(id, name, status)")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    let list: AppGroup[] = (data || [])
      // Drop memberships whose group row no longer exists (e.g. just deleted) —
      // the join returns a null group for those, and they must not show in the picker.
      .filter((m: any) => !!m.groups && !!m.groups.id)
      // Hide groups still awaiting admin approval (legacy groups have no status → treated as active).
      .filter((m: any) => (m.groups?.status ?? "active") === "active" || m.is_support === true)
      .map((m: any) => ({
        id: m.groups?.id || m.group_id,
        name: m.groups?.name || "Group",
        role: m.role,
        status: m.status,
        is_support: !!m.is_support,
      })).filter((g: AppGroup) => !!g.id);

    if (!list.length && !(data && data.length)) {
      // Stranded (or brand-new) — no membership rows at all. First try to land them
      // in the app's designated default group and bring any homeless rounds along.
      const { data: gid } = await supabase.rpc("join_default_group", { p_email: user.email || "" });
      if (gid) {
        const { data: gg } = await supabase.from("groups").select("id, name").eq("id", gid as string).single();
        if (gg) list = [{ id: gg.id, name: gg.name, role: "member", status: "active" }];
      }
      if (!list.length) {
        // No default configured — fall back to a personal "Main". Guarded by the raw
        // row count above so an archived-only or transiently-empty result never spawns
        // a duplicate "Main".
        const { data: g } = await supabase.from("groups").insert({ name: "Main", created_by: user.id, status: "active" }).select("id, name").single();
        if (g) {
          await supabase.from("group_members").insert({ group_id: g.id, user_id: user.id, email: (user.email || "").toLowerCase(), role: "admin", status: "active" });
          list = [{ id: g.id, name: g.name, role: "admin", status: "active" }];
        }
      }
    }

    setGroups(list);
    const preferred = preferId ?? profile?.active_group_id ?? null;
    const next = (preferred && list.some((g) => g.id === preferred)) ? preferred : list[0]?.id || null;
    setActiveGroupId(next);
    saveAppBootCache({ groups: list, activeGroupId: next });
    if (next && next !== profile?.active_group_id) {
      supabase.from("profiles").update({ active_group_id: next }).eq("id", user.id).then(() => {});
      setProfile((p: any) => p ? ({ ...p, active_group_id: next }) : p);
    }
    setGroupsLoading(false);
  }, [activateEmailInvites, user.id, user.email, profile?.active_group_id]);

  // Load (or create) this user's profile: display name, handicap index, GHIN number.
  const loadProfile = useCallback(async () => {
    // Offline: skip the network entirely so we don't hang on a request that can't
    // complete — use the cached profile (or a minimal local one) immediately.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      const cache = loadAppBootCache();
      setProfile(cache?.profile || { id: user.id, display_name: user.user_metadata?.full_name || null, handicap_index: null, ghin_number: null, is_admin: false });
      return;
    }
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (data) {
      setProfile(data);
      saveAppBootCache({ profile: data });
      supabase.from("profiles").update({ last_active: new Date().toISOString(), email: user.email }).eq("id", user.id).then(() => {});
      supabase.rpc("mark_active").then(() => {}); // record today's activity for analytics
      return;
    }
    // Only trust a real name from the Google account; never fabricate one from the
    // email local-part, so group-mates don't see "jsmith123" instead of a name.
    const googleName = (user.user_metadata?.full_name || user.user_metadata?.name || "").trim();
    const { data: created } = await supabase.from("profiles")
      .insert({ id: user.id, display_name: googleName || null, email: user.email, last_active: new Date().toISOString() }).select().maybeSingle();
    setProfile(created || { id: user.id, display_name: googleName || null, handicap_index: null, ghin_number: null, is_admin: false });
  }, [user.id, user.email, user.user_metadata]);

  useEffect(() => { loadProfile(); }, [loadProfile]);
  useEffect(() => { if (profile) loadGroups(); }, [loadGroups, profile]);

  // After a group is deleted, clear any pointer to it and reload. loadGroups will
  // fall back to (or create) the "Main" group when the user has none left.
  const onGroupDeleted = useCallback(async () => {
    setActiveGroupId(null);
    setProfile((p: any) => p ? ({ ...p, active_group_id: null }) : p);
    await supabase.from("profiles").update({ active_group_id: null }).eq("id", user.id);
    await loadGroups();
  }, [loadGroups, user.id]);

  const saveIndex = async (idx: number | null) => {
    setProfile((p: any) => ({ ...p, handicap_index: idx }));
    await supabase.from("profiles").update({ handicap_index: idx }).eq("id", user.id);
  };

  const loadRounds = useCallback(async () => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setRounds([]); setDbInProgress(null); setLoading(false); return;
    }
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
    // Keep in-progress rounds out of the normal list (no clutter); surface the most
    // recent one for resume (covers a cleared-storage or different-device case).
    const finished = merged.filter((r: any) => (r.status ?? "final") !== "in_progress");
    const inProg = merged.filter((r: any) => (r.status ?? "final") === "in_progress")
      .sort((a: any, b: any) => +new Date(b.played_at) - +new Date(a.played_at))[0] || null;
    setRounds(finished);
    setDbInProgress(inProg);
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

  // Master admin: temporarily enter a group as a logged support member and drop
  // straight into it. Membership-based access carries the session; exiting removes
  // only the support row (never a real membership).
  const enterSupportGroup = async (g: { group_id: string; name: string }) => {
    const { error } = await supabase.rpc("admin_enter_group", { p_group: g.group_id, p_email: user.email || "" });
    if (error) { alert("Couldn't enter the group — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "admin_entered_group", group_id: g.group_id, summary: `Master admin entered group "${g.name}" (support session)` });
    await loadGroups(g.group_id);
    setStage(null); setViewing(null); setMoreOpen(false); setTab("dashboard");
  };
  const exitSupportGroup = async (g: { group_id: string; name: string }) => {
    const { error } = await supabase.rpc("admin_exit_group", { p_group: g.group_id });
    if (error) { alert("Couldn't exit the group — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "admin_exited_group", group_id: g.group_id, summary: `Master admin exited group "${g.name}" (support session)` });
    await loadGroups();
  };

  const inFlow = stage || viewing;
  const [moreOpen, setMoreOpen] = useState(false);
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const isAdminOfAnyGroup = groups.some((g) => g.role === "admin");
  const showGroupsTab = isAdminOfAnyGroup || groups.length > 1;

  if (groupsLoading) {
    return <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px", color: C.sage }}>Loading groups…</div>;
  }

  if (profile?.banned) {
    return (
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "60px 20px", textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🚫</div>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 700 }}>Account suspended</div>
        <div style={{ color: C.sage, fontSize: 14, marginTop: 10, lineHeight: 1.5 }}>
          Your access to Birdie Num Num has been suspended. If you think this is a mistake, contact the app administrator.
        </div>
      </div>
    );
  }

  if (profile?.deactivated) {
    return (
      <div style={{ maxWidth: 480, margin: "80px auto", padding: 24, textAlign: "center" }}>
        <Wordmark width={220} />
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 20, marginTop: 24 }}>Your access is paused</div>
        <div style={{ color: C.sage, fontSize: 14, marginTop: 10, lineHeight: 1.6 }}>
          An administrator has deactivated your account. Your history is saved. If you think this is a mistake, please reach out to your group admin.
        </div>
        <button style={{ ...btn(false), marginTop: 20 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>
    );
  }

  // Require a real name before using the app, so group-mates see a name, not an email.
  if (profile && !((profile.display_name || "").trim())) {
    return <NameGate user={user} onSaved={loadProfile} />;
  }

  return (
    <>
      <InstallHint />
      <PullToRefresh onRefresh={async () => { await Promise.all([loadProfile(), loadGroups(), loadRounds()]); }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 96px" }}>
      {/* Line 1: logo + active group (display only — change it in the Groups tab) */}
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <Wordmark width={150} />
        {activeGroup && (
          <span style={{ background: C.greenLight, color: C.cream, fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 20 }}>
            {activeGroup.name}
          </span>
        )}
      </div>

      {/* Line 2: name + handicap, notifications, new round */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.cream, fontSize: 15, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</div>
          <div style={{ color: C.sage, fontSize: 12 }}>{index != null ? `Handicap ${index}` : "Set your handicap in Profile"}</div>
        </div>
        <NotificationBell user={user} />
        <button style={{ ...btn(true), opacity: activeGroup ? 1 : 0.5 }} disabled={!activeGroup} onClick={() => { setStage("setup"); setViewing(null); }}>＋ New round</button>
      </div>

      {/* Resume an in-progress round from anywhere in the app */}
      {draftRound && !(stage && typeof stage === "object" && "round" in stage) && (
        <button
          onClick={() => { setViewing(null); setTab("dashboard"); setStage({ round: draftRound }); }}
          style={{
            display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
            background: C.gold, color: "#16201C", border: "none", cursor: "pointer",
            borderRadius: 12, padding: "12px 16px", marginTop: 14,
          }}
        >
          <span style={{ fontSize: 20 }}>⛳</span>
          <span style={{ flex: 1 }}>
            <span style={{ display: "block", fontWeight: 800, fontSize: 14 }}>Round in progress — tap to resume</span>
            <span style={{ display: "block", fontSize: 12, opacity: 0.8 }}>
              {draftRound.course || "Your round"} · {draftRound.holes?.filter((h) => h.strokes != null).length || 0} holes entered
            </span>
          </span>
          <span style={{ fontWeight: 800, fontSize: 13 }}>Resume →</span>
        </button>
      )}

      {!activeGroup && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 18, color: C.sage }}>
          You are not in a group yet. Create one from the Groups tab.
        </div>
      )}

      {activeGroup?.is_support && (
        <div style={{ background: C.birdie, borderRadius: 12, padding: "12px 14px", marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, color: C.cream, fontSize: 13 }}>
            <b>Support mode</b> — you&apos;re inside <b>{activeGroup.name}</b> as a logged admin. Members can see you in the roster while you&apos;re here.
          </div>
          <button onClick={() => exitSupportGroup({ group_id: activeGroup.id, name: activeGroup.name })}
            style={{ background: C.cream, color: C.birdie, border: "none", borderRadius: 8, padding: "7px 14px", fontWeight: 800, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>
            Exit
          </button>
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        {stage === "setup" && activeGroup ? (
          <RoundSetup index={index} saveIndex={saveIndex} activeGroupId={activeGroup.id} activeGroupName={activeGroup.name} onCancel={() => setStage(null)}
            onReady={(round) => setStage({ round })} />
        ) : stage && typeof stage === "object" && "round" in stage ? (
          <RoundEditor round={stage.round} onCancel={() => setStage(null)}
            onSaved={async () => { await loadRounds(); setStage(null); setTab("rounds"); }} />
        ) : viewing ? (
          <RoundDetail round={viewing} ghinNumber={profile?.ghin_number || null} playerName={displayName}
            priorRounds={rounds.filter((r) => r.id !== viewing.id)}
            userEmail={user?.email || null}
            onBack={() => setViewing(null)}
            onEdit={() => { setStage({ round: viewing }); setViewing(null); }}
            onDelete={async () => { await deleteRound(viewing.id); setViewing(null); }} />
        ) : tab === "courses" && activeGroup ? (
          <CoursesLibrary user={user} activeGroupId={activeGroup.id} />
        ) : tab === "players" && activeGroup ? (
          <PlayersTab user={user} activeGroupId={activeGroup.id} isGroupAdmin={activeGroup.role === "admin"} onChanged={loadGroups} />
        ) : tab === "groups" ? (
          <GroupsPanel user={user} groups={groups} activeGroupId={activeGroupId} onGroupsChanged={loadGroups} onActiveGroupChange={chooseGroup} onGroupDeleted={onGroupDeleted} />
        ) : tab === "activity" && profile?.is_admin ? (
          <ActivityTab />
        ) : tab === "oversight" && profile?.is_admin ? (
          <AdminGroupsTab user={user} onEnterGroup={enterSupportGroup} onExitGroup={exitSupportGroup} onGroupsChanged={loadGroups} />
        ) : tab === "users" && profile?.is_admin ? (
          <AdminUsersTab user={user} />
        ) : tab === "feedback" && profile?.is_admin ? (
          <AdminFeedbackTab />
        ) : tab === "help" ? (
          <HelpPage isAdmin={!!profile?.is_admin} user={user} displayName={displayName} groupId={activeGroupId} />
        ) : tab === "profile" ? (
          <ProfilePanel profile={profile} user={user} onSaved={loadProfile} />
        ) : tab === "money" && activeGroup ? (
          <MoneyTab user={user} activeGroup={activeGroup} />
        ) : tab === "games" && activeGroup ? (
          <Tournaments session={session} activeGroupId={activeGroup.id} isAdmin={!!profile?.is_admin} />
        ) : loading ? (
          <div style={{ color: C.sage, textAlign: "center", padding: 40 }}>Loading your rounds…</div>
        ) : tab === "dashboard" ? (
          <Dashboard rounds={rounds} name={displayName} onOpen={setViewing} currentIndex={index} saveIndex={saveIndex}
            userEmail={user?.email || null} userId={user.id} savedCoach={profile?.dashboard_ai || null} onCoachSaved={loadProfile} />
        ) : (
          <RoundsList rounds={rounds} onOpen={setViewing} />
        )}
      </div>

      {/* Bottom navigation bar (mobile-first). 4 primary destinations + More. */}
      <nav style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 50,
        background: C.green, borderTop: `1px solid ${C.greenMid}`,
        display: "flex", justifyContent: "space-around", alignItems: "stretch",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {(() => {
          const primary: { key: Tab; label: string; icon: string }[] = [
            { key: "dashboard", label: "Home", icon: "⌂" },
            { key: "rounds", label: "Rounds", icon: "⛳" },
            { key: "games", label: "Games", icon: "🏆" },
            { key: "courses", label: "Courses", icon: "🗺" },
          ];
          const item = (active: boolean, icon: string, label: string, onClick: () => void) => (
            <button onClick={onClick} style={{
              flex: 1, background: "none", border: "none", cursor: "pointer",
              padding: "10px 4px 8px", display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
              color: active ? C.gold : C.sage,
            }}>
              <span style={{ fontSize: 19, lineHeight: 1 }}>{icon}</span>
              <span style={{ fontSize: 10, fontWeight: 700 }}>{label}</span>
            </button>
          );
          return (
            <>
              {primary.map((p) =>
                <React.Fragment key={p.key}>
                  {item(tab === p.key && !inFlow, p.icon, p.label, () => { setTab(p.key); setStage(null); setViewing(null); setMoreOpen(false); })}
                </React.Fragment>
              )}
              {item(moreOpen || (["players","groups","activity","oversight","users","feedback","help","profile","money"].includes(tab) && !inFlow), "⋯", "More", () => setMoreOpen((v) => !v))}
            </>
          );
        })()}
      </nav>

      {/* "More" sheet */}
      {moreOpen && (
        <>
          <div onClick={() => setMoreOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 60 }} />
          <div style={{
            position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 70,
            background: C.greenLight, borderTopLeftRadius: 18, borderTopRightRadius: 18,
            padding: "10px 12px calc(16px + env(safe-area-inset-bottom))",
          }}>
            <div style={{ width: 40, height: 4, background: C.greenMid, borderRadius: 2, margin: "6px auto 12px" }} />
            {(() => {
              const more: { key: Tab; label: string; show: boolean }[] = [
                { key: "money", label: "Money", show: !!activeGroup },
                { key: "players", label: "Players", show: true },
                { key: "groups", label: "Groups", show: showGroupsTab },
                { key: "activity", label: "Activity ★", show: !!profile?.is_admin },
                { key: "oversight", label: "Oversight ★", show: !!profile?.is_admin },
                { key: "users", label: "Users ★", show: !!profile?.is_admin },
                { key: "feedback", label: "Feedback ★", show: !!profile?.is_admin },
                { key: "help", label: "Help", show: true },
                { key: "profile", label: profile?.is_admin ? "Profile ★" : "Profile", show: true },
              ];
              return more.filter((m) => m.show).map((m) => (
                <button key={m.key} onClick={() => { setTab(m.key); setStage(null); setViewing(null); setMoreOpen(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left",
                    background: tab === m.key && !inFlow ? C.green : "none", border: "none", cursor: "pointer",
                    padding: "14px 16px", borderRadius: 10, marginBottom: 4,
                    color: tab === m.key && !inFlow ? C.gold : C.cream, fontSize: 16, fontWeight: 700,
                  }}>{m.label}</button>
              ));
            })()}
          </div>
        </>
      )}
      </div>
      </PullToRefresh>
    </>
  );
}

// One-time gate: a new user must enter their name before using the app, so
// group-mates see a real name instead of an email-derived placeholder.
function NameGate({ user, onSaved }: { user: any; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (name.trim().length < 2) { setErr("Please enter your name."); return; }
    setSaving(true); setErr(null);
    const { error } = await supabase.from("profiles").update({ display_name: name.trim() }).eq("id", user.id);
    setSaving(false);
    if (error) { setErr("Couldn't save your name. Please try again."); return; }
    onSaved();
  };
  return (
    <div style={{ maxWidth: 440, margin: "70px auto", padding: 24, textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center" }}><Wordmark width={240} /></div>
      <div style={{ background: C.greenLight, borderRadius: 16, padding: 26, marginTop: 26, textAlign: "left" }}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 3, fontWeight: 800 }}>WELCOME</div>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 22, fontWeight: 800, marginTop: 8 }}>
          What's your name?
        </div>
        <div style={{ color: C.sage, fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>
          This is how you'll appear to others in your group — on leaderboards, matches, and rosters.
        </div>
        <input autoFocus style={{ ...inputStyle, marginTop: 16, fontSize: 16 }} placeholder="e.g. Amit Sharma"
          value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") save(); }} />
        {err && <div style={{ color: "#E8A199", fontSize: 12, marginTop: 8 }}>{err}</div>}
        <button style={{ ...btn(true), width: "100%", marginTop: 16, padding: "13px", opacity: saving ? 0.5 : 1 }} disabled={saving} onClick={save}>
          {saving ? "Saving…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
