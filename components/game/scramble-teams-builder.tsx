"use client";
// Setup → Teams for a scramble (211.1; 212.11 owner layout). ONE column with every player — name, course handicap, and
// a team selector on the right (No team · Team 1 … · New team; full teams can't be picked) — and a summary of the teams
// below: players, and the team handicap by the game's method (USGA: the working; agreed: a box). Empty teams disappear
// when their last player moves. "Make balanced teams of 2 / 3 / 4" is a shortcut. Captains only: each player is their
// own team. (A Ryder Cup scramble builds its matches in Setup → Groups — 212.5.) Saving also sets tee groups.
import React, { useState } from "react";
import { C } from "@/lib/golf";
import { btn, inputStyle } from "@/components/ui";
import { chBasis, pkey, scrambleMethodOf } from "@/lib/game-shape";
import { scrambleTeamHandicap, customAllowanceFor } from "@/lib/scramble";
import { balanceScrambleTeams, scrambleSetupProblem, type ScrambleGroup } from "@/lib/scramble-teams";
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
  const byKey = new Map(live.map((p) => [pkey(p), p]));
  const ch = (p: Player) => Number(chBasis(p, game.course_par, nh >= 18 ? undefined : nh) ?? 0);
  const groups = (Array.isArray(game.foursomes) ? game.foursomes : []) as unknown as ScrambleGroup[];
  const slots = slotsOf(groups, mode);
  const slotOf = (key: string) => slots.findIndex((t) => t.members.includes(key));
  const problem = scrambleSetupProblem(groups, live.map(pkey), mode, { size: captains ? 1 : null, method });
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
        {live.map((p, i) => {
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
                    <span style={{ color: C.cream }}>{p.display_name}{captains ? " · captain" : ""}</span>
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
    </div>
  );
}
