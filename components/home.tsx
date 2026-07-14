"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase";
import { C, titleCaseName, Round, Hole, allocateStrokes, dedupeHoles, TGC_GROUP_ID } from "@/lib/golf";
import { computeBalances, aggregateOwed, fmtUSD } from "@/lib/money";
import { logActivity } from "@/lib/activity";
import { Toaster } from "@/components/toast";
import { loadDraft, draftHasScores } from "@/lib/draft";
import { loadActiveGame, saveAppBootCache, loadAppBootCache } from "@/lib/draft";
import { btn, Wordmark, inputStyle } from "@/components/ui";
import Tournaments, { type GameSeed } from "@/components/tournaments";
import { CoursesLibrary, ProfilePanel, NotificationBell, NotificationsScreen, PlayersTab, AdminHome, HelpPage } from "@/components/manage";
import { MoneyTab } from "@/components/money";
import { TeeTimes } from "@/components/tee-times";
import { syncBadges } from "@/lib/badge-sync";
import { syncPlayerCard } from "@/lib/card-sync";
import { RoundSetup } from "@/components/round-setup";
import { RoundEditor } from "@/components/round-editor";
import { RoundDetail } from "@/components/round-detail";
import { diagEnabled } from "@/lib/debuglog";
import { Dashboard } from "@/components/dashboard";
import { RoundsList } from "@/components/rounds-list";
import { GroupsPanel } from "@/components/groups";
import { InstallHint } from "@/components/install-hint";
import { PullToRefresh } from "@/components/pull-to-refresh";

import type { AppGroup } from "@/lib/groups";

const supabase = createClient();

type Tab = "dashboard" | "rounds" | "games" | "courses" | "players" | "groups" | "admin" | "help" | "profile" | "money" | "teetimes" | "notifications";

// Viewport diagnostic overlay — measures the real device numbers so we can locate the
// gap below the nav precisely instead of guessing. Self-gates on diagEnabled(); zero cost
// for normal users. Toggle via Admin -> Diagnostics.
function ViewportDiag() {
  const [on, setOn] = useState(false);
  const [m, setM] = useState<Record<string, number | string> | null>(null);
  const [copied, setCopied] = useState(false);

  const probe = (cssHeight: string): number => {
    try {
      const d = document.createElement("div");
      d.style.cssText = `position:absolute;top:0;left:0;width:0;visibility:hidden;height:${cssHeight};`;
      document.body.appendChild(d);
      const h = d.getBoundingClientRect().height;
      document.body.removeChild(d);
      return Math.round(h * 100) / 100;
    } catch { return -1; }
  };

  const measure = () => {
    const vv = (window as any).visualViewport;
    const shell = document.querySelector('[data-diag="shell"]') as HTMLElement | null;
    const nav = document.querySelector('[data-diag="nav"]') as HTMLElement | null;
    const sr = shell?.getBoundingClientRect();
    const nr = nav?.getBoundingClientRect();
    const inner = window.innerHeight;
    const navBottom = nr ? Math.round(nr.bottom) : -1;
    const standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (navigator as any).standalone === true;
    setM({
      mode: standalone ? "installed" : "browser",
      innerHeight: inner,
      docClientH: document.documentElement.clientHeight,
      visualVP_h: vv ? Math.round(vv.height) : -1,
      vvOffsetTop: vv ? Math.round(vv.offsetTop) : -1,
      appH_var: (getComputedStyle(document.documentElement).getPropertyValue("--app-h") || "unset").trim(),
      dvh: probe("100dvh"),
      svh: probe("100svh"),
      lvh: probe("100lvh"),
      safeTop: probe("env(safe-area-inset-top)"),
      safeBottom: probe("env(safe-area-inset-bottom)"),
      bodyH: Math.round(document.body.getBoundingClientRect().height),
      shellH: sr ? Math.round(sr.height) : -1,
      shellBottom: sr ? Math.round(sr.bottom) : -1,
      navH: nr ? Math.round(nr.height) : -1,
      navTop: nr ? Math.round(nr.top) : -1,
      navBottom,
      navBottom_vs_visible: nr ? (vv ? Math.round(vv.height) : inner) - navBottom : -1,
    });
  };

  useEffect(() => {
    let alive = true;
    let prev = false;
    const sync = () => {
      if (!alive) return;
      const en = diagEnabled();
      setOn(en);
      if (en && !prev) requestAnimationFrame(measure); // just turned on → capture
      prev = en;
    };
    sync();
    const poll = setInterval(sync, 800); // reflect the Admin toggle without a reload
    const run = () => requestAnimationFrame(measure);
    window.addEventListener("resize", run);
    window.addEventListener("orientationchange", run);
    const vv = (window as any).visualViewport;
    vv?.addEventListener("resize", run);
    return () => {
      alive = false;
      clearInterval(poll);
      window.removeEventListener("resize", run);
      window.removeEventListener("orientationchange", run);
      vv?.removeEventListener("resize", run);
    };
  }, []);

  if (!on || !m) return null;

  const copy = () => {
    try { navigator.clipboard.writeText(JSON.stringify(m, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
  };

  return (
    <div style={{
      position: "fixed", top: "calc(env(safe-area-inset-top) + 6px)", left: 6, right: 6, zIndex: 9999,
      background: "rgba(0,0,0,0.86)", color: "#fff", borderRadius: 10, padding: "8px 10px",
      fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, lineHeight: 1.5,
      boxShadow: "0 4px 18px rgba(0,0,0,0.5)",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <b style={{ fontSize: 12, color: "#C9A227" }}>VIEWPORT DIAG</b>
        <span style={{ display: "flex", gap: 6 }}>
          <button onClick={measure} style={{ fontSize: 11, background: "#16503D", color: "#fff", border: "none", borderRadius: 6, padding: "3px 8px", fontWeight: 700 }}>Remeasure</button>
          <button onClick={copy} style={{ fontSize: 11, background: "#C9A227", color: "#0E3B2E", border: "none", borderRadius: 6, padding: "3px 8px", fontWeight: 700 }}>{copied ? "Copied" : "Copy"}</button>
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 12px" }}>
        {Object.entries(m).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between",
            color: k === "navBottom_vs_visible" ? (Math.abs(Number(v)) > 2 ? "#F08" : "#6f6") : "#ddd",
            fontWeight: k === "navBottom_vs_visible" || k === "mode" ? 800 : 400 }}>
            <span>{k}</span><span>{String(v)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Home({ session }: { session: any }) {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [badgeSync, setBadgeSync] = useState(0);
  const [dbInProgress, setDbInProgress] = useState<Round | null>(null);
  const [inProgressCount, setInProgressCount] = useState(0);
  // Weekly "finish your profile" nudge — dismissible; re-appears after 7 days.
  const [profNudgeHidden, setProfNudgeHidden] = useState<boolean>(() => {
    try { const v = typeof window !== "undefined" ? localStorage.getItem("bnn_prof_nudge") : null; return v ? (Date.now() - Number(v) < 7 * 86400000) : false; } catch { return false; }
  });
  const dismissProfNudge = () => { try { localStorage.setItem("bnn_prof_nudge", String(Date.now())); } catch { /* ignore */ } setProfNudgeHidden(true); };
  const profNudgeLogged = useRef(false);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<any>(null);
  const [groups, setGroups] = useState<AppGroup[]>([]);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("dashboard");
  // When a reused page (Members / Club settings) is opened FROM the admin home, we remember
  // that origin so the page shows an iOS-style back bar to return there. null = no back bar.
  const [returnTab, setReturnTab] = useState<Tab | null>(null);
  const tabTitle = (t: Tab | null) => (t === "admin" ? "Admin" : t === "players" ? "Members" : t === "groups" ? "Club settings" : "");
  // When the owe banner is tapped we want the Money tab to open straight on "Settle".
  // The MoneyTab remounts each time you enter it, so this one-shot flag is read on mount;
  // clear it whenever we're not on the money tab so a normal re-entry lands on Balances.
  const [moneyInitialTab, setMoneyInitialTab] = useState<"settle" | null>(null);
  useEffect(() => { if (tab !== "money") setMoneyInitialTab(null); }, [tab]);
  // Tee Times → game handoff (P4): a seed prefills Create Game; openGameId opens an
  // already-linked game. One-shot, cleared when we leave the Games tab (like money).
  const [gameSeed, setGameSeed] = useState<GameSeed | null>(null);
  const [openGameId, setOpenGameId] = useState<string | null>(null);
  useEffect(() => { if (tab !== "games") { setGameSeed(null); setOpenGameId(null); } }, [tab]);
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
  // Deep link from a WhatsApp reminder (birdienumnum.vercel.app/?tt=<id>): page.tsx
  // stashes the id to localStorage before auth; read + clear it once here.
  const [deepTeeId, setDeepTeeId] = useState<string | null>(() => {
    try { const v = typeof window !== "undefined" ? localStorage.getItem("bnn_dl_tt") : null; if (v) localStorage.removeItem("bnn_dl_tt"); return v; } catch { return null; }
  });
  useEffect(() => { if (deepTeeId) setTab("teetimes"); }, [deepTeeId]);

  // Deep link from a notification (/?tab=money|games|teetimes…): open that tab once.
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("tab");
      const allowed = ["dashboard", "rounds", "games", "courses", "players", "groups", "admin", "help", "profile", "money", "teetimes", "notifications"];
      if (t && allowed.includes(t)) {
        setTab(t as Tab);
        const url = new URL(window.location.href); url.searchParams.delete("tab");
        window.history.replaceState({}, "", url.pathname + url.search);
      }
    } catch { /* ignore */ }
  }, []);

  // In-app navigation when a "live" notification (one carrying a link) is tapped. Parses the
  // stored link (/?tab=… or /?tt=<id>) and routes without a full reload.
  const navigateFromNotif = (link?: string | null) => {
    if (!link) return;
    try {
      const q = new URLSearchParams(link.includes("?") ? link.slice(link.indexOf("?") + 1) : "");
      const tt = q.get("tt");
      const t = q.get("tab");
      setStage(null); setViewing(null); setMoreOpen(false); setReturnTab(null);
      if (tt) { setDeepTeeId(tt); setTab("teetimes"); }
      else if (t) {
        const allowed = ["dashboard", "rounds", "games", "courses", "players", "groups", "admin", "help", "profile", "money", "teetimes", "notifications"];
        if (allowed.includes(t)) setTab(t as Tab);
      }
    } catch { /* ignore malformed links */ }
  };

  // A deep link may point at a tee time in a group the user isn't currently viewing.
  // Resolve that tee time's group and switch to it BEFORE handing the id to TeeTimes,
  // so the tee time is actually in the loaded list when TeeTimes tries to open it.
  // deepTeeGroupId: undefined = still resolving; null = unresolvable (unknown id, or
  // not a member — let TeeTimes try the current group and gracefully no-op); string =
  // the target group (we switch to it and wait until it's active).
  const [deepTeeGroupId, setDeepTeeGroupId] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!deepTeeId) { setDeepTeeGroupId(undefined); return; }
    if (groupsLoading) return; // wait until we know which groups the user belongs to
    let cancelled = false;
    (async () => {
      let gid: string | null = null;
      try {
        const { data } = await supabase.from("tee_times").select("group_id").eq("id", deepTeeId).single();
        gid = ((data as any)?.group_id as string) || null;
      } catch { gid = null; }
      if (cancelled) return;
      if (gid && groups.some((g) => g.id === gid)) {
        setDeepTeeGroupId(gid);
        if (gid !== activeGroupId) {
          setActiveGroupId(gid);
          saveAppBootCache({ groups, activeGroupId: gid });
          supabase.from("profiles").update({ active_group_id: gid }).eq("id", user.id).then(() => {});
          setProfile((p: any) => (p ? { ...p, active_group_id: gid } : p));
        }
      } else {
        setDeepTeeGroupId(null); // unknown tee time or not a member — don't switch
      }
    })();
    return () => { cancelled = true; };
    // activeGroupId intentionally omitted: we set it here and don't want to re-run on our own change
  }, [deepTeeId, groupsLoading, groups]); // eslint-disable-line react-hooks/exhaustive-deps
  // Only pass the deep link to TeeTimes once its group is the active one (or we've
  // given up resolving), so TeeTimes can't prematurely "consume" it against the wrong group.
  const deepReady = !!deepTeeId && deepTeeGroupId !== undefined && (deepTeeGroupId === null || activeGroupId === deepTeeGroupId);

  // On open, resume an in-progress round straight into the scorecard.
  // Priority: an active game → this device's round draft → the server's in-progress round.
  useEffect(() => {
    if (resumeChecked) return;
    // A tee-time deep link takes priority over resuming a round/game.
    if (deepTeeId) { setResumeChecked(true); return; }
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
  }, [resumeChecked, loading, dbInProgress, deepTeeId]);

  const user = session.user;
  const displayName = profile?.display_name || user.user_metadata?.full_name || user.email?.split("@")[0] || "Golfer";

  // The app shell is a fixed-height flex column: content scrolls inside scrollRef and
  // the bottom nav is a normal flex child, NOT position:fixed. On iOS home-screen PWAs
  // position:fixed drifts during scroll and visualViewport reports the wrong height, so
  // layout-pinning the nav is the only reliable way to keep it glued to the bottom.
  const scrollRef = useRef<HTMLDivElement>(null);

  const index = profile?.handicap_index ?? null;

  const activateEmailInvites = useCallback(async () => {
    const email = (user.email || "").toLowerCase();
    if (!email) return;
    await supabase.from("group_members").update({ user_id: user.id, status: "active" }).eq("email", email).eq("status", "invited");
  }, [user.id, user.email]);

  const loadGroups = useCallback(async (preferId?: string | null) => {
    // Offline: don't sit on "Loading clubs…" waiting for a request that can't land.
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
      .select("group_id, role, status, is_support, groups(id, name, status, is_test)")
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
        name: m.groups?.name || "Club",
        role: m.role,
        status: m.status,
        is_support: !!m.is_support,
        is_test: !!m.groups?.is_test,
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
      supabase.rpc("mark_active", { p_standalone: (typeof window !== "undefined") && ((window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || (window.navigator as any).standalone === true) }).then(() => {}); // record activity + install mode for analytics
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
      setRounds([]); setDbInProgress(null); setInProgressCount(0); setLoading(false); return;
    }
    setLoading(true);
    // Personal views intentionally show this user's rounds across every group.
    let { data: rs, error: rErr } = await supabase
      .from("rounds").select("*, groups(name)").eq("user_id", user.id).is("deleted_at", null).order("played_at", { ascending: false });
    if (rErr) {
      // The deleted_at column may not exist yet (migration 0058 not run). NEVER blank the
      // rounds list on a query error — fall back to the unfiltered query so every round
      // still loads. Data is never deleted; the filter only hides soft-deleted rows.
      const retry = await supabase.from("rounds").select("*, groups(name)").eq("user_id", user.id).order("played_at", { ascending: false });
      rs = retry.data;
    }
    if (!rs) { setRounds([]); setLoading(false); return; }
    const ids = rs.map((r: any) => r.id);
    const { data: hs } = await supabase
      .from("holes").select("*").in("round_id", ids.length ? ids : ["none"]);
    const byRound: Record<string, Hole[]> = {};
    (hs || []).forEach((h: any) => { (byRound[h.round_id] ||= []).push(h); });
    const merged: Round[] = rs.map((r: any) => {
      const sorted = dedupeHoles(byRound[r.id] || []).sort((a, b) => a.hole_number - b.hole_number);
      const alloc = allocateStrokes(sorted, r.course_handicap);
      const holes = sorted.map((h) => ({ ...h, recv: alloc[h.hole_number] || 0 }));
      return { ...r, group_name: r.groups?.name || null, holes };
    });
    // Keep in-progress rounds out of the normal list (no clutter); surface the most
    // recent one for resume (covers a cleared-storage or different-device case).
    const finished = merged.filter((r: any) => (r.status ?? "final") !== "in_progress");
    const inProgAll = merged.filter((r: any) => (r.status ?? "final") === "in_progress")
      .sort((a: any, b: any) => +new Date(b.played_at) - +new Date(a.played_at));
    const inProg = inProgAll[0] || null;
    setRounds(finished);
    setDbInProgress(inProg);
    setInProgressCount(inProgAll.length);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { loadRounds(); }, [loadRounds]);

  // Best-effort: auto-finish stale-but-complete in-progress rounds (self-throttled to
  // once/hour server-side, so calling on each open is fine). Reloads if any were fixed.
  useEffect(() => {
    if (!user?.id) return;
    supabase.rpc("finish_stale_rounds").then(({ data }: any) => {
      if (typeof data === "number" && data > 0) loadRounds();
    }, () => {});
  }, [user?.id, loadRounds]);

  // Best-effort: nudge organizers of fully-scored games to end them, and auto-complete any that are
  // past the end of their ET day (self-throttled to once/hour server-side). Reloads if any completed,
  // since the current user may have had a round posted by the auto-complete.
  useEffect(() => {
    if (!user?.id) return;
    supabase.rpc("sweep_stale_games").then(({ data }: any) => {
      if (typeof data === "number" && data > 0) loadRounds();
    }, () => {});
  }, [user?.id, loadRounds]);

  // Keep achievements in step with finished rounds. This single reconcile covers
  // every finalize path (new round, mark-complete, game-recorded) and doubles as
  // the one-time backfill of history — it's idempotent and a no-op when nothing
  // changed, so running it on each rounds change is cheap. Only bumps the wall's
  // refresh key when something actually moved.
  useEffect(() => {
    if (!user?.id || !rounds.length) return;
    let alive = true;
    syncBadges(supabase, user.id, rounds).then((res) => {
      if (alive && (res.changed || res.removed)) setBadgeSync((v) => v + 1);
    }).catch(() => {});
    syncPlayerCard(supabase, user.id, rounds).catch(() => {});
    return () => { alive = false; };
  }, [rounds, user?.id]);

  const deleteRound = async (id: string) => {
    const r = rounds.find((x) => x.id === id);
    // A round recorded from a game is just a personal copy — deleting it never
    // touches the game result, the leaderboard, or any posted/paid winnings
    // (those live on the game, not the round). Make that explicit so nobody
    // panics that they've broken the money.
    if (r?.game_id && typeof window !== "undefined") {
      const ok = window.confirm(
        "This round came from a Club game. Deleting it only removes it from your own history and handicap — it does NOT change the game result or any winnings already posted to Money. Delete it from your history?",
      );
      if (!ok) return;
    }
    // Soft-delete every round (not just game-linked ones). A hard DELETE that RLS
    // doesn't permit silently removes 0 rows; an owner UPDATE is allowed, so setting
    // deleted_at reliably removes the round from all stats/handicap. It also survives
    // any re-post (recordMyGameRound finds the hidden row and updates it in place).
    const { error } = await supabase.from("rounds").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    if (error) { alert("Couldn't delete that round — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "round_deleted", summary: `Deleted a round${r ? ` at ${r.course}` : ""}` });
    await loadRounds();
  };

  // Finalize an in-progress round exactly as it stands (e.g. only 9 or 15 holes played).
  // status='final' is what makes a round count in stats; a partial round is legitimate.
  const markRoundComplete = async (r: Round) => {
    const gross = (r.holes || []).reduce((s: number, h: any) => s + (h.strokes || 0), 0);
    const { error } = await supabase.from("rounds")
      .update({ status: "final", gross_score: gross || null, played_at: (r as any).played_at || new Date().toISOString(), finished_by: user.id, finished_at: new Date().toISOString() })
      .eq("id", r.id);
    if (error) { alert("Couldn't mark that round complete — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "round_completed", summary: `Marked a round complete${r.course ? ` at ${r.course}` : ""}` });
    await loadRounds();
  };

  // Discard every unfinished (in_progress) round for this user in one action. These never
  // counted toward stats or handicap (the app ignores in_progress), so this only clears
  // clutter. Soft-delete (deleted_at) so it's recoverable server-side if ever needed.
  const discardAllInProgress = async () => {
    if (typeof window !== "undefined" && !window.confirm(
      `Discard ${inProgressCount > 1 ? `all ${inProgressCount} unfinished rounds` : "this unfinished round"}? They were never completed, so this doesn't touch your stats or handicap.`
    )) return;
    const { error } = await supabase.from("rounds").update({ deleted_at: new Date().toISOString() })
      .eq("user_id", user.id).eq("status", "in_progress").is("deleted_at", null);
    if (error) { alert("Couldn't discard — " + error.message); return; }
    setStage(null);
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
    if (error) { alert("Couldn't enter the Club — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "admin_entered_group", group_id: g.group_id, summary: `Master admin entered Club "${g.name}" (support session)` });
    await loadGroups(g.group_id);
    setStage(null); setViewing(null); setMoreOpen(false); setTab("dashboard");
  };
  const exitSupportGroup = async (g: { group_id: string; name: string }) => {
    const { error } = await supabase.rpc("admin_exit_group", { p_group: g.group_id });
    if (error) { alert("Couldn't exit the Club — " + error.message); return; }
    await logActivity(supabase, { actor_id: user.id, actor_name: user.email || "Master admin", action: "admin_exited_group", group_id: g.group_id, summary: `Master admin exited group "${g.name}" (support session)` });
    await loadGroups();
  };

  const inFlow = stage || viewing;
  const [moreOpen, setMoreOpen] = useState(false);
  const activeGroup = groups.find((g) => g.id === activeGroupId) || groups[0] || null;

  // Profile-completion nudge funnel: log one impression per session when the banner is
  // visible, and a click when the CTA is tapped (see the button below).
  const showProfNudge = !!(activeGroup && !profNudgeHidden && profile && (!profile.avatar_url || profile.handicap_index == null));
  useEffect(() => {
    if (showProfNudge && !profNudgeLogged.current && user?.id) {
      profNudgeLogged.current = true;
      logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "profile_nudge_shown", summary: "Profile-completion nudge shown" });
    }
  }, [showProfNudge, user?.id, displayName]);

  // Aggregated owe-banner: how much the current user owes across ALL their groups.
  const [owed, setOwed] = useState<{ cents: number; groups: number }>({ cents: 0, groups: 0 });
  const loadOwed = useCallback(async () => {
    const gids = groups.map((g) => g.id);
    if (!gids.length) { setOwed({ cents: 0, groups: 0 }); return; }
    const [{ data: exp }, { data: setl }, { data: gg }] = await Promise.all([
      supabase.from("expenses").select("id, group_id, payer_user_id, amount_cents").in("group_id", gids),
      supabase.from("settlements").select("group_id, from_user_id, to_user_id, amount_cents").in("group_id", gids),
      supabase.from("group_guests").select("id, group_id, sponsor_user_id").in("group_id", gids),
    ]);
    const exps = (exp || []) as any[];
    const expIds = exps.map((e) => e.id);
    const { data: sh } = expIds.length
      ? await supabase.from("expense_shares").select("expense_id, user_id, guest_id, share_cents").in("expense_id", expIds)
      : { data: [] as any[] };
    const { data: py } = expIds.length
      ? await supabase.from("expense_payers").select("expense_id, user_id, paid_cents").in("expense_id", expIds)
      : { data: [] as any[] };
    const g2 = (o: Record<string, any[]>, k: string) => (o[k] || (o[k] = []));
    const expBy: Record<string, any[]> = {}; exps.forEach((e) => g2(expBy, e.group_id).push(e));
    const setlBy: Record<string, any[]> = {}; ((setl || []) as any[]).forEach((x) => g2(setlBy, x.group_id).push(x));
    const ggBy: Record<string, any[]> = {}; ((gg || []) as any[]).forEach((x) => g2(ggBy, x.group_id).push(x));
    const expToGroup: Record<string, string> = {}; exps.forEach((e) => { expToGroup[e.id] = e.group_id; });
    const shBy: Record<string, any[]> = {}; ((sh || []) as any[]).forEach((x) => { const gid = expToGroup[x.expense_id]; if (gid) g2(shBy, gid).push(x); });
    const pyBy: Record<string, any[]> = {}; ((py || []) as any[]).forEach((x) => { const gid = expToGroup[x.expense_id]; if (gid) g2(pyBy, gid).push(x); });
    const perGroup = gids.map((gid) => computeBalances(expBy[gid] || [], shBy[gid] || [], setlBy[gid] || [], ggBy[gid] || [], pyBy[gid] || []));
    setOwed({ cents: aggregateOwed(perGroup, user.id), groups: perGroup.filter((b) => (b[user.id] || 0) < 0).length });
  }, [groups, user.id]);
  useEffect(() => { loadOwed(); }, [loadOwed]);
  // Everyone can see the Clubs tab — that's where a member requests a new club and
  // switches between the clubs they belong to. (Creation is still request-and-approve
  // until we open up free self-serve creation.)
  const showGroupsTab = true;

  if (groupsLoading) {
    return <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 60px", color: C.sage }}>Loading clubs…</div>;
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

  const testMode = !!profile?.is_test || !!groups.find((g) => g.id === activeGroupId)?.is_test;

  return (
    <div data-diag="shell" className="app-shell">
      <Toaster />
      <ViewportDiag />
      {testMode && (
        <div aria-hidden="true" style={{ position: "fixed", inset: 0, border: "3px solid #DC2626", pointerEvents: "none", zIndex: 9999 }}>
          <div style={{ position: "absolute", top: "env(safe-area-inset-top, 0px)", left: "50%", transform: "translateX(-50%)", background: "#DC2626", color: "#fff", fontSize: 11, fontWeight: 800, letterSpacing: 1, padding: "2px 10px", borderRadius: "0 0 8px 8px" }}>TEST MODE</div>
        </div>
      )}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", overflowX: "hidden", WebkitOverflowScrolling: "touch" }}>
      <InstallHint />
      <PullToRefresh scrollEl={scrollRef} onRefresh={async () => { await Promise.all([loadProfile(), loadGroups(), loadRounds()]); }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", padding: "20px 16px 24px" }}>
      {/* Line 1: logo + active club (display only — change it in the Clubs tab) */}
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
        <NotificationBell user={user} onNavigate={navigateFromNotif} onSeeAll={() => { setTab("notifications"); setReturnTab(null); setStage(null); setViewing(null); }} />
        {tab !== "money" && <button style={{ ...btn(true), opacity: activeGroup ? 1 : 0.5 }} disabled={!activeGroup} onClick={() => {
          if (dbInProgress) {
            if (typeof window !== "undefined") window.alert(`You have an unfinished round at ${dbInProgress.course || "a course"}. Finish it, mark it complete, or discard it before starting a new one.`);
            setStage(null); setViewing(null); setTab("dashboard");
            return;
          }
          setStage("setup"); setViewing(null);
        }}>＋ New round</button>}
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

      {/* Unfinished-round nudge: a started round only counts once it's completed, so
          prompt to finish it (partial is fine), mark it complete as-is, or discard it. */}
      {dbInProgress && !(stage && typeof stage === "object" && "round" in stage) && (
        <div style={{ background: C.greenLight, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginTop: 12 }}>
          <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>⛳ {inProgressCount > 1 ? `You have ${inProgressCount} unfinished rounds` : "You have an unfinished round"}</div>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
            {dbInProgress.course || "Your round"} · {dbInProgress.holes?.filter((h) => h.strokes != null).length || 0} holes entered. A round only counts once it's completed — finishing a 9- or 15-hole round is fine. {inProgressCount > 1 ? "Showing the most recent; discard all to clear the rest. " : ""}You'll need to resolve this before starting a new round.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button onClick={() => { setViewing(null); setTab("dashboard"); setStage({ round: dbInProgress }); }} style={{ ...btn(true), flex: 1, minWidth: 110, fontSize: 12 }}>Finish scoring</button>
            <button onClick={() => markRoundComplete(dbInProgress)} style={{ ...btn(false), flex: 1, minWidth: 110, fontSize: 12 }}>Mark complete</button>
            <button onClick={() => deleteRound(dbInProgress.id)} style={{ ...btn(false), flex: 1, minWidth: 90, fontSize: 12 }}>Delete</button>
            {inProgressCount > 1 && <button onClick={discardAllInProgress} style={{ ...btn(false), flex: 1, minWidth: 110, fontSize: 12 }}>Discard all {inProgressCount}</button>}
          </div>
        </div>
      )}

      {/* Weekly profile-completion nudge — shown in-app when the profile is missing a
          photo or handicap; links to the Profile tab. Dismiss hides it for a week. */}
      {showProfNudge && (
        <div style={{ background: "#16302A", border: `1px solid ${C.gold}`, borderRadius: 12, padding: "12px 14px", marginTop: 12 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <div style={{ color: C.cream, fontSize: 13, fontWeight: 700, flex: 1 }}>✨ Finish setting up your profile</div>
            <button onClick={dismissProfNudge} style={{ background: "none", border: "none", color: C.faint, fontSize: 12, cursor: "pointer" }}>Dismiss</button>
          </div>
          <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
            {[!profile.avatar_url ? "a profile photo" : null, profile.handicap_index == null ? "your handicap index" : null].filter(Boolean).join(" and ")} {(!profile.avatar_url && profile.handicap_index == null) ? "are" : "is"} missing — adding {(!profile.avatar_url && profile.handicap_index == null) ? "them" : "it"} helps your group recognise you and keeps net scoring accurate.
          </div>
          <button onClick={() => { logActivity(supabase, { actor_id: user.id, actor_name: displayName, action: "profile_nudge_clicked", summary: "Tapped the profile-completion nudge" }); setMoreOpen(false); setViewing(null); setStage(null); setTab("profile"); }} style={{ ...btn(true), width: "100%", marginTop: 10, fontSize: 12 }}>Complete my profile →</button>
        </div>
      )}

      {!activeGroup && (
        <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 18, color: C.sage }}>
          You are not in a Club yet. Create one from the Clubs tab.
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

      {owed.cents > 0 && !inFlow && (
        <button onClick={() => { setMoneyInitialTab("settle"); setTab("money"); setStage(null); setViewing(null); }}
          style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "#5a2018", border: "1px solid #7a2e22", borderRadius: 12, padding: "11px 14px", marginTop: 14, cursor: "pointer" }}>
          <span style={{ fontSize: 18 }}>&#9888;&#65039;</span>
          <span style={{ flex: 1, color: "#ffd9d2", fontSize: 13 }}>You owe <b style={{ color: "#fff" }}>{fmtUSD(owed.cents)}</b> to settle up{owed.groups > 1 ? ` across ${owed.groups} clubs` : ""}</span>
          <span style={{ background: C.gold, color: "#2a2410", borderRadius: 999, padding: "5px 12px", fontSize: 12, fontWeight: 800, whiteSpace: "nowrap" }}>Settle up &#8594;</span>
        </button>
      )}

      <div style={{ marginTop: 20 }}>
        {returnTab && !stage && !viewing && (tab === "players" || tab === "groups") && (
          <div style={{ display: "flex", alignItems: "center", position: "relative", padding: "2px 0 12px", marginBottom: 4, borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
            <button onClick={() => { const t = returnTab; setReturnTab(null); setTab(t); }}
              style={{ display: "flex", alignItems: "center", gap: 3, background: "none", border: "none", color: C.gold, fontSize: 15, fontWeight: 700, cursor: "pointer", padding: "2px 4px" }}>
              <span style={{ fontSize: 20, lineHeight: 1, marginTop: -1 }}>‹</span>{tabTitle(returnTab)}
            </button>
            <div style={{ position: "absolute", left: 0, right: 0, textAlign: "center", color: C.cream, fontSize: 14, fontWeight: 800, pointerEvents: "none" }}>{tabTitle(tab)}</div>
          </div>
        )}
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
        ) : tab === "admin" && (profile?.is_admin || activeGroup?.role === "admin") ? (
          <AdminHome
            user={user}
            profile={profile}
            activeGroupName={activeGroup?.name}
            activeGroupRole={activeGroup?.role}
            onGoto={(t) => { setReturnTab("admin"); setTab(t as Tab); setMoreOpen(false); }}
            onEnterGroup={enterSupportGroup}
            onExitGroup={exitSupportGroup}
            onGroupsChanged={loadGroups}
          />
        ) : tab === "help" ? (
          <HelpPage isAdmin={!!profile?.is_admin} user={user} displayName={displayName} groupId={activeGroupId} />
        ) : tab === "notifications" ? (
          <NotificationsScreen user={user} onNavigate={navigateFromNotif} />
        ) : tab === "profile" ? (
          <ProfilePanel profile={profile} user={user} onSaved={loadProfile} badgeRefresh={badgeSync} rounds={rounds} />
        ) : tab === "teetimes" && activeGroup ? (
          <TeeTimes user={user} activeGroupId={activeGroup.id} activeGroupName={activeGroup.name} canManage={activeGroup.role === "admin"} initialTeeId={deepReady ? deepTeeId : null} onConsumedDeepLink={() => setDeepTeeId(null)} onSpawnGame={(s) => { setOpenGameId(null); setGameSeed(s); setTab("games"); }} onOpenGame={(gid) => { setGameSeed(null); setOpenGameId(gid); setTab("games"); }} />
        ) : tab === "money" && activeGroup ? (
          <MoneyTab user={user} activeGroup={activeGroup} onChanged={loadOwed} initialTab={moneyInitialTab} />
        ) : tab === "games" && activeGroup ? (
          <Tournaments session={session} activeGroupId={activeGroup.id} isAdmin={!!profile?.is_admin} seed={gameSeed} openGameId={openGameId} />
        ) : loading ? (
          <div style={{ color: C.sage, textAlign: "center", padding: 40 }}>Loading your rounds…</div>
        ) : tab === "dashboard" ? (
          <Dashboard rounds={rounds} name={displayName} onOpen={setViewing} currentIndex={index} saveIndex={saveIndex}
            userEmail={user?.email || null} userId={user.id} savedCoach={profile?.dashboard_ai || null} onCoachSaved={loadProfile}
            onViewAchievements={() => { setTab("profile"); setTimeout(() => document.getElementById("achievements-wall")?.scrollIntoView({ behavior: "smooth", block: "start" }), 140); }} />
        ) : (
          <RoundsList rounds={rounds} onOpen={setViewing} />
        )}
      </div>
      </div>
      </PullToRefresh>
      </div>
      {/* Bottom navigation bar — a normal flex child pinned at the bottom by layout (NOT
          position:fixed, which drifts in iOS home-screen PWAs). */}
      <nav data-diag="nav" style={{
        flexShrink: 0, zIndex: 50,
        background: C.green, borderTop: `1px solid ${C.greenMid}`,
        display: "flex", justifyContent: "space-around", alignItems: "stretch",
        paddingBottom: "calc(env(safe-area-inset-bottom) + 8px)",
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
              <span style={{ fontSize: 11, fontWeight: 700 }}>{label}</span>
            </button>
          );
          return (
            <>
              {primary.map((p) =>
                <React.Fragment key={p.key}>
                  {item(tab === p.key && !inFlow, p.icon, p.label, () => { setTab(p.key); setReturnTab(null); setStage(null); setViewing(null); setMoreOpen(false); })}
                </React.Fragment>
              )}
              {item(moreOpen || (["players","groups","admin","help","profile","money","teetimes","notifications"].includes(tab) && !inFlow), "⋯", "More", () => setMoreOpen((v) => !v))}
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
                { key: "teetimes", label: "Tee Times", show: !!activeGroup && activeGroupId === TGC_GROUP_ID },
                { key: "players", label: "Players", show: true },
                { key: "groups", label: "Clubs", show: showGroupsTab },
                { key: "admin", label: "Admin ★", show: !!profile?.is_admin || activeGroup?.role === "admin" },
                { key: "help", label: "Help", show: true },
                { key: "profile", label: "Profile", show: true },
                { key: "notifications", label: "Notifications", show: true },
              ];
              return more.filter((m) => m.show).map((m) => (
                <button key={m.key} onClick={() => { setTab(m.key); setReturnTab(null); setStage(null); setViewing(null); setMoreOpen(false); }}
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
    const { error } = await supabase.from("profiles").update({ display_name: titleCaseName(name.trim()) }).eq("id", user.id);
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
