// The links the app understands (210.10) — ONE description, used by both ways in: tapping a notification inside
// the app, and opening the app from a phone notification. Notification links written by the database must use
// these (ci/assert-notification-links.sql checks every link the database sends against APP_TABS).
export const APP_TABS = ["dashboard", "rounds", "games", "courses", "players", "groups", "admin", "help", "profile", "money", "teetimes", "notifications"] as const;
export type AppTab = (typeof APP_TABS)[number];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What a link asks for: a tab, a club to select (club=<id>, opens Clubs), a game (6-digit code), a tee time, a Season Wrapped year. */
export function parseAppLink(link: string | null | undefined): { tab: AppTab | null; club: string | null; game: string | null; teeTime: string | null; wrapped: number | null } {
  const q = new URLSearchParams(link && link.includes("?") ? link.slice(link.indexOf("?") + 1) : "");
  const t = q.get("tab"), club = q.get("club"), game = q.get("game"), wy = Number(q.get("wrapped"));
  return {
    tab: t && (APP_TABS as readonly string[]).includes(t) ? (t as AppTab) : club && UUID.test(club) ? "groups" : null,
    club: club && UUID.test(club) ? club : null,
    game: game && /^\d{6}$/.test(game) ? game : null,
    teeTime: q.get("tt"),
    wrapped: wy > 2000 && wy < 3000 ? wy : null,
  };
}
