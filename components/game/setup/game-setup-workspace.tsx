"use client";

import React from "react";
import { ShareLineupModal } from "@/components/share-card";
import { buildSetupSummary } from "@/lib/setup-summary";
import { C } from "@/lib/golf";
import { pkey, shapeOf } from "@/lib/game-shape";
import type { Game, Player } from "@/lib/game-types";
import { courseLabel, type Course } from "@/lib/courses";
import { ShareControl } from "@/components/game/scorecard-views";
import { OrganizerPanel, type OrganizerPanelProps } from "@/components/game/organizer-panel";
import { GroupsBuilder } from "@/components/game/scorecard-views";
import { btn, inputStyle, ShortDateInput } from "@/components/ui";

export type SetupTab = "overview" | "details" | "players" | "format" | "teams" | "matchups" | "groups" | "review";

export type GameSetupWorkspaceProps = {
  game: Game;
  players: Player[];
  setupTab: SetupTab;
  onSetupTabChange: (tab: SetupTab) => void;
  organizerPanelProps: OrganizerPanelProps;
  onSetGameDate: (date: string) => Promise<void>;
  courseOptions: Course[];
  onChangeCourse: (course: Course) => Promise<void>;
  onSetTeeGroup: (p: Player, group: number | null) => Promise<void>;
  getTeeGroupPolicy: (p: Player, group: number | null) => { blocked: boolean; reason?: string };
  onRandomizeGroups: () => Promise<void>;
  canRandomize: boolean;
  randomizeReason: string;
  randomizing: boolean;
  groupOverflow: string[];
};

const cardStyle: React.CSSProperties = {
  background: C.greenLight,
  borderRadius: 12,
  padding: "12px 13px",
  border: `1px solid ${C.borderGreen}`,
};

export function GameSetupWorkspace({
  game,
  players,
  setupTab,
  onSetupTabChange,
  organizerPanelProps,
  onSetGameDate,
  courseOptions,
  onChangeCourse,
  onSetTeeGroup,
  getTeeGroupPolicy,
  onRandomizeGroups,
  canRandomize,
  randomizeReason,
  randomizing,
  groupOverflow,
}: GameSetupWorkspaceProps) {
  // Whether the line-up card is open. Local: presentation, not setup state.
  const [showLineup, setShowLineup] = React.useState(false);
  const { usesTeams, usesMatchups, usesFoursomes } = shapeOf(game);
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
  const playersDone = total > 0 && cWithHcp === total;
  const teamsDone = !usesTeams || (total > 0 && cWithTeam === total);
  const matchupsDone = !usesMatchups || (total > 0 && cPlaced === total);
  const groupsDone = usesFoursomes || (total > 0 && cGrouped === total);
  const structureDone = teamsDone && matchupsDone && groupsDone;
  const allDone = playersDone && structureDone;
  const anyScores = players.some((p) => (p.scores || []).some((s) => s != null));

  const section = setupTab === "teams" || setupTab === "matchups" || setupTab === "groups" ? "structure" : setupTab;
  const structureDefault: SetupTab = usesTeams ? "teams" : usesMatchups ? "matchups" : "groups";
  const gotoStructure = () => onSetupTabChange(structureDefault);

  const [nameEdit, setNameEdit] = React.useState(game.name);
  const [dateEdit, setDateEdit] = React.useState(String((game as any).played_at || "").slice(0, 10));
  const [dateBusy, setDateBusy] = React.useState(false);
  const [courseBusy, setCourseBusy] = React.useState(false);
  React.useEffect(() => setNameEdit(game.name), [game.name]);
  React.useEffect(() => setDateEdit(String((game as any).played_at || "").slice(0, 10)), [(game as any).played_at]);

  const stepDefs = [
    { key: "details", label: "Game", done: !!game.name && !!game.course },
    { key: "players", label: "Players", done: playersDone },
    { key: "format", label: "Format", done: !!game.game_type },
    { key: "structure", label: "Teams", done: structureDone },
    { key: "review", label: "Review", done: allDone },
  ] as const;

  const openSection = (key: typeof stepDefs[number]["key"]) => {
    if (key === "structure") gotoStructure();
    else onSetupTabChange(key);
  };

  const structureSummary = usesTeams
    ? `${cWithTeam}/${total} team assignments · ${cGrouped}/${total} grouped`
    : usesMatchups
      ? `${cPlaced}/${total} matched · ${cGrouped}/${total} grouped`
      : `${cGrouped}/${total} grouped`;

  const summary = [
    { key: "details" as const, title: "Game", sub: `${game.course}${(game as any).played_at ? ` · ${String((game as any).played_at).slice(0, 10)}` : ""}`, done: true },
    { key: "players" as const, title: "Players", sub: `${total} player${total === 1 ? "" : "s"} · ${cWithHcp}/${total} handicaps set`, done: playersDone },
    { key: "format" as const, title: "Format", sub: `${game.game_type.replace("fourball", "Four-ball")} · ${game.allowance_pct ?? 100}%`, done: true },
    { key: "structure" as const, title: "Teams & groups", sub: structureSummary, done: structureDone },
    { key: "review" as const, title: "Review", sub: allDone ? "Setup looks good" : "Setup items remain", done: allDone },
  ];

  if (section === "overview") {
    return (
      <div style={{ marginTop: 16 }}>
        <div style={{ ...cardStyle, padding: 14, marginBottom: 10 }}>
          <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 800 }}>{game.name}</div>
          <div style={{ color: C.sage, fontSize: 12, marginTop: 3 }}>{game.course} · {game.game_type === "fourball" ? "Four-ball" : game.game_type}</div>
          <span style={{ display: "inline-block", marginTop: 7, padding: "3px 9px", borderRadius: 999, background: anyScores ? "#5BD08A" : C.gold, color: anyScores ? "#0E241B" : "#23303A", fontSize: 11, fontWeight: 800 }}>
            {game.status === "ended" ? "FINAL" : anyScores ? "SCORING" : "SETUP"}
          </span>
        </div>
        {summary.map((s) => (
          <button key={s.key} onClick={() => openSection(s.key)} style={{ ...cardStyle, width: "100%", marginBottom: 8, color: C.cream, textAlign: "left", cursor: "pointer", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: "Georgia, serif", fontSize: 15, fontWeight: 800 }}>{s.title}</div>
              <div style={{ color: C.sage, fontSize: 11.5, marginTop: 2 }}>{s.sub}</div>
            </div>
            <div style={{ width: 24, height: 24, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", background: s.done ? "#5BD08A" : C.gold, color: "#0E241B", fontWeight: 800, fontSize: 13 }}>{s.done ? "✓" : "!"}</div>
            <span style={{ color: C.sage, fontSize: 18 }}>›</span>
          </button>
        ))}
        <button style={{ ...btn(true), width: "100%", marginTop: 4 }} onClick={() => onSetupTabChange("review")}>{anyScores ? "Review game setup" : "Review & start"}</button>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button style={{ ...btn(false), padding: "7px 10px", fontSize: 12 }} onClick={() => onSetupTabChange("overview")}>‹ Control center</button>
        <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontWeight: 800, fontSize: 17 }}>
          {section === "details" ? "Game" : section === "players" ? "Players" : section === "format" ? "Format" : section === "structure" ? "Teams & groups" : "Review"}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", gap: 3, marginBottom: 12 }}>
        {stepDefs.map((s, i) => {
          const active = section === s.key;
          return (
            <button key={s.key} onClick={() => openSection(s.key)} style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "center" }}>
              <div style={{ width: active ? 30 : 26, height: active ? 30 : 26, lineHeight: active ? "30px" : "26px", margin: "0 auto", borderRadius: 999, fontWeight: 800, fontSize: 12, background: s.done ? "#5BD08A" : active ? C.gold : "transparent", color: s.done ? "#0E241B" : active ? "#23303A" : C.sage, border: s.done || active ? "none" : "1px solid rgba(255,255,255,.25)", boxShadow: active ? `0 0 0 3px ${C.gold}` : "none" }}>{s.done ? "✓" : i + 1}</div>
              <div style={{ color: active ? C.cream : C.sage, fontSize: 11, marginTop: 3, fontWeight: active ? 700 : 400 }}>{s.label}</div>
            </button>
          );
        })}
      </div>

      {section === "details" && (
        <div>
          <div style={cardStyle}>
            <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>GAME INFORMATION</div>
            <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 12 }}>GAME NAME</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
              <input value={nameEdit} onChange={(e) => setNameEdit(e.target.value)} style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
              <button style={{ ...btn(false), opacity: nameEdit.trim() && nameEdit.trim() !== game.name ? 1 : .5 }} disabled={!nameEdit.trim() || nameEdit.trim() === game.name} onClick={() => organizerPanelProps.onRename(nameEdit.trim())}>Save name</button>
            </div>

            <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 14 }}>COURSE</div>
            <div style={{ ...inputStyle, marginTop: 6 }}>{game.course}</div>
            {anyScores || game.status === "ended" ? (
              <div style={{ color: C.sage, fontSize: 11, marginTop: 5 }}>{game.status === "ended" ? "The course cannot be changed on an ended game." : "Course is locked once scoring begins."}</div>
            ) : (
              <>
                <select
                  defaultValue=""
                  disabled={courseBusy || courseOptions.length === 0}
                  onChange={async (e) => {
                    const c = courseOptions.find((x) => x.id === e.target.value);
                    e.currentTarget.value = "";
                    if (!c || c.name === game.course) return;
                    setCourseBusy(true);
                    try { await onChangeCourse(c); } finally { setCourseBusy(false); }
                  }}
                  style={{ ...inputStyle, marginTop: 7, width: "100%" }}
                >
                  <option value="">{courseBusy ? "Changing course…" : "Change course…"}</option>
                  {courseOptions.filter((c) => c.name !== game.course).map((c) => <option key={c.id} value={c.id}>{courseLabel(c)}</option>)}
                </select>
                <div style={{ color: C.sage, fontSize: 11, marginTop: 5 }}>Available only before scoring. Changing course clears every player's tee so the correct new rating and slope can be selected.</div>
              </>
            )}

            <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 14 }}>PLAY DATE</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
              <ShortDateInput value={dateEdit} onChange={setDateEdit} />
              <button disabled={!dateEdit || dateBusy || dateEdit === String((game as any).played_at || "").slice(0,10)} onClick={async () => { setDateBusy(true); try { await onSetGameDate(dateEdit); } finally { setDateBusy(false); } }} style={{ ...btn(false), opacity: dateEdit && dateEdit !== String((game as any).played_at || "").slice(0,10) ? 1 : .5 }}>{dateBusy ? "Saving…" : "Save date"}</button>
            </div>
          </div>

          <div style={{ ...cardStyle, marginTop: 10 }}>
            <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>SHARING</div>
            <ShareControl game={game} onShare={organizerPanelProps.onShare} />
          </div>

          <div style={{ ...cardStyle, marginTop: 10 }}>
            <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>GAME STATUS</div>
            <div style={{ color: C.cream, fontSize: 13, marginTop: 8 }}>{game.status === "ended" ? "Final results are locked." : anyScores ? "Scoring is in progress." : "Game is active and ready for scoring."}</div>
            {game.status === "ended" ? (
              <button style={{ ...btn(false), marginTop: 10 }} onClick={organizerPanelProps.onReopen}>↺ Reopen game</button>
            ) : (
              <button style={{ ...btn(true), marginTop: 10 }} onClick={organizerPanelProps.onEnd}>🏁 End game (lock final results)</button>
            )}
          </div>

          <div style={{ ...cardStyle, marginTop: 10, border: "1px solid rgba(214,96,83,.55)" }}>
            <div style={{ color: "#F0B0A8", fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>DESTRUCTIVE ACTIONS</div>
            <div style={{ color: "#F0B0A8", fontSize: 11.5, fontWeight: 700, marginTop: 6 }}>These actions cannot be undone.</div>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 10 }}>Reset clears all scoring and clocks but keeps players and game structure.</div>
            <button style={{ background: "#3F3414", color: "#E4CF86", border: `0.5px solid ${C.gold}`, borderRadius: 8, padding: "9px 14px", fontWeight: 700, cursor: "pointer", marginTop: 8, fontSize: 13, display: "block" }} onClick={organizerPanelProps.onReset}>↺ Reset scores</button>
            <div style={{ color: C.sage, fontSize: 11, marginTop: 12 }}>Delete permanently removes this game.</div>
            <button style={{ background: C.danger, color: "#F6DEDB", border: "none", borderRadius: 8, padding: "9px 14px", fontWeight: 700, cursor: "pointer", marginTop: 8, fontSize: 13, display: "block" }} onClick={organizerPanelProps.onDelete}>Delete this game</button>
          </div>
        </div>
      )}

      {section === "players" && <OrganizerPanel section="players" {...organizerPanelProps} />}
      {section === "format" && <OrganizerPanel section="format" {...organizerPanelProps} />}

      {section === "structure" && (
        <>
          <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
            {usesTeams && <button onClick={() => onSetupTabChange("teams")} style={{ ...btn(setupTab === "teams"), flex: 1, fontSize: 12 }}>Teams</button>}
            {usesMatchups && <button onClick={() => onSetupTabChange("matchups")} style={{ ...btn(setupTab === "matchups"), flex: 1, fontSize: 12 }}>Matchups</button>}
            {!usesFoursomes && <button onClick={() => onSetupTabChange("groups")} style={{ ...btn(setupTab === "groups"), flex: 1, fontSize: 12 }}>Tee groups</button>}
          </div>
          {setupTab === "teams" && <OrganizerPanel section="teams" {...organizerPanelProps} />}
          {setupTab === "groups" && <GroupsBuilder game={game} players={players} onSetTeeGroup={onSetTeeGroup} getTeeGroupPolicy={getTeeGroupPolicy} onRandomize={onRandomizeGroups} canRandomize={canRandomize} randomizeReason={randomizeReason} randomizing={randomizing} overflowIds={groupOverflow} />}
          {setupTab === "matchups" && <div style={{ ...cardStyle, color: C.sage, fontSize: 12 }}>Build and review matchups below. The existing matchup editor is unchanged.</div>}
        </>
      )}

      {section === "review" && (
        <div>
          {/* The roster, as a shareable card. Opens the same modal the scorecard share uses, so
              the image, the Web Share sheet and the copy-as-text path are all one implementation. */}
          <div style={{ ...cardStyle, marginBottom: 10 }}>
            <div style={{ color: C.cream, fontWeight: 800, fontSize: 14, marginBottom: 4 }}>Share the line-up</div>
            <div style={{ color: C.sage, fontSize: 11.5, marginBottom: 8 }}>
              Post this to your group chat so everyone can check their handicap, tee and team before you start.
            </div>
            <button onClick={() => setShowLineup(true)} style={{ ...btn(true), width: "100%", fontSize: 13 }}>
              View line-up card
            </button>
          </div>
          <div style={cardStyle}>
            {[
              [playersDone, "All players have tees and handicaps set"],
              [teamsDone, usesTeams ? "Team assignments are complete" : "Teams are not required"],
              [matchupsDone, usesMatchups ? "Matchups are complete" : "Matchups are not required"],
              [groupsDone, usesFoursomes ? "Foursomes define the playing groups" : "Tee groups are set"],
            ].map(([ok, text], i) => <div key={i} style={{ display: "flex", gap: 9, alignItems: "center", padding: "8px 0", borderBottom: i < 3 ? "1px solid rgba(255,255,255,.08)" : "none", color: C.cream, fontSize: 12.5 }}><span style={{ color: ok ? "#5BD08A" : C.gold, fontWeight: 800 }}>{ok ? "✓" : "!"}</span><span>{text}</span></div>)}
          </div>
          <div style={{ background: allDone ? "rgba(91,208,138,.12)" : "rgba(201,162,39,.12)", border: `1px solid ${allDone ? "#5BD08A" : C.gold}`, borderRadius: 12, padding: 12, marginTop: 10, color: C.cream, fontSize: 12.5, lineHeight: 1.45 }}>
            {allDone ? "Setup looks good. Return to the scorecard when you are ready to play." : "Setup is still usable — complete the highlighted items or return to any section to make changes."}
          </div>
        </div>
      )}
      {showLineup ? (
        <ShareLineupModal game={game} players={players} onClose={() => setShowLineup(false)} />
      ) : null}
    </div>
  );
}
