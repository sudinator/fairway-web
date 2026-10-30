"use client";
/**
 * Personal bests — the dashboard card (owner, Oct 30: variant C). The latest NEW best as a hero ("79 · New lowest gross ·
 * beat your 81 by two"), the rest as rows; with nothing new in the last 30 days, rows only. Each best opens its round.
 * Computed from the member's finished rounds (lib/personal-bests); nothing from test clubs can be in them.
 */
import * as React from "react";
import { C, type Round } from "@/lib/golf";
import { Eyebrow } from "@/components/ui";
import { personalBests, beatLine, type Best } from "@/lib/personal-bests";

const NewTag = () => <span data-pb-new style={{ background: C.gold, color: C.green, fontSize: 11, fontWeight: 800, letterSpacing: 0.6, borderRadius: 999, paddingTop: 2, paddingBottom: 2, paddingLeft: 7, paddingRight: 7, marginLeft: 6, verticalAlign: "middle" }}>NEW</span>;

export function PersonalBestsCard({ rounds, onOpen, now }: { rounds: Round[]; onOpen: (r: Round) => void; now?: Date }) {
  const pb = React.useMemo(() => personalBests(rounds, now), [rounds, now]);
  if (!pb.bests.length) return null;
  const hero = pb.newest, rest = pb.bests.filter((b) => b !== hero);
  const open = (b: Best) => { const r = rounds.find((x) => x.id === b.roundId); if (r) onOpen(r); };
  const rowBtn: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 10, paddingTop: 6, paddingBottom: 6, width: "100%", background: "none", border: "none", borderTop: `1px solid ${C.green}`, color: C.cream, textAlign: "left", cursor: "pointer", font: "inherit" };
  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 18, marginTop: 20, color: C.cream }} data-personal-bests>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <Eyebrow style={{ marginTop: 0 }}>PERSONAL BESTS</Eyebrow>
        <span style={{ color: C.sage, fontSize: 12 }}>{pb.rounds} full {pb.rounds === 1 ? "round" : "rounds"}</span>
      </div>
      {hero ? (
        <button onClick={() => open(hero)} data-pb-hero style={{ background: C.greenMid, borderRadius: 12, padding: 14, marginTop: 10, border: `1px solid ${C.gold}`, display: "flex", alignItems: "center", gap: 14, width: "100%", color: C.cream, textAlign: "left", cursor: "pointer", font: "inherit" }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 40, fontWeight: 800, color: C.gold, lineHeight: 1, flexShrink: 0 }}>{hero.display}</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 800 }}>New {hero.label.toLowerCase()} <NewTag /></div>
            <div style={{ color: C.sage, fontSize: 12, marginTop: 2 }}>{hero.detail} · {hero.when} · {beatLine(hero)}</div>
          </div>
        </button>
      ) : null}
      <div style={{ marginTop: 8 }}>
        {rest.map((b) => (
          <button key={b.key} onClick={() => open(b)} data-pb-row={b.key} style={rowBtn}>
            <span style={{ color: C.sage, fontSize: 12, width: 124, flexShrink: 0 }}>{b.label}{b.isNew ? <NewTag /> : null}</span>
            <span style={{ fontFamily: "Georgia, serif", fontSize: 17, fontWeight: 800, width: 58, flexShrink: 0 }}>{b.display}</span>
            <span style={{ color: C.sage, fontSize: 11, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.detail} · {b.when}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
