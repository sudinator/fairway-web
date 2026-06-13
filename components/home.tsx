"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import { C, Round, Hole, allocateStrokes } from "@/lib/golf";
import { logActivity } from "@/lib/activity";
import { loadDraft, draftHasScores } from "@/lib/draft";
import { loadActiveGame } from "@/lib/draft";
import { btn, Wordmark, inputStyle } from "@/components/ui";
import Tournaments from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell, PlayersTab, ActivityTab, HelpPage } from "@/components/manage";
import { RoundSetup } from "@/components/round-setup";
import { RoundEditor } from "@/components/round-editor";
import { RoundDetail } from "@/components/round-detail";
import { Dashboard } from "@/components/dashboard";
import { RoundsList } from "@/components/rounds-list";
import { GroupsPanel } from "@/components/groups";

import type { AppGroup } from "@/lib/groups";

const supabase = createClient();

type Tab = "dashboard" | "rounds" | "games" | "courses" | "players" | "groups" | "activity" | "help" | "profile";

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
    // Only trust a real name from the Google account; never fabricate one from the
    // email local-part, so group-mates don't see "jsmith123" instead of a name.
    const googleName = (user.user_metadata?.full_name || user.user_metadata?.name || "").trim();
    const { data: created } = await supabase.from("profiles")
      .insert({ id: user.id, display_name: googleName || null, email: user.email, last_active: new Date().toISOString() }).select().maybeSingle();
    setProfile(created || { id: user.id, display_name: googleName || null, handicap_index: null, ghin_number: null, is_admin: false });
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

  const inFlow = stage || viewing;
  const [moreOpen, setMoreOpen] = useState(false);
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0] || null;
  const isAdminOfAnyGroup = groups.some((g) => g.role === "admin");
  const showGroupsTab = isAdminOfAnyGroup || groups.length > 1;

  if (groupsLoading) {
    return <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px", color: C.sage }}>Loading groups…</div>;
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

      {!activeGroup && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 18, color: C.sage }}>
          You are not in a group yet. Create one from the Groups tab.
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
          <RoundDetail round={viewing} ghinNumber={profile?.ghin_number || null} playerName={displayName} onBack={() => setViewing(null)}
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
              {item(moreOpen || (["players","groups","activity","help","profile"].includes(tab) && !inFlow), "⋯", "More", () => setMoreOpen((v) => !v))}
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
                { key: "players", label: "Players", show: true },
                { key: "groups", label: "Groups", show: showGroupsTab },
                { key: "activity", label: "Activity ★", show: !!profile?.is_admin },
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
