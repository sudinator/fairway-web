"use client";
import { useEffect, useState } from "react";
import { subscribeScoringDevice } from "@/lib/scoring-device";
import { UPDATE_EVENT, updatesBlocked, subscribeUpdateSafety, mountUpdateProtection, protectUpdateSession, updateInProgress } from "@/lib/update-safety";

export function useUpdatesBlocked() {
  const [blocked, setBlocked] = useState(true);
  useEffect(() => {
    const check = () => setBlocked(updatesBlocked());
    const off = subscribeUpdateSafety(check), deviceOff = subscribeScoringDevice(check);
    check();
    window.addEventListener("storage", check); window.addEventListener(UPDATE_EVENT, check);
    const timer = window.setInterval(check, 1000);
    return () => { off(); deviceOff(); clearInterval(timer); window.removeEventListener("storage", check); window.removeEventListener(UPDATE_EVENT, check); };
  }, []);
  return blocked;
}
export function useScoringUpdateProtection(kind: "game" | "round", id: string, blocked: boolean) {
  useEffect(() => {
    protectUpdateSession(kind, id, blocked);
    if (!blocked) return;
    return mountUpdateProtection(`${kind}:${id}`);
    // Unmount releases only the live observer. The durable session deliberately
    // remains until server-confirmed completion/discard, never mere navigation.
  }, [kind, id, blocked]);
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
