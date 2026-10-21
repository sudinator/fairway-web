"use client";
// Setup → Teams for a scramble (211.1, owner-approved mock): balanced teams of the chosen size, each with its team
// handicap breakdown (lib/scramble — the USGA allowances), and a "Move to…" per player. Saving also puts each
// group's players in one tee group, so scoring permissions and markers work as for alternate shot.
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { btn } from "@/components/ui";
import { chBasis, pkey } from "@/lib/game-shape";
import { scrambleTeamHandicap } from "@/lib/scramble";
import { balanceScrambleTeams, scrambleSetupProblem, scrambleTeamsOf, type ScrambleGroup } from "@/lib/scramble-teams";
import type { Game, Player } from "@/lib/game-types";

export function ScrambleTeamsBuilder({ game, players, readOnly, onSave }: {
  game: Game; players: Player[]; readOnly: boolean; onSave: (groups: ScrambleGroup[]) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const g = game as Game & { scramble_team_size?: number | null; scramble_mode?: string | null; scramble_handicap?: string | null };
  const size = (g.scramble_team_size ?? 4) as 2 | 3 | 4;
  const mode = g.scramble_mode === "match" ? "match" : "field";
  const gross = g.scramble_handicap === "gross";
  const nh = Array.isArray(game.holes_meta) ? game.holes_meta.length : 18;
  const live = players.filter((p) => !p.no_show);
  const byKey = new Map(live.map((p) => [pkey(p), p]));
  const ch = (p: Player) => Number(chBasis(p, game.course_par, nh >= 18 ? undefined : nh) ?? 0);
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  const teams = scrambleTeamsOf(groups);
  const problem = scrambleSetupProblem(groups, live.map(pkey), mode);

  const save = async (next: ScrambleGroup[]) => { setBusy(true); try { await onSave(next); } finally { setBusy(false); } };
  const balance = () => {
    const next = balanceScrambleTeams(live.map((p) => ({ key: pkey(p), ch: ch(p) })), size, mode);
    if (next) void save(next);
  };
  const move = (key: string, toTeam: number) => {
    const target = teams[toTeam];
    if (!target) return;
    const next = groups.map((gr) => ({ ...gr, a: gr.a.filter((k) => k !== key), b: gr.b.filter((k) => k !== key) }));
    const dest = next.find((gr) => gr.id === target.groupId)!;
    dest[target.side] = [...dest[target.side], key];
    void save(next);
  };

  return (
    <div data-scramble-teams>
      <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.45 }}>
        Teams of {size} · {mode === "match" ? "team v team" : "one leaderboard"} · {gross ? "gross — no handicap strokes" : "USGA scramble allowance"}.
      </div>
      {!readOnly ? (
        <button disabled={busy || live.length < 2} onClick={balance} style={{ ...btn(!groups.length), width: "100%", marginTop: 10, fontSize: 13, opacity: busy ? 0.6 : 1 }}>
          {groups.length ? "Rebalance the teams" : "Make balanced teams"}
        </button>
      ) : null}
      {problem ? <div data-scramble-problem style={{ color: C.gold, fontSize: 12.5, marginTop: 10 }}>{problem}</div> : null}
      {teams.map((t, ti) => {
        const members = t.members.map((k) => byKey.get(k)).filter((p): p is Player => !!p);
        const th = scrambleTeamHandicap(members.map(ch), gross);
        const match = mode === "match" && t.side === "a" ? groups.find((gr) => gr.id === t.groupId) : null;
        return (
          <React.Fragment key={`${t.groupId}-${t.side}`}>
            {match ? <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 14 }}>{match.name.toUpperCase()}</div> : null}
            <div data-scramble-team={t.name} style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{t.name}</span>
                <span style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>{th ? `Team handicap ${th.total}` : "2 to 4 players"}</span>
              </div>
              {members.map((p) => {
                const part = th?.parts.find((x) => members[x.index] === p);
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12.5 }}>
                    <span style={{ flex: 1, color: C.cream }}>{p.display_name}</span>
                    <span style={{ color: C.sage }}>{ch(p).toFixed(1)}{part && !gross ? ` × ${Math.round(part.pct * 100)}% = ${part.counts.toFixed(1)}` : ""}</span>
                    {!readOnly && teams.length > 1 ? (
                      <select aria-label={`Move ${p.display_name}`} disabled={busy} value="" onChange={(e) => move(pkey(p), Number(e.target.value))}
                        style={{ background: C.greenMid, color: C.cream, border: "none", borderRadius: 8, fontSize: 12, padding: "4px 10px" }}>
                        <option value="" disabled>Move to…</option>
                        {teams.map((o, oi) => (oi === ti ? null : <option key={oi} value={oi}>{o.name}</option>))}
                      </select>
                    ) : null}
                  </div>
                );
              })}
              {th && !gross ? <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>{th.raw.toFixed(2)}, rounded to {th.total}</div> : null}
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
