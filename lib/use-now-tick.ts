"use client";

import { useEffect, useState } from "react";

/**
 * Reactive wall-clock value for UI that must visibly advance while no other app
 * state changes. Do not use this for persistence/audit timestamps; it exists only
 * to keep elapsed-time displays fresh.
 */
export function useNowTick(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // Refresh immediately when the interval configuration changes, then keep the
    // display moving without requiring score/network activity to re-render it.
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);

  return now;
}
