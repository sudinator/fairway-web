"use client";

import React from "react";
import { C } from "@/lib/golf";
import { pkey, shapeOf } from "@/lib/game-shape";
import type { Game, Player } from "@/lib/game-types";
import { OrganizerPanel, type OrganizerPanelProps } from "@/components/game/organizer-panel";
import { GroupsBuilder } from "@/components/game/scorecard-views";

export type SetupTab = "players" | "teams" | "matchups" | "groups";

export type GameSetupWorkspaceProps = {
  game: Game;
  players: Player[];
  setupTab: SetupTab;
  onSetupTabChange: (tab: SetupTab) => void;
  organizerPanelProps: OrganizerPanelProps;
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
  onRandomizeGroups: () => Promise<void>;
  canRandomize: boolean;
  randomizeReason: string;
  randomizing: boolean;
  groupOverflow: string[];
};

export function GameSetupWorkspace({
  game,
  players,
  setupTab,
  onSetupTabChange,
  organizerPanelProps,
  onSetTeeGroup,
  onRandomizeGroups,
  canRandomize,
  randomizeReason,
  randomizing,
  groupOverflow,
}: GameSetupWorkspaceProps) {
  // Gate setup steps by the CURRENT format (via shapeOf). Stale teams/foursomes
  // from a previous format are ignored without being deleted — switching back
  // restores the work.
  const { usesTeams, usesMatchups, usesFoursomes } = shapeOf(game);
  const steps: { key: SetupTab; label: string }[] = [
    { key: "players", label: "Players" },
    ...(usesTeams ? [{ key: "teams" as const, label: "Teams" }] : []),
    ...(usesMatchups ? [{ key: "matchups" as const, label: "Matchups" }] : []),
    ...(!usesFoursomes ? [{ key: "groups" as const, label: "Groups" }] : []),
  ];
  const activeStep = steps.some((s) => s.key === setupTab) ? setupTab : "players";

  // --- per-step completion drives the stepper status + the "what's next" line ---
  const total = players.length;
  const pairings = Array.isArray(game.pairings) ? game.pairings : [];
  const foursomes = Array.isArray(game.foursomes) ? game.foursomes : [];
  const placedKeys = new Set<string>([
    ...pairings.flatMap((pr) => [pr.a, pr.b]),
    ...foursomes.flatMap((f) => [...f.a, ...f.b]),
  ]);
  const cWithHcp = players.filter((p) => p.course_handicap != null).length;
  const cWithTeam = players.filter((p) => p.team).length;
  const cPlaced = players.filter((p) => placedKeys.has(pkey(p))).length;
  const cGrouped = players.filter((p) => p.tee_group != null).length;
  const stepDone = (key: string) =>
    total > 0 && (
      key === "players" ? cWithHcp === total
      : key === "teams" ? cWithTeam === total
      : key === "matchups" ? cPlaced === total
      : key === "groups" ? cGrouped === total
      : false);
  const allDone = steps.every((s) => stepDone(s.key));
  const isStableford = game.game_type === "stableford" || game.game_type === "stroke";
  const hint = (() => {
    if (activeStep === "players")
      return isStableford
        ? "Add players, or share the code so they can join anytime — even across tee times. Stableford rolls everyone into one leaderboard."
        : "Add everyone here before matchups — players don't have to join themselves (you can still share the code so they self-score).";
    if (activeStep === "teams")
      return cWithTeam < total ? "Tap a team on each player. Both teams need players before matchups." : "Teams set — next, build the matchups.";
    if (activeStep === "matchups") {
      if (usesTeams && cWithTeam === 0) return "Assign players to teams first — open the Teams step, then come back.";
      return usesFoursomes
        ? "Build each foursome — it doubles as its own tee group, so one person can keep that foursome's card on the course."
        : "Set who plays whom, then group the matches that tee off together on the next step.";
    }
    if (usesMatchups && pairings.length === 0 && foursomes.length === 0)
      return "Build the matchups first, then group the ones that tee off together here.";
    return isStableford
      ? "Split players into the groups that tee off together so one person can keep each group's card."
      : "Group the matches that tee off together — usually two per foursome.";
  })();

  return (
    <div style={{ marginTop: 16 }}>
      {/* Stepper: navigation and progress in one control */}
      <div style={{ display: "flex", alignItems: "center" }}>
        {steps.map((s, i) => {
          const done = stepDone(s.key);
          const active = activeStep === s.key;
          return (
            <div key={s.key} style={{ flex: 1, display: "flex", alignItems: "center" }}>
              {i > 0 && <div style={{ flex: "0 0 12px", height: 1, background: "rgba(255,255,255,0.18)" }} />}
              <button onClick={() => onSetupTabChange(s.key)} style={{ flex: 1, background: "none", border: "none", cursor: "pointer", padding: 0, textAlign: "center" }}>
                <div style={{
                  width: active ? 30 : 26, height: active ? 30 : 26, lineHeight: active ? "30px" : "26px",
                  margin: "0 auto", borderRadius: 999, fontWeight: 800, fontSize: 13,
                  background: done ? "#5BD08A" : active ? C.gold : "transparent",
                  color: done ? "#0E241B" : active ? "#23303A" : C.sage,
                  border: done || active ? "none" : "1px solid rgba(255,255,255,0.25)",
                  boxShadow: active ? "0 0 0 3px rgba(216,178,74,0.25)" : "none",
                }}>{done ? "✓" : i + 1}</div>
                <div style={{ color: active ? C.cream : C.sage, fontSize: 11, marginTop: 3, fontWeight: active ? 700 : 400 }}>{s.label}</div>
              </button>
            </div>
          );
        })}
      </div>
      <div style={{ background: allDone ? C.green : "#16302A", borderRadius: 8, padding: "9px 11px", marginTop: 12, color: allDone ? C.cream : C.gold, fontSize: 12, lineHeight: 1.45 }}>
        {allDone ? "✓ Everyone's set — switch to Scorecard to start the round." : hint}
      </div>

      {activeStep === "players" && <OrganizerPanel section="players" {...organizerPanelProps} />}
      {activeStep === "teams" && <OrganizerPanel section="teams" {...organizerPanelProps} />}
      {activeStep === "groups" && (
        <GroupsBuilder game={game} players={players} onSetTeeGroup={onSetTeeGroup}
          onRandomize={onRandomizeGroups} canRandomize={canRandomize} randomizeReason={randomizeReason}
          randomizing={randomizing} overflowIds={groupOverflow} />
      )}
    </div>
  );
}
