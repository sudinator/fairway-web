"use client";
import { useEffect } from "react";
import { registerAutomaticUpdates } from "@/lib/automatic-updates";
// Installing a worker does not restart this document. A fresh open/refresh uses
// the active worker's network-first navigation and restores existing score drafts.
export function RegisterSW() {
  useEffect(() => registerAutomaticUpdates(), []);
  return null;
}
