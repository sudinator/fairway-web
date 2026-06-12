"use client";

import React, { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase";
import {
  C, Round, Hole, courseHandicap, strokesReceived, allocateStrokes, stablefordPts, validateStrokeIndexes,
  played, strokesOf, diffOf, puttsOf, pensOf, ptsOf, toParStr, fmtDate, isGrossOnly, hasHoleDetail,
  girStats, firStats, pct, fracPct, holeBuckets, avgByPar, roundDifferential, runningHandicap, threePuttsPerRound, estimatedStablefordPts, hasEstimatedStableford, stablefordDisplay,
} from "@/lib/golf";
import { btn, Wordmark } from "@/components/ui";
import Tournaments from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell, PlayersTab } from "@/components/manage";
import { RoundSetup } from "@/components/round-setup";
import { RoundEditor } from "@/components/round-editor";
import { RoundDetail } from "@/components/round-detail";
import { Dashboard } from "@/components/dashboard";
import { RoundsList } from "@/components/rounds-list";

const supabase = createClient();

export function Home({ session }: { session: any }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [tab, setTab] = useState<"dashboard" | "rounds" | "games" | "courses" | "players" | "profile">("dashboard");
  const [stage, setStage] = useState<null | "setup" | { round: Round }>(null);
  const [viewing, setViewing] = useState<Round | null>(null);

  const user = session.user;
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
  const index = profile?.handicap_index ?? null;

  // Load (or create) this user's profile: display name, handicap index, GHIN number.
  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
    if (data) {
      setProfile(data);
      // Heartbeat: record that this user is active now (and backfill email if missing).
      supabase.from("profiles").update({ last_active: new Date().toISOString(), email: user.email }).eq("id", user.id).then(() => {});
      return;
    }
    // First login — create a profile row.
    const fallbackName = user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";
    const { data: created } = await supabase.from("profiles")
      .insert({ id: user.id, display_name: fallbackName, email: user.email, last_active: new Date().toISOString() }).select().maybeSingle();
    setProfile(created || { id: user.id, display_name: fallbackName, handicap_index: null, ghin_number: null, is_admin: false });
  }, [user.id, user.email, user.user_metadata]);
  useEffect(() => { loadProfile(); }, [loadProfile]);

  const saveIndex = async (idx: number | null) => {
    setProfile((p: any) => ({ ...p, handicap_index: idx }));
    await supabase.from("profiles").update({ handicap_index: idx }).eq("id", user.id);
  };

  const loadRounds = useCallback(async () => {
    setLoading(true);
    const { data: rs } = await supabase
      .from("rounds").select("*").order("played_at", { ascending: false });
    if (!rs) { setRounds([]); setLoading(false); return; }
    const ids = rs.map((r) => r.id);
    const { data: hs } = await supabase
      .from("holes").select("*").in("round_id", ids.length ? ids : ["none"]);
    const byRound: Record<string, Hole[]> = {};
    (hs || []).forEach((h: any) => {
      (byRound[h.round_id] ||= []).push(h);
    });
    const merged: Round[] = rs.map((r: any) => {
      const sorted = (byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number);
      const alloc = allocateStrokes(sorted, r.course_handicap);
      const holes = sorted.map((h) => ({ ...h, recv: alloc[h.hole_number] || 0 }));
      return { ...r, holes };
    });
    setRounds(merged);
    setLoading(false);
  }, []);

  useEffect(() => { loadRounds(); }, [loadRounds]);

  const deleteRound = async (id: string) => {
    await supabase.from("rounds").delete().eq("id", id);
    await loadRounds();
  };

  const inFlow = stage || viewing;

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <Wordmark width={150} />
        <div style={{ color: C.sage, fontSize: 13 }}>{displayName}{index != null ? ` · HCP ${index}` : ""}</div>
        <div style={{ flex: 1 }} />
        <NotificationBell user={user} />
        <button style={{ ...btn(false), fontSize: 12 }} onClick={() => supabase.auth.signOut()}>Sign out</button>
        <button style={btn(true)} onClick={() => { setStage("setup"); setViewing(null); }}>＋ New round</button>
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 16, borderBottom: `1px solid ${C.greenMid}`, flexWrap: "wrap" }}>
        {(["dashboard", "rounds", "games", "courses", "players"] as const).map((k) => (
          <button key={k} onClick={() => { setTab(k); setStage(null); setViewing(null); }}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
              color: tab === k && !inFlow ? C.gold : C.sage,
              borderBottom: tab === k && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
            }}>{k === "dashboard" ? "Dashboard" : k === "rounds" ? "Rounds" : k === "games" ? "Games" : k === "courses" ? "Courses" : "Players"}</button>
        ))}
        <button onClick={() => { setTab("profile"); setStage(null); setViewing(null); }}
          style={{
            background: "none", border: "none", cursor: "pointer", padding: "10px 16px", fontSize: 14, fontWeight: 700,
            color: tab === "profile" && !inFlow ? C.gold : C.sage,
            borderBottom: tab === "profile" && !inFlow ? `2px solid ${C.gold}` : "2px solid transparent",
          }}>Profile{profile?.is_admin ? " ★" : ""}</button>
      </div>

      <div style={{ marginTop: 20 }}>
        {stage === "setup" ? (
          <RoundSetup index={index} saveIndex={saveIndex} onCancel={() => setStage(null)}
            onReady={(round) => setStage({ round })} />
        ) : stage && "round" in stage ? (
          <RoundEditor round={stage.round} onCancel={() => setStage(null)}
            onSaved={async () => { await loadRounds(); setStage(null); setTab("rounds"); }} />
        ) : viewing ? (
          <RoundDetail round={viewing} onBack={() => setViewing(null)}
            onEdit={() => { setStage({ round: viewing }); setViewing(null); }}
            onDelete={async () => { await deleteRound(viewing.id); setViewing(null); }} />
        ) : tab === "courses" ? (
          <CoursesLibrary user={user} />
        ) : tab === "players" ? (
          <PlayersTab />
        ) : tab === "profile" ? (
          <ProfilePanel profile={profile} user={user} onSaved={loadProfile} />
        ) : tab === "games" ? (
          <Tournaments session={session} />
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

