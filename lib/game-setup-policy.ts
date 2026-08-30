import { shapeOf, type GameType } from "./game-shape";
import type { Game, Player } from "./game-types";

export type SetupDecision =
  | { decision: "allow" }
  | { decision: "confirm"; title: string; message: string }
  | { decision: "block"; reason: string };

export type SetupAction =
  | { type: "rename_game" }
  | { type: "share_live" }
  | { type: "set_game_date" }
  | { type: "change_course" }
  | { type: "add_player"; guest?: boolean }
  | { type: "remove_player"; player: Player }
  | { type: "toggle_no_show"; player: Player; next: boolean }
  | { type: "set_handicap"; player: Player }
  | { type: "set_tee"; player: Player; teeName: string }
  | { type: "set_team"; player: Player; team: string | null }
  | { type: "set_tee_group"; player: Player; group: number | null }
  | { type: "randomize_groups" }
  | { type: "set_format"; target: GameType }
  | { type: "set_match_length"; length: "18" | "front9" | "back9" }
  | { type: "set_allowance"; pct: number }
  | { type: "set_team_score_mode"; mode: "best_ball" | "aggregate" }
  | { type: "set_skins_mode"; mode: "carryover" | "split" }
  | { type: "set_skins_style"; style: "individual" | "team_11" | "team_2v2" }
  | { type: "set_match_team"; on: boolean }
  | { type: "set_trifecta_scoring"; mode: "per_hole" | "match" }
  | { type: "set_leg_config" }
  | { type: "set_pairings" }
  | { type: "set_foursomes" };

export type SetupPolicyContext = {
  game: Game;
  players: Player[];
  action: SetupAction;
};

export const playerHasScores = (p: Player): boolean => (p.scores || []).some((s) => s != null);
export const gameHasScores = (players: Player[]): boolean => players.some(playerHasScores);

const allow = (): SetupDecision => ({ decision: "allow" });
const requireConfirm = (title: string, message: string): SetupDecision => ({ decision: "confirm", title, message });
const block = (reason: string): SetupDecision => ({ decision: "block", reason });

const endedBlock = (): SetupDecision => block("This game has ended. Reopen it before editing this setting.");

const individualReinterpretation = (game: Game, target: GameType): boolean => {
  const current = shapeOf(game).view;
  const targetShape = shapeOf({ ...game, game_type: target }).view;
  const individual = new Set(["stableford", "stroke", "skins_individual"]);
  return individual.has(current) && individual.has(targetShape);
};

const sameFoursomeFamily = (game: Game, target: GameType): boolean => {
  const current = shapeOf(game).view;
  const targetShape = shapeOf({ ...game, game_type: target }).view;
  const family = new Set(["fourball", "trifecta"]);
  return family.has(current) && family.has(targetShape) && Array.isArray(game.foursomes) && game.foursomes.length > 0;
};

export function decideSetupChange({ game, players, action }: SetupPolicyContext): SetupDecision {
  const altSideScoresStarted = game.game_type === "alt_shot" && !!game.alt_shot_scoring_started_at;
  const anyScores = gameHasScores(players) || altSideScoresStarted;

  // Metadata/visibility remain safe even after the competition has ended.
  if (action.type === "rename_game" || action.type === "share_live") return allow();

  if (action.type === "set_game_date") {
    if (!anyScores) return allow();
    return requireConfirm(
      "Change the game date?",
      "Scores already exist. This moves the game date and any posted player rounds together; scores and results do not change.",
    );
  }

  if (game.status === "ended") return endedBlock();

  if (action.type === "change_course") {
    return anyScores ? block("The course is locked once scoring begins.") : allow();
  }

  // Same rule as the course, for the same concrete reason: scores are stored positionally against
  // holes_meta, so shortening an 18-hole game to a nine after someone has played the 12th would
  // orphan those entries. Not a tidiness judgement — the data would be wrong.
  if (action.type === "set_match_length") {
    return anyScores ? block("The number of holes is locked once scoring begins.") : allow();
  }

  switch (action.type) {
    case "add_player": {
      if (!anyScores) return allow();
      const view = shapeOf(game).view;
      if (view === "stableford" || view === "stroke" || view === "skins_individual") {
        return requireConfirm(
          action.guest ? "Add this guest mid-round?" : "Add this player mid-round?",
          "Scoring is already underway. The new player starts with no historical holes; existing scorecards and standings are kept.",
        );
      }
      return block("Players cannot be added after scoring starts in a match or team contest because that would change the competitive structure.");
    }
    case "remove_player": {
      if (altSideScoresStarted) return block("Players are frozen once Alternate Shot side scoring begins. Reset scores before changing the sides.");
      if (playerHasScores(action.player)) {
        return block(`${action.player.display_name} already has scores. Mark them No-show / Out instead so their played holes stay in the game.`);
      }
      return requireConfirm(
        `Remove ${action.player.display_name}?`,
        "This removes the player from the game and clears their team, matchup and group placement. They have no recorded scores.",
      );
    }
    case "toggle_no_show": {
      if (!anyScores) return allow();
      const effect =
        game.game_type === "fourball" || game.game_type === "trifecta"
          ? "Unplayed holes score net double bogey for their team."
          : game.game_type === "match"
          ? "Their match stands on the holes already played."
          : "Their unplayed holes score nothing.";
      return requireConfirm(
        action.next ? `Mark ${action.player.display_name} out?` : `Return ${action.player.display_name} to play?`,
        action.next
          ? `Played holes remain. ${effect}`
          : "This changes how the current format treats this player from this point forward; existing raw scores remain unchanged.",
      );
    }
    case "set_handicap": {
      if (!playerHasScores(action.player) && !altSideScoresStarted) return allow();
      return requireConfirm(
        `Correct ${action.player.display_name}'s handicap?`,
        "This recalculates received strokes and net results for the entire game, including holes already scored. Gross scores are not changed.",
      );
    }
    case "set_tee": {
      if (!playerHasScores(action.player) && !altSideScoresStarted) return allow();
      return requireConfirm(
        `Correct ${action.player.display_name}'s tee to ${action.teeName}?`,
        `This treats ${action.player.display_name}'s entire round as having been played from ${action.teeName} and recalculates rating, slope, course handicap and net results. Gross scores are not changed. Do not use this if the player physically changed tees during the round.`,
      );
    }
    case "set_team": {
      if (altSideScoresStarted) return block("Teams are frozen once Alternate Shot side scoring begins. Reset scores before changing the sides.");
      if (playerHasScores(action.player)) {
        return block(`${action.player.display_name} already has scores. Team membership is frozen once that player's scoring begins.`);
      }
      return allow();
    }
    case "set_tee_group": {
      if (altSideScoresStarted) return block("Groups are frozen once Alternate Shot side scoring begins. Reset scores before moving players.");
      if (playerHasScores(action.player) || action.player.group_locked) {
        return block(`${action.player.display_name}'s tee group is frozen because scoring has started for that player/group.`);
      }
      const targetLocked = action.group != null && players.some((p) => p.tee_group === action.group && p.group_locked);
      if (targetLocked) return block(`Group ${action.group} has already been finished/locked. Add the player to an active group instead.`);
      if (anyScores) {
        return requireConfirm(
          `Move ${action.player.display_name} to ${action.group == null ? "no tee group" : `Group ${action.group}`}?`,
          "Scoring is already underway. This is allowed only because this player has no scores and the target group is still active.",
        );
      }
      return allow();
    }
    case "randomize_groups": {
      if (players.some((p) => p.group_locked)) return block("A tee group has already been finished/locked. Groups are frozen for the round.");
      if (anyScores) return block("Scores are already in. Tee groups are frozen for the round.");
      return allow();
    }
    case "set_format": {
      if (action.target === game.game_type) return allow();
      if (!anyScores) return allow();
      if (individualReinterpretation(game, action.target)) {
        return requireConfirm(
          `Change format to ${action.target}?`,
          "Existing gross scorecards are kept. Standings and results will be recalculated using the new individual format, and the handicap allowance moves to that format's default.",
        );
      }
      if (sameFoursomeFamily(game, action.target)) {
        return requireConfirm(
          `Change format to ${action.target}?`,
          "The existing foursomes and gross scorecards are kept. Team results will be recalculated using the new scoring format.",
        );
      }
      // Naming the way out matters: in a team format a hole's score belongs to a PAIR (best ball
      // or aggregate), so reinterpreting those same numbers as individual Stableford would
      // silently change what each entry meant when it was typed. Refusing is right — but the user
      // still has two legitimate routes, and the message used to mention neither.
      return block(
        `Can't switch to ${action.target} once scoring has started.\n\n` +
        "This game is a team format, where a hole's score belongs to a pair rather than to one " +
        "player. Reading those same scores as an individual format would change what they meant " +
        "when they were entered.\n\n" +
        "You can either:\n" +
        "  • clear every score in this game, then change the format, or\n" +
        "  • leave this game as it is and create a new one in the format you want.\n\n" +
        "Formats within the same family can still be changed — team formats to other team " +
        "formats, individual to other individual."
      );
    }
    case "set_allowance": {
      if (!anyScores) return allow();
      return requireConfirm(
        `Change the handicap allowance to ${action.pct}%?`,
        "This recalculates received strokes and net standings for holes already scored. Gross scores are not changed.",
      );
    }
    case "set_team_score_mode": {
      if (!anyScores) return allow();
      return requireConfirm(
        "Change team scoring?",
        "Teams, foursomes and gross scorecards stay the same, but team standings will be recalculated under the new scoring rule.",
      );
    }
    case "set_skins_mode": {
      if (!anyScores) return allow();
      return requireConfirm(
        "Change skins tie handling?",
        "Existing scorecards stay the same, but skins already played will be recalculated using the new tie rule.",
      );
    }
    case "set_skins_style": {
      const current = shapeOf(game).skinsStyle ?? "individual";
      if (current === action.style || !anyScores) return allow();
      return block("Skins structure is frozen once scoring starts. Individual, 1:1 team and 2v2 team skins cannot be converted into one another mid-round.");
    }
    case "set_match_team": {
      const current = shapeOf(game).usesTeams;
      if (current === action.on || !anyScores) return allow();
      return block("Match structure is frozen once scoring starts. An individual match cannot become a team match, or vice versa, mid-round.");
    }
    case "set_trifecta_scoring": {
      if (!anyScores) return allow();
      return requireConfirm(
        "Change Trifecta scoring?",
        "The same foursomes and gross scorecards are kept, but points already played will be recalculated under the new Trifecta scoring rule.",
      );
    }
    case "set_leg_config": {
      if (!anyScores) return allow();
      return requireConfirm(
        "Change side-game leg settings?",
        "Existing scorecards stay the same, but leg and side-game standings will be recalculated using the new settings.",
      );
    }
    case "set_pairings": {
      if (!anyScores) return allow();
      return block("Matchups are frozen once scoring starts. Existing scores must stay attached to the opponents they were played against.");
    }
    case "set_foursomes": {
      if (!anyScores) return allow();
      return block("Foursomes are frozen once scoring starts. Existing scores must stay attached to the teams and foursomes that played them.");
    }
  }
}
