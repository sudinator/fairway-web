// BASELINE — the game-creation logic exactly as it sat inline in CreateGame's create() before the
// extraction, transcribed from the ORIGINAL source (closure variables became the same option fields
// the new module uses; nothing else changed). Used only by game-create.diff.test.ts.
import { courseHandicap } from "./golf";
import { flightForIndex, type FlightBand } from "./flights";
import { GP_STATE_DEFAULTS } from "./game-utils";
import type { GamePayloadOpts, GameTypeOpt, PlayerRowsOpts } from "./game-create";

export function gameTypeLabel(gameType: GameTypeOpt): string {
  return gameType === "match" ? "Match Play" : gameType === "fourball" ? "Four-Ball" : gameType === "skins" ? "Skins" : gameType === "trifecta" ? "Trifecta" : gameType === "stroke" ? "Stroke Play" : "Stableford";
}

export function buildGamePayload(o: GamePayloadOpts) {
  const typeLabel = o.gameType === "match" ? "Match Play" : o.gameType === "fourball" ? "Four-Ball" : o.gameType === "skins" ? "Skins" : o.gameType === "trifecta" ? "Trifecta" : o.gameType === "stroke" ? "Stroke Play" : "Stableford";
  const dateLabel = new Date(o.matchDate + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  const autoName = `${typeLabel} / ${o.courseName} / ${dateLabel}`;
  const holesMeta = o.courseHoles.map((h: any, i: number) => ({
    n: h.n,
    par: h.par,
    si: h.si,
    yards: o.teeYardages?.[i] ?? null,
  }));
  return {
    code: o.code,
    group_id: o.activeGroupId,
    name: o.name.trim() || autoName,
    course: o.courseName,
    course_par: o.coursePar,
    played_at: o.matchDate,
    allowance_pct: o.allowancePct,
    holes_meta: holesMeta,
    game_type: o.gameType,
    pairings: [],
    teams:
      ((o.gameType === "match" || o.gameType === "skins" || o.gameType === "fourball") && o.teamMode) || o.gameType === "trifecta"
        ? [
            { key: "A", name: o.team1.trim() || "Team 1" },
            { key: "B", name: o.team2.trim() || "Team 2" },
          ]
        : null,
    foursomes: o.gameType === "fourball" || o.gameType === "trifecta" || (o.gameType === "skins" && o.teamMode && o.skinsTeamStyle === "best_ball") ? [] : null,
    team_score_mode: o.gameType === "trifecta" || o.gameType === "fourball" || (o.gameType === "skins" && o.teamMode && o.skinsTeamStyle === "best_ball") ? o.teamScoreMode : "best_ball",
    trifecta_scoring: o.gameType === "trifecta" ? o.trifectaScoring : null,
    stroke_basis: o.gameType === "stroke" ? o.strokeBasis : null,
    skins_mode: o.gameType === "skins" ? o.skinsMode : null,
    flight_mode: o.flightsSupported ? o.flightMode : "off",
    flights: o.flightMode === "oneoff" && o.flightsSupported ? o.flightBands : null,
  };
}

export function splitSkinsTooBig(gameType: GameTypeOpt, teamMode: boolean, skinsMode: string, fieldCount: number): boolean {
  return gameType === "skins" && !teamMode && skinsMode === "split" && fieldCount > 4;
}

export function buildPlayerRows(o: PlayerRowsOpts) {
  const selectedIds = new Set([
    o.userId,
    ...Object.keys(o.selectedPlayers).filter((id) => o.selectedPlayers[id]),
  ]);
  const selectedRoster = o.groupRoster.filter((p) => selectedIds.has(p.id));
  if (!selectedRoster.some((p) => p.id === o.userId)) {
    selectedRoster.unshift({
      id: o.userId,
      display_name: o.displayName,
      avatar_url: null,
      handicap_index: o.idxVal,
    });
  }
  const rosterRows = selectedRoster.map((p) => {
    const playerIndex = p.id === o.userId ? o.idxVal : (o.hcpOverrides[p.id] ?? p.handicap_index);
    const playerCourseHandicap =
      playerIndex != null && o.coursePar != null
        ? courseHandicap(playerIndex, o.tee.slope, o.tee.rating, o.coursePar)
        : null;
    return {
      game_id: o.gameId,
      user_id: p.id,
      is_guest: false,
      bets: true,
      ...GP_STATE_DEFAULTS,
      display_name: p.display_name || "Player",
      avatar_url: (p as any).avatar_url ?? null,
      handicap_index: playerIndex,
      rating: o.tee.rating,
      slope: o.tee.slope,
      tee_name: o.tee.name,
      course_handicap: playerCourseHandicap,
      flight: o.flightMode === "oneoff" && o.flightsSupported && o.flightBands ? flightForIndex(playerIndex, o.flightBands) : null,
      scores: Array(o.holesCount).fill(null),
      putts: Array(o.holesCount).fill(null),
      fairways: Array(o.holesCount).fill(null),
    };
  });
  const guestRows = o.guestPlayers.map((p) => ({
    game_id: o.gameId,
    user_id: null,
    is_guest: true,
    guest_of: p.guest_of || null,
    bets: false,
    ...GP_STATE_DEFAULTS,
    display_name: p.display_name,
    handicap_index: p.handicap_index,
    rating: o.tee.rating,
    slope: o.tee.slope,
    tee_name: o.tee.name,
    course_handicap: p.handicap_index != null && o.coursePar != null ? courseHandicap(p.handicap_index, o.tee.slope, o.tee.rating, o.coursePar) : null,
    flight: o.flightMode === "oneoff" && o.flightsSupported && o.flightBands ? flightForIndex(p.handicap_index, o.flightBands) : null,
    scores: Array(o.holesCount).fill(null),
    putts: Array(o.holesCount).fill(null),
    fairways: Array(o.holesCount).fill(null),
  }));
  const rows = [...rosterRows, ...guestRows];
  if (rows.length <= 4) rows.forEach((r) => { (r as any).tee_group = 1; });
  return rows;
}
