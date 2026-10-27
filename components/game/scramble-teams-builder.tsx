"use client";
// Setup → Teams for a scramble (211.1; 212.11 owner layout). ONE column with every player — name, course handicap, and
// a team selector on the right (No team · Team 1 … · New team; full teams can't be picked) — and a summary of the teams
// below: players, and the team handicap by the game's method (USGA: the working; agreed: a box). Empty teams disappear
// when their last player moves. "Make balanced teams of 2 / 3 / 4" is a shortcut. Captains only: each player is their
// own team. (A Ryder Cup scramble builds its matches in Setup → Groups — 212.5.) Saving also sets tee groups.
import React, { useState } from "react";
import { sortByName } from "@/lib/names";
import { C } from "@/lib/golf";
import { btn, inputStyle } from "@/components/ui";
import { chBasis, pkey, scrambleMethodOf } from "@/lib/game-shape";
import { scrambleTeamHandicap, customAllowanceFor } from "@/lib/scramble";
import { balanceScrambleTeams, scrambleSetupProblem, scrambleTeeGroups, SCRAMBLE_GROUP_MAX, type ScrambleGroup } from "@/lib/scramble-teams";
import { SCRAMBLE_METHOD_LABEL, scrambleMethodText } from "@/lib/scramble-method";
import type { Game, Player } from "@/lib/game-types";

type Slot = { groupId: string; side: "a" | "b"; name: string; members: string[]; hcp: number | null; matchName: string | null };

/** Every team slot in order (team v team: both sides of every match). */
function slotsOf(groups: ScrambleGroup[], mode: "field" | "match"): Slot[] {
  const out: Slot[] = [];
  let n = 0;
  for (const g of groups) for (const side of mode === "match" ? (["a", "b"] as const) : (["a"] as const)) {
    n++;
    const h = g[side === "a" ? "a_hcp" : "b_hcp"];
    out.push({ groupId: g.id, side, name: `Team ${n}`, members: (g[side] || []) as string[], hcp: typeof h === "number" ? h : null, matchName: mode === "match" && side === "a" ? g.name : null });
  }
  return out;
}

export function ScrambleTeamsBuilder({ game, players, readOnly, onSave }: {
  game: Game; players: Player[]; readOnly: boolean; onSave: (groups: ScrambleGroup[]) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const captains = game.scramble_team_size === 1;
  const maxPer = captains ? 1 : 4;
  const mode = game.scramble_mode === "match" ? "match" : "field";
  const method = scrambleMethodOf(game);
  const nh = Array.isArray(game.holes_meta) ? game.holes_meta.length : 18;
  const live = players.filter((p) => !p.no_show);
  // 212.33 (owner, staging game 386503): no-shows keep their team place, so they are SHOWN — listed below the players
  // and marked inside their team. They used to be hidden while still counted: a team "had a player" but showed none.
  const out = players.filter((p) => p.no_show);
  const byKey = new Map(players.map((p) => [pkey(p), p]));
  const ch = (p: Player) => Number(chBasis(p, game.course_par, nh >= 18 ? undefined : nh) ?? 0);
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  const slots = slotsOf(groups, mode);
  const slotOf = (key: string) => slots.findIndex((t) => t.members.includes(key));
  const problem = scrambleSetupProblem(groups, live.map(pkey), mode, { size: captains ? 1 : null, method, noShows: out.map((p) => ({ key: pkey(p), name: p.display_name })) });
  const sizes = slots.filter((t) => t.members.length).map((t) => t.members.length);
  const mixed = !captains && new Set(sizes).size > 1;

  const save = async (next: ScrambleGroup[]) => { setBusy(true); try { await onSave(next); } finally { setBusy(false); } };
  // empty teams disappear (a match only when both sides are empty)
  const tidy = (gs: ScrambleGroup[]) => gs.filter((g) => g.a.length || g.b.length);
  const newGroup = (n: number): ScrambleGroup => (mode === "match" ? { id: `match-${Date.now()}-${n}`, name: `Match ${n}`, a: [], b: [] } : { id: `team-${Date.now()}-${n}`, name: `Team ${n}`, a: [], b: [] });
  /** place a player: "" = no team, "new" = a new team, else a slot index */
  const place = (key: string, choice: string) => {
    let next = groups.map((g) => ({ ...g, a: g.a.filter((k) => k !== key), b: g.b.filter((k) => k !== key) }));
    if (choice === "new") {
      const open = mode === "match" ? next.find((g) => g.a.length && !g.b.length) : null;   // fill a match's empty side first
      if (open) open.b = [key];
      else { const g = newGroup(next.length + 1); g.a = [key]; next = [...next, g]; }
    } else if (choice !== "") {
      const t = slots[Number(choice)];
      const dest = next.find((g) => g.id === t?.groupId);
      if (dest && t) dest[t.side] = [...dest[t.side], key];
    }
    void save(tidy(next));
  };
  const balance = (n: 1 | 2 | 3 | 4) => { const next = balanceScrambleTeams(live.map((p) => ({ key: pkey(p), ch: ch(p) })), n, mode); if (next) void save(next); };
  // 212.34 (owner): GROUPS ON THE COURSE — small teams (2 players, or captains) can share a tee group, so one scorer
  // keeps one card for every team in it. Shown from the players' SAVED tee groups (what scoring uses); a change pins
  // every team's group (foursomes[].tee) so later team edits keep the plan; lib/scramble-teams applies the rules.
  const teams = mode === "field" ? groups.filter((g) => g.a.length + g.b.length > 0) : [];
  const showGroups = teams.length >= 2 && teams.some((g) => g.a.length + g.b.length <= 2);
  const plan = scrambleTeeGroups(groups, mode, captains);
  const groupOf = (g: ScrambleGroup) => {
    const saved = [...g.a, ...g.b].map((k) => byKey.get(k)?.tee_group).filter((x): x is number => typeof x === "number");
    return saved.length ? Math.min(...saved) : plan.get(g.id) ?? 1;
  };
  const teamSize = (g: ScrambleGroup) => g.a.length + g.b.length;
  const current = new Map(teams.map((g) => [g.id, groupOf(g)]));
  const groupNos = Array.from(new Set(current.values())).sort((x, y) => x - y);
  const loadOf = (n: number) => teams.filter((g) => current.get(g.id) === n).reduce((t, g) => t + teamSize(g), 0);
  const moveTeam = (groupId: string, choice: string) => {
    const target = choice === "new" ? Math.max(0, ...groupNos) + 1 : Number(choice);
    void save(groups.map((g) => ({ ...g, tee: g.id === groupId ? target : current.get(g.id) ?? g.tee ?? null })));
  };
  const setHcp = (groupId: string, side: "a" | "b", raw: string) => {
    const v = raw.trim() === "" ? null : Math.round(Number(raw));
    if (v != null && (!Number.isFinite(v) || v < -10 || v > 60)) return;
    void save(groups.map((gr) => (gr.id === groupId ? { ...gr, [side === "a" ? "a_hcp" : "b_hcp"]: v } : gr)));
  };

  return (
    <div data-scramble-teams>
      <div style={{ color: C.cream, fontSize: 12.5, fontWeight: 700 }}>
        {captains ? "Captains only" : "Teams of 2 to 4"} · {mode === "match" ? "team v team" : "one leaderboard"} · {SCRAMBLE_METHOD_LABEL[method]}
      </div>
      {/* 212.16: one line; the full explanation on a tap (it pushed every control down five lines) */}
      <details data-scramble-method style={{ color: C.sage, fontSize: 12, lineHeight: 1.45, marginTop: 4 }}>
        <summary style={{ cursor: "pointer" }}>{captains ? "Each captain enters their team's score — teammates play outside the app." : method === "agreed" ? "Enter each team's agreed handicap below." : "Team handicaps are worked out from the players' course handicaps."} <span style={{ color: C.gold }}>How?</span></summary>
        <div style={{ marginTop: 4 }}>{scrambleMethodText(method, captains ? 1 : 4)}</div>
      </details>

      {!readOnly ? (captains ? (
        <button disabled={busy || !live.length} onClick={() => balance(1)} style={{ ...btn(!groups.length), width: "100%", marginTop: 10, fontSize: 13 }}>{groups.length ? "Remake: a team for each captain" : "A team for each captain"}</button>
      ) : (
        <>
          <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 12 }}>{groups.length ? "REBALANCE AS TEAMS OF" : "MAKE BALANCED TEAMS OF"}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {([2, 3, 4] as const).map((n) => <button key={n} disabled={busy || live.length < 2} onClick={() => balance(n)} style={{ ...btn(false), flex: 1, fontSize: 13 }}>{n} players</button>)}
          </div>
          <div style={{ color: C.sage, fontSize: 11.5, marginTop: 6 }}>…or choose each player&apos;s team below.</div>
        </>
      )) : null}
      {problem ? <div data-scramble-problem style={{ color: C.gold, fontSize: 12.5, marginTop: 10 }}>{problem}</div> : null}

      {/* PLAYERS — one column, a team selector on the right */}
      <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 14 }}>PLAYERS</div>
      <div data-scramble-players style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 6 }}>
        {sortByName(live).map((p, i) => {   /* 212.48: alphabetical by first name */
          const k = pkey(p), at = slotOf(k);
          return (
            <div key={p.id} data-scramble-player={p.display_name} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: i ? 8 : 0, paddingTop: i ? 8 : 0, borderTop: i ? `1px solid ${C.borderGreen}` : "none" }}>
              <span style={{ flex: 1, minWidth: 0, color: C.cream, fontSize: 13.5, fontWeight: 700 }}>
                {p.display_name}<span style={{ display: "block", color: C.sage, fontSize: 11, fontWeight: 500 }}>course hcp {ch(p).toFixed(1)}</span>
              </span>
              {readOnly ? <span style={{ color: C.cream, fontSize: 13 }}>{at >= 0 ? slots[at].name : "No team"}</span> : (
                <select aria-label={`Team for ${p.display_name}`} disabled={busy} value={at >= 0 ? String(at) : ""} onChange={(e) => place(k, e.target.value)}
                  style={{ ...inputStyle, width: 150, flexShrink: 0, padding: "8px 12px", fontSize: 13 }}>
                  <option value="">No team</option>
                  {slots.map((t, si) => (si !== at && t.members.length >= maxPer ? null
                    : <option key={si} value={si}>{t.name}{t.matchName ? ` (${t.matchName})` : ""}{si !== at && t.members.length ? ` · ${t.members.length} player${t.members.length === 1 ? "" : "s"}` : ""}</option>))}
                  {at === -1 || slots[at]?.members.length > 1 ? <option value="new">New team</option> : null}
                </select>
              )}
            </div>
          );
        })}
        {/* 212.33: no-shows — not playing; one tap takes them off their team (they can't be put on one) */}
        {out.map((p) => {
          const k = pkey(p), at = slotOf(k);
          return (
            <div key={p.id} data-scramble-noshow={p.display_name} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, paddingTop: 8, borderTop: `1px solid ${C.borderGreen}` }}>
              <span style={{ flex: 1, minWidth: 0, color: C.sage, fontSize: 13.5, fontWeight: 700 }}>
                {p.display_name}<span style={{ display: "block", color: C.gold, fontSize: 11, fontWeight: 700 }}>No-show{at >= 0 ? ` · still on ${slots[at].name}` : ""}</span>
              </span>
              {readOnly || at < 0 ? <span style={{ color: C.sage, fontSize: 13 }}>{at >= 0 ? slots[at].name : "No team"}</span> : (
                <select aria-label={`Team for ${p.display_name}`} disabled={busy} value={String(at)} onChange={(e) => place(k, e.target.value)}
                  style={{ ...inputStyle, width: 150, flexShrink: 0, padding: "8px 12px", fontSize: 13 }}>
                  <option value={String(at)}>{slots[at].name}</option>
                  <option value="">No team</option>
                </select>
              )}
            </div>
          );
        })}
      </div>

      {/* SUMMARY — the teams, below */}
      {slots.some((t) => t.members.length) ? <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 16 }}>TEAMS</div> : null}
      {mixed ? <div data-scramble-mixed style={{ color: C.sage, fontSize: 11.5, marginTop: 4 }}>Teams of different sizes ({slots.filter((t) => t.members.length).map((t) => `${t.name}: ${t.members.length}`).join(", ")}) — each uses the percentages for its own size.</div> : null}
      {slots.map((t) => {
        if (!t.members.length) return null;
        const members = t.members.map((k) => byKey.get(k)).filter((p): p is Player => !!p);
        const th = method === "usga" && members.length >= 2 && members.length <= 4 ? scrambleTeamHandicap(members.map(ch), false, customAllowanceFor(game.scramble_allowance, members.length)) : null;
        const shown = method === "gross" ? "Gross" : method === "agreed" ? (t.hcp != null ? `Team handicap ${t.hcp}` : "Scratch (no handicap entered)") : th ? `Team handicap ${th.total}` : "2 to 4 players";
        return (
          <React.Fragment key={`${t.groupId}-${t.side}`}>
            {t.matchName ? <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 12 }}>{t.matchName.toUpperCase()}</div> : null}
            <div data-scramble-team={t.name} style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{t.name}{!captains ? <span style={{ color: C.sage, fontWeight: 500, fontSize: 12 }}> · {members.length} player{members.length === 1 ? "" : "s"}{members.length >= maxPer ? " (full)" : ""}</span> : null}</span>
                {method === "agreed" && !readOnly ? null : <span style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>{shown}</span>}
              </div>
              {members.map((p, i) => {
                const part = th?.parts.find((x) => x.index === i);
                return (
                  <div key={p.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 4, fontSize: 12.5 }}>
                    <span style={{ color: C.cream }}>{p.display_name}{captains ? " · captain" : ""}{p.no_show ? <span style={{ color: C.gold, fontWeight: 700 }}> · no-show</span> : null}</span>
                    <span style={{ color: C.sage }}>{ch(p).toFixed(1)}{part ? ` × ${Math.round(part.pct * 100)}% = ${part.counts.toFixed(1)}` : ""}</span>
                  </div>
                );
              })}
              {th ? <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>{th.raw.toFixed(2)}, rounded to {th.total}</div> : null}
              {method === "agreed" && !readOnly ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: C.sage }}>
                  Agreed team handicap
                  <input aria-label={`${t.name} team handicap`} inputMode="numeric" defaultValue={t.hcp ?? ""} key={`${t.groupId}-${t.side}-${t.hcp ?? ""}`} placeholder="scratch" disabled={busy}
                    onBlur={(e) => { const raw = e.currentTarget.value; if ((raw.trim() === "" ? null : Math.round(Number(raw))) !== t.hcp) setHcp(t.groupId, t.side, raw); }}
                    style={{ ...inputStyle, width: 110 }} />
                </label>
              ) : null}
            </div>
          </React.Fragment>
        );
      })}

      {showGroups ? (
        <div data-scramble-groups>
          <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 16 }}>GROUPS ON THE COURSE</div>
          <div style={{ color: C.sage, fontSize: 11.5, marginTop: 4 }}>Teams in the same group share one scorecard — one person can keep score for all of them. Up to {SCRAMBLE_GROUP_MAX} {captains ? "teams" : "players"} a group.</div>
          {groupNos.map((n) => {
            const inGroup = teams.filter((g) => current.get(g.id) === n);
            return (
              <div key={n} data-scramble-group={`Group ${n}`} style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
                <div style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>Group {n}<span style={{ color: C.sage, fontWeight: 500, fontSize: 12 }}> · {loadOf(n)} {captains ? "team" : "player"}{loadOf(n) === 1 ? "" : "s"}</span></div>
                {inGroup.map((g) => {
                  const names = [...g.a, ...g.b].map((k) => byKey.get(k)?.display_name).filter(Boolean).join(", ");
                  const fits = groupNos.filter((m) => m === n || loadOf(m) + teamSize(g) <= SCRAMBLE_GROUP_MAX);
                  return (
                    <div key={g.id} data-scramble-group-team={g.name} style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                        <span style={{ display: "block", color: C.cream, fontWeight: 700 }}>{g.name}</span>
                        <span style={{ display: "block", color: C.sage, fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{names}</span>
                      </span>
                      {readOnly ? null : (
                        <select aria-label={`Group for ${g.name}`} disabled={busy} value={String(n)} onChange={(e) => moveTeam(g.id, e.target.value)}
                          style={{ ...inputStyle, width: 130, flexShrink: 0, padding: "8px 12px", fontSize: 13 }}>
                          {fits.map((m) => <option key={m} value={String(m)}>Group {m}</option>)}
                          {inGroup.length > 1 ? <option value="new">Own group</option> : null}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
