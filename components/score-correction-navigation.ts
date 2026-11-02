"use client";
import { useEffect, useRef } from "react";
import { SCORE_CORRECTION_EVENT, parseScoreCorrection, type ScoreCorrectionTarget } from "@/lib/score-correction-links";
import type { Round } from "@/lib/golf";
export type CorrectionNavigation = {
  ready: boolean;
  userId: string;
  groups: { id: string }[];
  readGame: (id: string) => Promise<{ id: string; group_id: string | null } | null>;
  readRound: (id: string) => Promise<Round | null>;
  selectClub: (id: string) => void;
  openGame: (id: string) => void;
  openRound: (round: Round) => void;
  reportError: (message: string) => void;
};
export function useScoreCorrectionNavigation(options: CorrectionNavigation) {
  const latest = useRef(options), revision = useRef(0);
  useEffect(() => { latest.current = options; });
  useEffect(() => {
    if (!options.ready) return;
    let live = true;
    const open = async (target: ScoreCorrectionTarget) => {
      const current = ++revision.current, start = latest.current;
      try {
        const item = target.kind === "game" ? await start.readGame(target.id) : await start.readRound(target.id);
        if (!live || current !== revision.current || latest.current.userId !== start.userId) return;
        if (!item) throw new Error("This saved item could not be opened. Reconnect and verify access to its club. Scores have not been changed.");
        const gid = item.group_id;
        if (target.kind === "game" && !gid) throw new Error("This game’s club could not be determined. Reconnect and verify again; saved scores are unchanged.");
        if (gid && !latest.current.groups.some(g => g.id === gid)) throw new Error("You do not currently have access to this club. Ask its organizer to restore access; saved scores are unchanged.");
        if (gid) latest.current.selectClub(gid);
        if (target.kind === "game") latest.current.openGame(item.id);
        else latest.current.openRound(item as Round);
      } catch (error) {
        if (live && current === revision.current) latest.current.reportError(error instanceof Error ? error.message : "Could not open this saved item. Your scores are unchanged.");
      }
    };
    const receive = (event: Event) => {
      const target = (event as CustomEvent<ScoreCorrectionTarget>).detail;
      if (!target || !["game", "round"].includes(target.kind) || typeof target.id !== "string") return;
      event.preventDefault(); void open(target);
    };
    window.addEventListener(SCORE_CORRECTION_EVENT, receive);
    const target = parseScoreCorrection(window.location.search);
    if (target) {
      const url = new URL(window.location.href); url.searchParams.delete("scoreGame"); url.searchParams.delete("scoreRound");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
      void open(target);
    }
    return () => { live = false; ++revision.current; window.removeEventListener(SCORE_CORRECTION_EVENT, receive); };
  }, [options.ready, options.userId]);
}
