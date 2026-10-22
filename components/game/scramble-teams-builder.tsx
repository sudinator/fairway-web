"use client";
// Setup → Teams for a scramble (211.1; 211.9 owner redesign). Two ways to make teams — "Make balanced teams" (snake-
// drafted by course handicap) or "Pick teams myself" (empty teams + an Add to… for each player) — then move a player,
// take them off a team, add a team or remove an empty one. Each team shows its handicap by the game's method:
// USGA allowance (the breakdown, with the game's own percentages) or agreed (a box — blank plays scratch). Captains
// only: each team's captain scores for it. Saving also puts each group's players in one tee group.
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { btn, inputStyle } from "@/components/ui";
import { chBasis, pkey, scrambleMethodOf } from "@/lib/game-shape";
import { scrambleTeamHandicap, customAllowanceFor } from "@/lib/scramble";
import { balanceScrambleTeams, cupScrambleMatches, scrambleSetupProblem, type ScrambleGroup } from "@/lib/scramble-teams";
import { SCRAMBLE_METHOD_LABEL, scrambleMethodText } from "@/lib/scramble-method";
import type { Game, Player } from "@/lib/game-types";

type Slot = { groupId: string; side: "a" | "b"; name: string; members: string[]; hcp: number | null; matchName: string | null };

/** Every team slot in order — empty ones too (a "Pick teams myself" team before anyone is added). */
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
  // 212.0: no single team size — teams of 2 to 4, sizes may differ; captains only = one player per team.
  const captains = game.scramble_team_size === 1;
  const mode = game.scramble_mode === "match" ? "match" : "field";
  const method = scrambleMethodOf(game);
  const nh = Array.isArray(game.holes_meta) ? game.holes_meta.length : 18;
  const live = players.filter((p) => !p.no_show);
  const byKey = new Map(live.map((p) => [pkey(p), p]));
  // 212.3: a Ryder Cup scramble — team v team, every team exactly the session's size, sides fixed by the Cup teams
  const cupSize = mode === "match" && [2, 3, 4].includes(Number(game.scramble_team_size)) && live.some((p) => p.team === "A") && live.some((p) => p.team === "B")
    ? (Number(game.scramble_team_size) as 2 | 3 | 4) : null;
  const cupNames: [string, string] = [((game.teams || []) as { key: string; name: string }[]).find((x) => x.key === "A")?.name || "Team A", ((game.teams || []) as { key: string; name: string }[]).find((x) => x.key === "B")?.name || "Team B"];
  const maxPer = captains ? 1 : cupSize ?? 4;
  const sideOk = (p: Player, side: "a" | "b") => !cupSize || p.team === (side === "a" ? "A" : "B");
  const ch = (p: Player) => Number(chBasis(p, game.course_par, nh >= 18 ? undefined : nh) ?? 0);
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  const slots = slotsOf(groups, mode);
  const placed = new Set(groups.flatMap((g) => [...g.a, ...g.b]));
  const unplaced = live.filter((p) => !placed.has(pkey(p)));
  const problem = scrambleSetupProblem(groups, live.map(pkey), mode, { size: captains ? 1 : null, method, exact: cupSize, sideNames: cupNames });
  const sizes = slots.filter((t) => t.members.length).map((t) => t.members.length);
  const mixed = !captains && new Set(sizes).size > 1;

  const save = async (next: ScrambleGroup[]) => { setBusy(true); try { await onSave(next); } finally { setBusy(false); } };
  const without = (key: string) => groups.map((gr) => ({ ...gr, a: gr.a.filter((k) => k !== key), b: gr.b.filter((k) => k !== key) }));
  const putIn = (key: string, slot: number) => {
    const t = slots[slot]; if (!t) return;
    const next = without(key);
    const dest = next.find((gr) => gr.id === t.groupId)!;
    dest[t.side] = [...dest[t.side], key];
    void save(next);
  };
  const balance = (n: 1 | 2 | 3 | 4) => { const next = balanceScrambleTeams(live.map((p) => ({ key: pkey(p), ch: ch(p) })), n, mode); if (next) void save(next); };
  const emptyGroup = (i: number): ScrambleGroup => (mode === "match" ? { id: `match-${Date.now()}-${i}`, name: `Match ${i}`, a: [], b: [] } : { id: `team-${Date.now()}-${i}`, name: `Team ${i}`, a: [], b: [] });
  const cupBalance = () => {
    if (!cupSize) return;
    const side = (k: "A" | "B") => live.filter((p) => p.team === k).map((p) => ({ key: pkey(p), ch: ch(p) }));
    void save(cupScrambleMatches(side("A"), side("B"), cupSize));
  };
  const pickMyself = () => {
    const teams = cupSize ? 2 * Math.max(1, Math.floor(Math.min(live.filter((p) => p.team === "A").length, live.filter((p) => p.team === "B").length) / cupSize))
      : captains ? live.length : Math.max(2, Math.ceil(live.length / 4));
    const count = mode === "match" ? Math.max(1, Math.ceil(teams / 2)) : Math.max(1, teams);
    const empty: ScrambleGroup[] = [];
    for (let i = 1; i <= count; i++) empty.push(emptyGroup(i));
    void save(empty);
  };
  const addTeam = () => void save([...groups, emptyGroup(groups.length + 1)]);
  const removeGroup = (groupId: string) => void save(groups.filter((g) => g.id !== groupId));
  const setHcp = (groupId: string, side: "a" | "b", raw: string) => {
    const v = raw.trim() === "" ? null : Math.round(Number(raw));
    if (v != null && (!Number.isFinite(v) || v < -10 || v > 60)) return;
    void save(groups.map((gr) => (gr.id === groupId ? { ...gr, [side === "a" ? "a_hcp" : "b_hcp"]: v } : gr)));
  };

  return (
    <div data-scramble-teams>
      <div style={{ color: C.cream, fontSize: 12.5, fontWeight: 700 }}>
        {cupSize ? `Ryder Cup · ${cupSize} v ${cupSize}` : captains ? "Captains only" : "Teams of 2 to 4"} · {mode === "match" ? "team v team" : "one leaderboard"} · {SCRAMBLE_METHOD_LABEL[method]}
      </div>
      <div data-scramble-method style={{ color: C.sage, fontSize: 11.5, lineHeight: 1.45, marginTop: 4 }}>{scrambleMethodText(method, captains ? 1 : 4)}</div>
      {!readOnly && cupSize ? (
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <button disabled={busy || !live.length} onClick={cupBalance} style={{ ...btn(!groups.length), flex: 1, minWidth: 140, fontSize: 13 }}>{groups.length ? "Rebalance the matches" : "Make balanced matches"}</button>
          <button disabled={busy || !live.length} onClick={pickMyself} style={{ ...btn(false), flex: 1, minWidth: 140, fontSize: 13 }}>{groups.length ? "Start over — pick myself" : "Pick matches myself"}</button>
        </div>
      ) : !readOnly ? (captains ? (
        <button disabled={busy || !live.length} onClick={() => balance(1)} style={{ ...btn(!groups.length), width: "100%", marginTop: 10, fontSize: 13 }}>{groups.length ? "Remake: a team for each captain" : "A team for each captain"}</button>
      ) : (
        <>
          <div style={{ color: C.sage, fontSize: 11, fontWeight: 800, letterSpacing: 1, marginTop: 12 }}>{groups.length ? "REBALANCE AS TEAMS OF" : "MAKE BALANCED TEAMS OF"}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
            {([2, 3, 4] as const).map((n) => <button key={n} disabled={busy || live.length < 2} onClick={() => balance(n)} style={{ ...btn(false), flex: 1, fontSize: 13 }}>{n} players</button>)}
          </div>
          <button disabled={busy || !live.length} onClick={pickMyself} style={{ ...btn(false), width: "100%", marginTop: 8, fontSize: 13 }}>{groups.length ? "Start over — pick teams myself" : "Pick teams myself"}</button>
        </>
      )) : null}
      {mixed ? <div data-scramble-mixed style={{ color: C.sage, fontSize: 11.5, marginTop: 8 }}>Teams of different sizes: {slots.filter((t) => t.members.length && t.members.length !== Math.min(...sizes)).map((t) => `${t.name} has ${t.members.length} players`).join(", ")}. Each uses the percentages for its own size.</div> : null}
      {problem ? <div data-scramble-problem style={{ color: C.gold, fontSize: 12.5, marginTop: 10 }}>{problem}</div> : null}

      {unplaced.length && groups.length ? (
        <div data-scramble-unplaced style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 10 }}>
          <div style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>NOT ON A TEAM YET</div>
          {unplaced.map((p) => (
            <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12.5 }}>
              <span style={{ flex: 1, color: C.cream }}>{p.display_name}</span>
              <span style={{ color: C.sage }}>{ch(p).toFixed(1)}</span>
              {!readOnly ? (
                <select aria-label={`Add ${p.display_name} to a team`} disabled={busy} value="" onChange={(e) => putIn(pkey(p), Number(e.target.value))} style={{ ...inputStyle, width: "auto", padding: "8px 12px", fontSize: 12 }}>
                  <option value="" disabled>Add to…</option>
                  {slots.map((t, i) => (t.members.length >= maxPer || !sideOk(p, t.side) ? null : <option key={i} value={i}>{cupSize ? `${t.matchName ?? groups.find((g) => g.id === t.groupId)?.name} · ${cupNames[t.side === "a" ? 0 : 1]}` : t.name}{t.members.length ? ` (${t.members.length})` : ""}</option>))}
                </select>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {slots.map((t, ti) => {
        const members = t.members.map((k) => byKey.get(k)).filter((p): p is Player => !!p);
        const th = method === "usga" && members.length >= 2 && members.length <= 4 ? scrambleTeamHandicap(members.map(ch), false, customAllowanceFor(game.scramble_allowance, members.length)) : null;
        const shown = method === "gross" ? "Gross" : method === "agreed" ? (t.hcp != null ? `Team handicap ${t.hcp}` : "Scratch (no handicap entered)") : th ? `Team handicap ${th.total}` : "2 to 4 players";
        const groupEmpty = (() => { const g = groups.find((x) => x.id === t.groupId); return !!g && !g.a.length && !g.b.length; })();
        return (
          <React.Fragment key={`${t.groupId}-${t.side}`}>
            {t.matchName ? (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14 }}>
                <span style={{ color: C.gold, fontSize: 11, fontWeight: 800, letterSpacing: 1 }}>{t.matchName.toUpperCase()}</span>
                {!readOnly && groupEmpty ? <button onClick={() => removeGroup(t.groupId)} disabled={busy} style={{ ...btn(false), padding: "8px 12px", fontSize: 11 }}>Remove match</button> : null}
              </div>
            ) : null}
            <div data-scramble-team={t.name} style={{ background: C.greenLight, borderRadius: 12, padding: "8px 12px", marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ color: C.cream, fontWeight: 800, fontSize: 14 }}>{cupSize ? cupNames[t.side === "a" ? 0 : 1] : t.name}{members.length && !captains ? <span style={{ color: C.sage, fontWeight: 500, fontSize: 12 }}> · {members.length} player{members.length === 1 ? "" : "s"}{members.length >= maxPer ? " (full)" : ""}</span> : null}</span>
                <span style={{ color: C.gold, fontWeight: 800, fontSize: 13 }}>{members.length ? shown : "No players yet"}</span>
              </div>
              {members.map((p) => {
                const part = th?.parts.find((x) => members[x.index] === p);
                return (
                  <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, fontSize: 12.5 }}>
                    <span style={{ flex: 1, color: C.cream }}>{p.display_name}{captains ? " · captain" : ""}</span>
                    <span style={{ color: C.sage }}>{ch(p).toFixed(1)}{part ? ` × ${Math.round(part.pct * 100)}% = ${part.counts.toFixed(1)}` : ""}</span>
                    {!readOnly ? (
                      <select aria-label={`Move ${p.display_name}`} disabled={busy} value="" onChange={(e) => { const v = e.target.value; if (v === "off") void save(without(pkey(p))); else putIn(pkey(p), Number(v)); }} style={{ ...inputStyle, width: "auto", padding: "8px 12px", fontSize: 12 }}>
                        <option value="" disabled>Move to…</option>
                        {slots.map((o, oi) => (oi === ti || o.members.length >= maxPer || !sideOk(p, o.side) ? null : <option key={oi} value={oi}>{cupSize ? `${groups.find((g) => g.id === o.groupId)?.name} · ${cupNames[o.side === "a" ? 0 : 1]}` : o.name}</option>))}
                        <option value="off">Take off team</option>
                      </select>
                    ) : null}
                  </div>
                );
              })}
              {th ? <div style={{ color: C.sage, fontSize: 11, marginTop: 6 }}>{th.raw.toFixed(2)}, rounded to {th.total}</div> : null}
              {captains && members.length ? <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>Enters the team&apos;s score — the teammates play outside the app.</div> : null}
              {method === "agreed" && !readOnly && members.length ? (
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 12, color: C.sage }}>
                  Agreed team handicap
                  <input aria-label={`${t.name} team handicap`} inputMode="numeric" defaultValue={t.hcp ?? ""} key={`${t.groupId}-${t.side}-${t.hcp ?? ""}`} placeholder="scratch" disabled={busy}
                    onBlur={(e) => { const raw = e.currentTarget.value; if ((raw.trim() === "" ? null : Math.round(Number(raw))) !== t.hcp) setHcp(t.groupId, t.side, raw); }}
                    style={{ ...inputStyle, width: 110 }} />
                </label>
              ) : null}
              {!readOnly && mode === "field" && !members.length ? <button onClick={() => removeGroup(t.groupId)} disabled={busy} style={{ ...btn(false), marginTop: 8, padding: "8px 12px", fontSize: 11 }}>Remove team</button> : null}
            </div>
          </React.Fragment>
        );
      })}
      {!readOnly && groups.length ? <button onClick={addTeam} disabled={busy} style={{ ...btn(false), width: "100%", marginTop: 10, fontSize: 13 }}>{mode === "match" ? "Add a match" : "Add a team"}</button> : null}
    </div>
  );
}
