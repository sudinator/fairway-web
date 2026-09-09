/**
 * The public Ryder Cup share page's SCORING, kept out of the page for the same reason
 * lib/live-scoring.ts exists: the page owns its display, not its arithmetic.
 *
 * Every match state comes from `liveLegs`, which CI already holds against the app's own answers
 * (lib/live-parity.diff.test.ts). This module only does what the Cup layer adds on top: turning
 * those match states into points, using exactly the rule in lib/competition.ts —
 *
 *   PROJECTED counts every STARTED match to whoever currently leads (half each if level).
 *   DECIDED counts only matches that have actually settled.
 *
 * Both scaled by the session's points_per_match. The Cup page shows decided as the score and
 * projected as the "if it finished like this" figure, the same way the in-app Cup view does.
 */
import { competitionSchedule, competitionPointsNeeded } from "./competition";
import { liveLegs, type LiveAltShotScore, type LiveLeg, type LiveScoringGame, type LiveScoringMeta, type LiveScoringPlayer } from "./live-scoring";

export type LiveCupSession = {
  id: string;
  name: string;
  format: "fourball" | "alt_shot" | "match" | "trifecta";
  session_order: number;
  play_date: string | null;
  points_per_match: number;
  planned_match_count: number | null;
  /** null when no game is linked yet — the session still shows, as not started. */
  game: (LiveScoringGame & { teams?: { key: string; name: string }[] | null; holes_meta?: LiveScoringMeta[] | null; status?: string | null }) | null;
  players: (LiveScoringPlayer & { display_name?: string | null })[];
  pairings: { a: string | null; b: string | null }[];
  foursomes: { id: string; name: string; swap: boolean; a: (string | null)[]; b: (string | null)[] }[];
  alt_shot_scores?: LiveAltShotScore[];
};

export type LiveCupMatch = {
  key: string;
  leftIds: string[];
  rightIds: string[];
  /** Lead from TEAM A's perspective, whichever side of the foursome A happens to be on. */
  lead: number;
  thru: number;
  settled: boolean;
  result: string;
  started: boolean;
};

export type LiveCupSessionScore = {
  sessionId: string;
  matches: LiveCupMatch[];
  projectedA: number; projectedB: number;
  decidedA: number; decidedB: number;
  matchCount: number; decidedCount: number;
  /** True when the session has no linked game, or a game with no scores anywhere. */
  notStarted: boolean;
};

const teamOf = (id: string | undefined, byId: Record<string, LiveScoringPlayer>) => (id ? byId[id]?.team ?? null : null);

/** Match states for one session, in the Cup's A/B orientation. */
export function liveCupSessionScore(s: LiveCupSession): LiveCupSessionScore {
  const empty: LiveCupSessionScore = {
    sessionId: s.id, matches: [], projectedA: 0, projectedB: 0, decidedA: 0, decidedB: 0,
    matchCount: 0, decidedCount: 0, notStarted: true,
  };
  const meta = s.game?.holes_meta || [];
  if (!s.game || !meta.length) return empty;

  const byId: Record<string, LiveScoringPlayer> = Object.fromEntries(s.players.map((p) => [p.id, p]));
  const legs: LiveLeg[] = liveLegs(
    { game_type: s.game.game_type, allowance_pct: s.game.allowance_pct, team_score_mode: s.game.team_score_mode, course_par: s.game.course_par },
    byId, s.pairings, s.foursomes, meta, s.game.allowance_pct ?? 100, s.alt_shot_scores || [],
  );

  const out: LiveCupSessionScore = { ...empty, matches: [], notStarted: true };
  const scale = s.points_per_match ?? 1;

  for (const leg of legs) {
    // A leg's aIds sit on whichever Cup team that side belongs to. Report the lead from TEAM A's
    // side so sessions combine without the caller tracking orientation per foursome.
    const ta = teamOf(leg.aIds[0], byId), tb = teamOf(leg.bIds[0], byId);
    const reversed = ta === "B" && tb === "A";
    const lead = reversed ? -leg.lead : leg.lead;
    const started = leg.thru > 0;

    out.matchCount++;
    if (leg.settled) out.decidedCount++;
    if (started) {
      out.notStarted = false;
      if (lead === 0) {
        out.projectedA += 0.5 * scale; out.projectedB += 0.5 * scale;
        if (leg.settled) { out.decidedA += 0.5 * scale; out.decidedB += 0.5 * scale; }
      } else {
        const aWins = lead > 0;
        if (aWins) out.projectedA += scale; else out.projectedB += scale;
        if (leg.settled) { if (aWins) out.decidedA += scale; else out.decidedB += scale; }
      }
    }
    out.matches.push({
      key: `${s.id}:${leg.aIds.join("+")}v${leg.bIds.join("+")}`,
      leftIds: reversed ? leg.bIds : leg.aIds,
      rightIds: reversed ? leg.aIds : leg.bIds,
      lead, thru: leg.thru, settled: leg.settled, result: leg.result, started,
    });
  }
  return out;
}

/**
 * The context a viewer needs to follow along: who is playing, how many matches and points exist,
 * and what each team needs. The clinch maths is NOT reimplemented here — it comes from
 * lib/competition.ts (competitionSchedule / competitionPointsNeeded), the same functions the in-app
 * Cup view uses, so the public page cannot drift from it.
 *
 * `planned_match_count × points_per_match` is the authoritative denominator (SCHEMA, 0143): it is
 * known from the moment the schedule is locked, before any child game exists, so the page can say
 * "18 points available" on day one rather than counting up as games appear.
 */
export type LiveCupPlayer = {
  user_id: string; display_name: string; avatar_url?: string | null;
  team_key: "A" | "B"; handicap_index?: number | null;
};

export function liveCupContext(
  sessions: LiveCupSession[],
  tieRule: "shared" | "team_a_retains" | "team_b_retains" = "shared",
  cupPlayers?: LiveCupPlayer[],
) {
  const { scores, total } = liveCupStandings(sessions);
  const schedule = competitionSchedule(
    sessions.map((s) => ({ planned_match_count: s.planned_match_count ?? 0, points_per_match: s.points_per_match })) as never,
    tieRule,
  );
  // Roster comes from the Cup's OWN player list (competition_players), which has one row per person
  // with a fixed A/B team. Deriving it from session player rows counted each human once PER SESSION,
  // because game_players.id differs per session — a 6-a-side Cup read "24 players, 12 v 12" (188.4).
  // The fallback de-duplicates by NAME rather than id, so a payload from before 0152 was amended
  // still reports a sane count instead of a doubled one.
  const roster: { id: string; name: string; team: string | null; handicapIndex: number | null }[] =
    cupPlayers && cupPlayers.length
      ? cupPlayers.map((p) => ({ id: p.user_id, name: p.display_name || "", team: p.team_key ?? null, handicapIndex: p.handicap_index ?? null }))
      : (() => {
          const byName = new Map<string, { id: string; name: string; team: string | null; handicapIndex: number | null }>();
          for (const s of sessions) {
            for (const p of s.players) {
              const name = (p as { display_name?: string | null }).display_name || p.id;
              if (!byName.has(name)) byName.set(name, { id: p.id, name, team: p.team ?? null, handicapIndex: null });
            }
          }
          return Array.from(byName.values());
        })();
  return {
    scores,
    total,
    schedule,
    roster,
    teamA: roster.filter((r) => r.team === "A"),
    teamB: roster.filter((r) => r.team === "B"),
    /** Matches the schedule PLANS, which may exceed those that exist yet. */
    plannedMatches: sessions.reduce((n, s) => n + (s.planned_match_count ?? 0), 0),
    neededA: competitionPointsNeeded(total.decidedA, schedule.teamATarget),
    neededB: competitionPointsNeeded(total.decidedB, schedule.teamBTarget),
    /** Points still to be decided, from the planned denominator. */
    pointsRemaining: Math.max(0, schedule.totalPoints - (total.decidedA + total.decidedB)),
  };
}

/** The Cup total: every session's points added up. */
export function liveCupStandings(sessions: LiveCupSession[]) {
  const scores = sessions.map(liveCupSessionScore);
  const total = scores.reduce(
    (acc, s) => ({
      projectedA: acc.projectedA + s.projectedA, projectedB: acc.projectedB + s.projectedB,
      decidedA: acc.decidedA + s.decidedA, decidedB: acc.decidedB + s.decidedB,
      matchCount: acc.matchCount + s.matchCount, decidedCount: acc.decidedCount + s.decidedCount,
    }),
    { projectedA: 0, projectedB: 0, decidedA: 0, decidedB: 0, matchCount: 0, decidedCount: 0 },
  );
  return { scores, total };
}
