"use client";
import { useEffect, useState, useMemo } from "react";
import { subscribeScoringDevice } from "@/lib/scoring-device";
import { UPDATE_EVENT, updatesBlocked, subscribeUpdateSafety, mountUpdateProtection, protectUpdateSession, updateInProgress, updateBlockers, type UpdateBlocker } from "@/lib/update-safety";

export function useUpdateBlockers(): UpdateBlocker[] {
  const [serialized, setSerialized] = useState(JSON.stringify([{ key: "checking", title: "Checking saved rounds", action: "Wait for the app to check your saved scores." }]));
  useEffect(() => {
    const check = () => setSerialized(JSON.stringify(updateBlockers()));
    const off = subscribeUpdateSafety(check), deviceOff = subscribeScoringDevice(check);
    check();
    window.addEventListener("storage", check); window.addEventListener(UPDATE_EVENT, check);
    const timer = window.setInterval(check, 1000);
    return () => { off(); deviceOff(); clearInterval(timer); window.removeEventListener("storage", check); window.removeEventListener(UPDATE_EVENT, check); };
  }, []);
  return useMemo(() => JSON.parse(serialized), [serialized]);
}
export function useUpdatesBlocked() { return useUpdateBlockers().length > 0; }

export function useScoringUpdateProtection(kind: "game" | "round", id: string, blocked: boolean, label?: string, code?: string) {
  useEffect(() => {
    protectUpdateSession(kind, id, blocked, label, code);
    if (!blocked) return;
    return mountUpdateProtection(`${kind}:${id}`);
    // Unmount releases only the live observer. The durable session deliberately
    // remains until server-confirmed completion/discard, never mere navigation.
  }, [kind, id, blocked, label, code]);
}
// Freeze input only during the short, explicitly requested activation handshake.
// This closes the ready-ack -> new-score race across tabs without touching saves.
export function useUpdateInputLock() {
  useEffect(() => {
    const stop = (e: Event) => { if (updateInProgress()) { e.preventDefault(); e.stopImmediatePropagation(); } };
    const events = ["pointerdown", "click", "keydown", "beforeinput", "input", "change", "submit"];
    events.forEach(name => window.addEventListener(name, stop, true));
    return () => events.forEach(name => window.removeEventListener(name, stop, true));
  }, []);
}
