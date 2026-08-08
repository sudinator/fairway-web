// Shared game-domain types, extracted from components/tournaments.tsx so that the
// components split out of that file (and any hooks/repositories) can import a single
// canonical definition instead of re-declaring or depending on the mega-file. Types
// only — no runtime code — so moving them here cannot change behavior.

import type { LegConfig } from "@/lib/legs";

export type Game = {
  id: string;
  group_id?: string | null;
  code: string;
  name: string;
  course: string;
  course_par: number | null;
  holes_meta: { n: number; par: number; si: number | null; yards?: number | null }[]; // par + stroke index (+ yardage) per hole
  game_type: "stableford" | "stroke" | "match" | "fourball" | "skins" | "trifecta";
  stroke_basis?: "gross" | "net" | null; // stroke play: gross or net total
  skins_mode?: "carryover" | "split" | null; // individual skins: carryover (default) or split
  allowance_pct?: number | null; // handicap allowance % applied to net scoring
  marker_user_id?: string | null; // the player currently keeping score for the group
  pairings: { a: string; b: string }[]; // for match play: pkey(player) vs pkey(player)
  status?: "active" | "ended" | null;
  teams?: { key: string; name: string }[] | null; // two named teams for team match play
  foursomes?: { id: string; name: string; a: string[]; b: string[]; swap?: boolean }[] | null; // four-ball / trifecta: pair A vs pair B (swap = cross the singles)
  team_score_mode?: "best_ball" | "aggregate" | null; // trifecta team leg: low net vs both nets added
  leg_config?: LegConfig | null; // "Group results: legs & team points" — organizer-set scheme/metric/per-leg points
  structure_stash?: { teams?: { key: string; name: string }[] | null; foursomes?: { id: string; name: string; a: string[]; b: string[]; swap?: boolean }[] | null; pairings?: { a: string; b: string }[] | null } | null; // last team structure, kept when a format switch hides it so switching back restores it
  trifecta_scoring?: "per_hole" | "match" | null; // trifecta: per-hole points vs Ryder-Cup 1pt-per-match
  share_token?: string | null; // public live-scorecard token (organizer-set); null = not shared
  ended_at?: string | null; // when the game was ended (stamped by trigger); drives the 3-day live window
  created_by: string;
  created_at: string;
};

export type Player = {
  id: string;
  game_id: string;
  user_id: string | null; // null for guest players (no account)
  display_name: string;
  avatar_url?: string | null; // denormalized profile photo (co-players can't read profiles)
  handicap_index: number | null;
  rating: number | null;
  slope: number | null;
  tee_name: string | null;
  course_handicap: number | null;
  scores: (number | null)[]; // strokes per hole
  putts: (number | null)[]; // putts per hole
  fairways: ("hit" | "miss" | "left" | "right" | null)[]; // fairway result per hole (par 4/5)
  penalties?: (number | null)[]; // penalty strokes per hole
  sand?: (boolean | null)[]; // greenside bunker per hole (for sand-save %)
  team?: string | null; // team key ("A"/"B") for team match play
  no_show?: boolean | null; // organizer-flagged no-show (four-ball: scored net double bogey)
  is_guest?: boolean | null; // a guest player added for this game only
  guest_of?: string | null; // sponsoring member's user id (guests only) — keeps guests with their host when grouping
  bets?: boolean | null; // in the TGC money game (default true; guests default false)
  tee_group?: number | null; // which tee group (foursome) this player is in (1,2,3…)
  is_marker?: boolean | null; // keeps score for their tee group
  group_locked?: boolean | null; // this player's tee group has been finished/locked
  clock_start?: string | null; // when this player first entered a score (round clock)
  clock_end?: string | null; // when this player finished the last hole (round clock)
};

// A tee-time handoff seeding a new game (players + guests to prefill in CreateGame).
export type GameSeed = { teeTimeId: string; course: string | null; playDate: string; memberIds: string[]; guests: { name: string; sponsorUserId: string }[] };
