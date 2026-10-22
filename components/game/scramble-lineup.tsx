"use client";
// The scramble line-up (212.4, owner): BY TEAM (and by match for team v team), never by group; each player's own
// handicap shown as the INPUT it is (index → course handicap), and the METHOD that turns those into the team
// handicap — under USGA the actual sum ("3.7 + 2.9 + 2.2 + 2.2 = 11.0 → 11"), under agreed the agreed number.
// ONE component for the public line-up page and the line-up share card, so they can't disagree; and one text form.
import React from "react";
import { C } from "@/lib/golf";
import { chBasis, pkey, scrambleMethodOf } from "@/lib/game-shape";
import { scrambleTeamHandicap, customAllowanceFor, SCRAMBLE_ALLOWANCES } from "@/lib/scramble";
import { scrambleTeamsOf, cupSideNames, type ScrambleGroup } from "@/lib/scramble-teams";
import { SCRAMBLE_METHOD_LABEL } from "@/lib/scramble-method";
import { fmtMatchDate } from "@/lib/lineup-meta";
import type { Game, Player } from "@/lib/game-types";

type Line = { name: string; index: number | null; ch: number; pct: number | null; counts: number | null };
export type LineupTeam = { key: string; name: string; matchName: string | null; lines: Line[]; handicap: number; raw: number | null; method: "usga" | "agreed" | "gross" };

/** The teams, in order, with every input and the working — the data both the card and the text read. */
export function scrambleLineupTeams(game: Game, players: Player[]): LineupTeam[] {
  const method = scrambleMethodOf(game);
  const nh = Array.isArray(game.holes_meta) ? game.holes_meta.length : 18;
  const byKey = new Map(players.filter((p) => !p.no_show).map((p) => [pkey(p), p]));
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  return scrambleTeamsOf(groups, cupSideNames(game)).map((t) => {
    const members = t.members.map((k) => byKey.get(k)).filter((p): p is Player => !!p);
    const chs = members.map((p) => Number(chBasis(p as never, game.course_par, nh >= 18 ? undefined : nh) ?? 0));
    const th = method === "usga" && members.length >= 2 ? scrambleTeamHandicap(chs, false, customAllowanceFor(game.scramble_allowance, members.length)) : null;
    const lines: Line[] = members.map((p, i) => {
      const part = th?.parts.find((x) => x.index === i);
      return { name: p.display_name, index: p.handicap_index ?? null, ch: chs[i], pct: part ? part.pct : null, counts: part ? part.counts : null };
    });
    // USGA lines read lowest course handicap first — the order the percentages apply in
    if (th) lines.sort((x, y) => x.ch - y.ch);
    const handicap = method === "gross" ? 0 : method === "agreed" ? (t.hcp ?? 0) : th?.total ?? 0;
    const g = groups.find((x) => x.id === t.groupId);
    return { key: `${t.groupId}:${t.side}`, name: t.name, matchName: game.scramble_mode === "match" && t.side === "a" ? g?.name ?? null : null, lines, handicap, raw: th ? th.raw : null, method };
  });
}

/** The method in one plain sentence, with the percentages actually used for the team sizes in this game. */
export function scrambleLineupMethod(game: Game, teams: LineupTeam[]): string {
  const method = scrambleMethodOf(game);
  if (method === "gross") return "No handicaps — everyone plays scratch; lowest team score wins.";
  if (method === "agreed") return "Agreed handicaps — each team's handicap was agreed by the players and entered by the organizer (blank = scratch). Players' own course handicaps are shown for reference.";
  const sizes = Array.from(new Set(teams.map((t) => t.lines.length).filter((n) => n >= 2 && n <= 4))).sort();
  const pcts = sizes.map((n) => {
    const custom = customAllowanceFor(game.scramble_allowance, n);
    const p = (custom ?? SCRAMBLE_ALLOWANCES[n as 2 | 3 | 4]).map((x) => Math.round(x * 100));
    return `teams of ${n}: ${p.join(" / ")}%${custom ? " (this game's)" : ""}`;
  });
  return `USGA allowance — each player's course handicap × a percentage, lowest handicap first (${pcts.join("; ")}), added up and rounded to the team handicap. Strokes are taken hole by hole, hardest holes first.`;
}

const f1 = (n: number) => n.toFixed(1);

/** The card body (the share card puts it inside its image frame; the public page inside its page shell). */
export function ScrambleLineupCard({ game, players, title }: { game: Game; players: Player[]; title?: React.ReactNode }) {
  const teams = scrambleLineupTeams(game, players);
  const method = scrambleMethodOf(game);
  const captains = game.scramble_team_size === 1;
  return (
    <div data-scramble-lineup>
      <div style={{ textAlign: "center", marginBottom: 10 }}>
        <div style={{ color: C.gold, fontSize: 11, letterSpacing: 2.4, fontWeight: 700 }}>LINE-UP · SCRAMBLE</div>
        {title ?? <div style={{ color: C.cream, fontSize: 19, fontWeight: 800, fontFamily: "Georgia, serif", marginTop: 3 }}>{game.name || "Game"}</div>}
        <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{[game.course, fmtMatchDate(String((game as { played_at?: string }).played_at || "").slice(0, 10))].filter(Boolean).join(" · ")}</div>
        <div style={{ color: C.cream, fontSize: 12.5, fontWeight: 700, marginTop: 8 }}>
          {captains ? "Captains only · " : ""}{game.scramble_mode === "match" ? "Team v team" : "One leaderboard"} · {SCRAMBLE_METHOD_LABEL[method]}
        </div>
        <div data-lineup-method style={{ color: C.sage, fontSize: 11.5, lineHeight: 1.45, marginTop: 4 }}>{scrambleLineupMethod(game, teams)}</div>
      </div>
      {!teams.length ? <div style={{ color: C.sage, textAlign: "center" }}>The teams haven&apos;t been made yet.</div> : null}
      {teams.map((t) => (
        <React.Fragment key={t.key}>
          {t.matchName ? <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.6, fontWeight: 800, marginTop: 12 }}>{t.matchName.toUpperCase()}</div> : null}
          <div data-lineup-team style={{ borderRadius: 10, overflow: "hidden", marginTop: 8, border: `1px solid ${C.borderGreen}` }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: C.greenMid, padding: "8px 12px" }}>
              <span style={{ color: C.cream, fontSize: 15, fontWeight: 800 }}>{t.name}</span>
              <span data-team-hcp style={{ color: C.gold, fontSize: 13, fontWeight: 800 }}>
                Team handicap <span style={{ color: C.cream, fontSize: 20, fontFamily: "Georgia, serif" }}>{method === "gross" ? "—" : t.handicap}</span>
              </span>
            </div>
            <div style={{ padding: "8px 12px" }}>
              {/* 212.16: aligned columns under a heading row (it was one long run of text per player) */}
              {(() => {
                const usga = t.lines.some((l) => l.pct != null);
                const cols = usga ? "minmax(0, 1fr) 44px 52px 40px 44px" : "minmax(0, 1fr) 52px 60px";
                const num: React.CSSProperties = { textAlign: "right" };
                return (
                  <>
                    <div style={{ display: "grid", gridTemplateColumns: cols, gap: 6, color: C.sage, fontSize: 11, fontWeight: 700, marginTop: 4 }}>
                      <span /><span style={num}>Index</span><span style={num}>Course</span>{usga ? <><span style={num}>%</span><span style={num}>Counts</span></> : null}
                    </div>
                    {t.lines.map((l, i) => (
                      <div key={i} style={{ display: "grid", gridTemplateColumns: cols, gap: 6, fontSize: 13, marginTop: 4, alignItems: "baseline" }}>
                        <span style={{ color: C.cream, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}{captains ? " · captain" : ""}</span>
                        <span style={{ ...num, color: C.sage }}>{l.index != null ? f1(l.index) : "–"}</span>
                        <span style={{ ...num, color: C.cream }}>{f1(l.ch)}</span>
                        {usga ? <><span style={{ ...num, color: C.sage }}>{l.pct != null ? `${Math.round(l.pct * 100)}%` : ""}</span><span style={{ ...num, color: C.cream, fontWeight: 700 }}>{l.counts != null ? f1(l.counts) : ""}</span></> : null}
                      </div>
                    ))}
                  </>
                );
              })()}
              {t.raw != null ? (
                <div style={{ color: C.sage, fontSize: 11.5, marginTop: 6, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 6 }}>
                  {t.lines.map((l) => f1(l.counts ?? 0)).join(" + ")} = {t.raw.toFixed(2)} → <b style={{ color: C.cream }}>{t.handicap}</b>
                </div>
              ) : method === "agreed" ? (
                <div style={{ color: C.sage, fontSize: 11.5, marginTop: 6, borderTop: `1px solid ${C.borderGreen}`, paddingTop: 6 }}>Agreed team handicap: <b style={{ color: C.cream }}>{t.handicap}</b></div>
              ) : null}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/** The same line-up as text (Copy as text). */
export function scrambleLineupText(game: Game, players: Player[]): string {
  const teams = scrambleLineupTeams(game, players);
  const out = [`LINE-UP · SCRAMBLE — ${game.name || "Game"}`, scrambleLineupMethod(game, teams), ""];
  for (const t of teams) {
    if (t.matchName) out.push(t.matchName);
    out.push(`${t.name} — team handicap ${t.method === "gross" ? "—" : t.handicap}`);
    for (const l of t.lines) out.push(`  ${l.name}: ${l.index != null ? `index ${f1(l.index)} → ` : ""}course hcp ${f1(l.ch)}${l.pct != null && l.counts != null ? ` × ${Math.round(l.pct * 100)}% = ${f1(l.counts)}` : ""}`);
    if (t.raw != null) out.push(`  ${t.lines.map((l) => f1(l.counts ?? 0)).join(" + ")} = ${t.raw.toFixed(2)} → ${t.handicap}`);
    out.push("");
  }
  return out.join("\n").trim();
}
