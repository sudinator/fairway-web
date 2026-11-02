"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SCORE_CORRECTION_EVENT } from "@/lib/score-correction-links";
import { APP_VERSION } from "@/lib/app-version";
import { C } from "@/lib/golf";
import { btn, BottomSheet } from "@/components/ui";
import { useAppUpdate, UpdateBannerView, UpdateBlockerList, visibleUpdateBlockers } from "@/components/app-update-status";
import { applyAppUpdate, checkForUpdate, dismissUpdate, restoreUpdateResult, reportDeferredReload } from "@/lib/app-update";
import { useUpdatesBlocked, useUpdateInputLock, useUpdateBlockers } from "@/components/update-safety";
import { updatesBlocked, reconcileUpdateGames, rememberUpdateGame } from "@/lib/update-safety";
import { updateHandshake } from "@/lib/update-handshake";
import { verifySavedScoresFromServer } from "@/lib/verify-saved-scores-server";
import { createClient } from "@/lib/supabase";

// Registers the service worker AND handles updates.
//
// The old implementation only detected service-worker changes. That misses many
// real app updates because Next.js client bundles can change while sw.js remains
// textually unchanged. This component now checks both:
//   1. a waiting service worker
//   2. /app-version.json, which is generated fresh during every build
export function RegisterSW() {
  const blocked = useUpdatesBlocked();
  useUpdateInputLock();
  const pendingReload = useRef(false);
  const update = useAppUpdate();
  const blockers = useUpdateBlockers();
  const [details, setDetails] = useState(false);
  const versionUpdate = !!update.latest && update.latest !== APP_VERSION;

  // Version numbers are the release contract. A waiting worker by itself is not
  // user-visible because Vercel/rebuilds can produce a worker with the same app version.
  const hasUpdate = versionUpdate && !blocked;

  const checkAppVersion = useCallback(() => checkForUpdate(false), []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    restoreUpdateResult();
    let reg: ServiceWorkerRegistration | null = null;
    let interval: ReturnType<typeof setInterval> | null = null;
    let started = false;

    let reconciling = false;
    const reconcile = async () => {
      if (reconciling) return;
      reconciling = true;
      try { await reconcileUpdateGames(async id => {
        // bounded: one tracked game by primary key; a failed read retains protection.
        const { data, error } = await createClient().from("games").select("status,name,code,group_id,groups(name)").eq("id", id).maybeSingle();
        if (!error && data) rememberUpdateGame(id, { ...data, group_name: (data.groups as any)?.name || null });
        return error ? null : data ? { status: data.status } : { missing: true };
      }, async id => {
        // bounded: display metadata for one already-tracked personal round.
        const { data, error } = await createClient().from("rounds").select("course,played_at,group_id,groups(name)").eq("id", id).maybeSingle();
        return error || !data ? null : { ...data, group_name: (data.groups as any)?.name || null };
      }); } finally { reconciling = false; }
    };
    const runChecks = () => {
      void reconcile();
      void verifySavedScoresFromServer();
      reg?.update().catch(() => {});
      checkAppVersion();
    };

    const start = async () => {
      if (started) return;
      started = true;

      try {
        if ("serviceWorker" in navigator) {
          reg = await navigator.serviceWorker.register("/sw.js");

        }
      } catch {
        // Non-fatal — app still works as a normal site.
      }

      runChecks();
      interval = setInterval(runChecks, 30 * 60 * 1000);
    };

    const onVisible = () => { if (document.visibilityState === "visible") runChecks(); };
    const onPageShow = () => runChecks();
    const onFocus = () => runChecks();

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      reloaded = true;
      if (updatesBlocked()) { pendingReload.current = true; reportDeferredReload(); return; }
      window.location.reload();
    };

    const closeDetails = () => setDetails(false);
    window.addEventListener(SCORE_CORRECTION_EVENT, closeDetails);
    const safetyTimer = window.setInterval(() => { void reconcile(); }, 15000);
    window.addEventListener("load", start);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    window.addEventListener("bnn-check-update-status", runChecks);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    }
    // When a push notification is clicked and an existing tab is focused, the SW asks
    // the page to route to the notification's deep link.
    const handshake = updateHandshake();
    const onSwMessage = (e: MessageEvent) => {
      handshake.receive(e);
      if (e.data && e.data.kind === "notif-nav" && typeof e.data.link === "string") {
        try {
          const url = new URL(e.data.link, window.location.origin);
          if (url.origin === window.location.origin && url.pathname + url.search !== window.location.pathname + window.location.search) {
            window.location.assign(url.pathname + url.search);
          }
        } catch { /* ignore bad link */ }
      }
    };
    if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", onSwMessage);

    if (document.readyState === "complete") start();

    return () => {
      window.removeEventListener(SCORE_CORRECTION_EVENT, closeDetails);
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("bnn-check-update-status", runChecks);
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
        navigator.serviceWorker.removeEventListener("message", onSwMessage);
      }
      if (interval) clearInterval(interval);
      clearInterval(safetyTimer);
      handshake.dispose();
    };
  }, [checkAppVersion]);

  useEffect(() => {
    if (!blocked && pendingReload.current && !updatesBlocked()) { pendingReload.current = false; window.location.reload(); }
  }, [blocked]);

  const shownBlockers = visibleUpdateBlockers(update.blockers, blockers);
  const showNotice = !update.dismissed && !!update.latest && (hasUpdate || ["blocked", "failed", "success"].includes(update.phase));
  return <>
    {showNotice && !details && <UpdateBannerView state={update} onApply={() => { void applyAppUpdate(); }} onDismiss={dismissUpdate} onDetails={() => setDetails(true)} />}
    {details && <BottomSheet onClose={() => setDetails(false)} dismissOnBackdrop={false} header={<div style={{ padding: "13px 16px", color: C.cream, fontSize: 17, fontWeight: 700 }}>App update status</div>}>
      <div style={{ color: C.cream, fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>{update.message || "Your current app stays in use until you choose Update."}</div>
      <UpdateBlockerList blockers={shownBlockers} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
        <button style={btn(false)} onClick={() => { window.dispatchEvent(new Event("bnn-check-update-status")); void checkForUpdate(true); }}>Check again</button>
        <button style={btn(false)} onClick={() => setDetails(false)}>Close details</button>
      </div>
    </BottomSheet>}
  </>;
}
