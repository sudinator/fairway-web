"use client";
import { useEffect, useSyncExternalStore } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { checkScoringDevice, downloadScoringRecovery, scoringDeviceState, scoringDeviceError, subscribeScoringDevice } from "@/lib/scoring-device";
const client = createClient();
export function useScoringDevice() {
  return useSyncExternalStore(subscribeScoringDevice, scoringDeviceState, () => "checking" as const);
}
export function usePrimaryScoringDevice(userId: string) {
  const state = useScoringDevice();
  useEffect(() => {
    const check = () => { void checkScoringDevice(client, userId); };
    check();
    const visible = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("online", check); window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(check, 20000);
    return () => { window.clearInterval(timer); window.removeEventListener("online", check); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", visible); };
  }, [userId]);
  return state;
}
export function ScoringDeviceNotice({ userId }: { userId: string }) {
  const state = useScoringDevice();
  const error = useSyncExternalStore(subscribeScoringDevice, scoringDeviceError, () => "");
  if (state === "primary" && !error) return null;
  return <div style={{ background: C.greenLight, color: C.cream, padding: 12, borderRadius: 12, marginBottom: 12, fontSize: 13, lineHeight: 1.5 }}>
    {error && <div style={{ color: C.gold, marginBottom: 6 }}>{error}</div>}
    {state === "primary" ? "This is your primary scoring device. Local scores remain saved while the connection recovers." : state === "checking" ? "Checking your primary scoring device. You can view scores while we connect." : "Scoring is active on your primary device. You can view here, or make this device primary to take over personal rounds and games."}
    {state === "viewer" && <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
      <button style={btn(true)} onClick={() => {
        if (navigator.onLine === false) { alert("Connect to the internet to change your primary device."); return; }
        if (confirm("Make this device primary? Your other device will stop syncing scores. Any unsynced scores remain saved there. This device will start from the latest server scores; its older local scores will be archived for download.")) void checkScoringDevice(client, userId, true);
      }}>Make this device primary</button>
      <button style={btn(false)} onClick={downloadScoringRecovery}>Download saved scores</button>
    </div>}
  </div>;
}
