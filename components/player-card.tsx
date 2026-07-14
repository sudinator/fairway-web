"use client";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase";
import { C } from "@/lib/golf";
import type { Round } from "@/lib/golf";
import { computeCardStats } from "@/lib/card";
import { BADGE_BY_KEY } from "@/lib/badges";
import { Avatar } from "@/components/ui";

const supabase = createClient();
const TIER_COLOR: Record<string, string> = { common: C.sage, rare: "#7FB8FF", elite: C.gold };
const TIER_RANK: Record<string, number> = { elite: 0, rare: 1, common: 2 };

type BadgeItem = { key: string; icon: string; label: string; tier: string; count?: number };
type CardView = { name: string; avatarUrl?: string | null; index: number | null; trend: number | null; roundsPlayed: number; badges: BadgeItem[]; form: number[]; shareOff?: boolean };

type EarnedLite = { badge_key: string; count?: number; last_earned_at?: string };

// Curation for the profile / peer card. The full history lives on the Achievements wall; this
// summary is deliberately selective so each chip means something to another player:
//  - drop personal single-value records (a peer can't read "best vs par -2")
//  - drop redundant "first X" badges (subsumed by the count badge or the milestone)
//  - collapse the gross-score chain to the best cleared, the rounds chain to the highest reached
//  - bogey-free streaks stay as normal chips but read hardest-first within a tier (bogeyTie)
//  - everything repeatable carries its ×count; headline scoring counts are pinned
const CARD_EXCLUDE = new Set(["best_vs_par", "best_differential", "best_gir", "best_fairways", "fewest_putts", "first_birdie", "first_eagle", "first_round", "no_penalties"]);
const BROKE_CHAIN = ["broke_par", "broke_80", "broke_85", "broke_90", "broke_100"]; // best → worst
const ROUNDS_CHAIN = ["rounds_100", "rounds_50", "rounds_25", "rounds_10", "rounds_5"]; // highest → lowest
// Bogey-free streaks are ordinary shelf badges now, but within a tier they read hardest-first
// (a clean nine outranks a 5+ run) rather than by count — otherwise the more frequent, easier
// streak would jump ahead. Non-family badges score 99 and fall through to the normal count sort.
const BOGEY_ORDER: Record<string, number> = { bogey_free_round: 0, bogey_free_9: 1, bogey_free_5: 2, bogey_free_3: 3 };
const bogeyTie = (a: string, b: string) => (BOGEY_ORDER[a] ?? 99) - (BOGEY_ORDER[b] ?? 99);
const CARD_PIN = new Set(["birdie", "eagle"]); // headline scoring counts — always surfaced
const CARD_CAP = 8;

function buildBadges(rows: EarnedLite[]): BadgeItem[] {
  const byKey: Record<string, EarnedLite> = {};
  rows.forEach((r) => { byKey[r.badge_key] = r; });
  const brokeBest = BROKE_CHAIN.find((k) => byKey[k] && (byKey[k].count || 0) > 0);
  const roundsTop = ROUNDS_CHAIN.find((k) => byKey[k]);

  const items = rows
    .map((r) => ({ r, def: BADGE_BY_KEY[r.badge_key] }))
    .filter(({ r, def }) =>
      def &&
      !CARD_EXCLUDE.has(r.badge_key) &&
      !(BROKE_CHAIN.includes(r.badge_key) && r.badge_key !== brokeBest) &&
      !(ROUNDS_CHAIN.includes(r.badge_key) && r.badge_key !== roundsTop))
    .map(({ r, def }) => ({ key: r.badge_key, def, count: r.count || 0, last: r.last_earned_at || "" }));

  items.sort((a, b) =>
    (TIER_RANK[a.def.tier] - TIER_RANK[b.def.tier]) || bogeyTie(a.key, b.key) || (b.count - a.count) || b.last.localeCompare(a.last));

  // Cap, but never drop a pinned headline badge that was actually earned.
  let capped = items.slice(0, CARD_CAP);
  for (const it of items) {
    if (CARD_PIN.has(it.key) && !capped.some((c) => c.key === it.key)) capped = capped.slice(0, CARD_CAP - 1).concat(it);
  }
  capped.sort((a, b) => (TIER_RANK[a.def.tier] - TIER_RANK[b.def.tier]) || bogeyTie(a.key, b.key) || (b.count - a.count));
  return capped.map((x) => ({ key: x.key, icon: x.def.icon, label: x.def.label, tier: x.def.tier, count: x.def.kind === "count" ? x.count : undefined }));
}

// Contextual mini-chart for the rolling-form series: y-scale labels (best/worst
// differential in the window), a faint average baseline, a dot per round, and the
// current value called out. Lower differential = lower on screen (down is better).
function FormChart({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const W = 300, H = 88, LG = 30, RG = 34, top = 10, bot = H - 20; // left gutter for labels, right for end value
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const avg = data.reduce((a, b) => a + b, 0) / data.length;
  const x = (i: number) => LG + (i / (data.length - 1)) * (W - LG - RG);
  const y = (v: number) => top + ((max - v) / span) * (bot - top); // max at top, min at bottom
  const pts = data.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const area = `${x(0)},${bot} ${pts} ${x(data.length - 1)},${bot}`;
  const improving = data[data.length - 1] <= data[0];
  const stroke = improving ? "#8FE0B0" : "#FB7185";
  const last = data[data.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block", overflow: "visible" }}>
      {/* scale gridlines + labels (worst at top, best at bottom) */}
      {[max, min].map((v, k) => {
        const yy = y(v);
        return (
          <g key={k}>
            <line x1={LG} y1={yy} x2={W - RG} y2={yy} stroke="#ffffff" strokeOpacity={0.12} strokeWidth={1} strokeDasharray="3 3" />
            <text x={LG - 5} y={yy + 3} textAnchor="end" fontSize="9" fill="#A9C4B5">{v.toFixed(1)}</text>
          </g>
        );
      })}
      {/* average baseline */}
      <line x1={LG} y1={y(avg)} x2={W - RG} y2={y(avg)} stroke="#C9A227" strokeOpacity={0.35} strokeWidth={1} />
      <text x={W - RG + 3} y={y(avg) + 3} fontSize="8" fill="#C9A227" opacity={0.8}>avg</text>
      {/* series */}
      <polygon points={area} fill={stroke} opacity={0.12} />
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {data.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r={i === data.length - 1 ? 3.5 : 2} fill={stroke} />)}
      {/* current value + x caption */}
      <text x={x(data.length - 1) + 6} y={y(last) + 3} fontSize="11" fontWeight="800" fill={stroke}>{last.toFixed(1)}</text>
      <text x={LG} y={H - 4} fontSize="9" fill="#8B8775">{data.length} rounds ago</text>
      <text x={W - RG} y={H - 4} textAnchor="end" fontSize="9" fill="#8B8775">now</text>
    </svg>
  );
}

// Presentational — renders any card, self or peer, from normalized view data.
export function PlayerCardView({ view }: { view: CardView }) {
  const { name, avatarUrl, index, trend, roundsPlayed, badges, form } = view;
  return (
    <div style={{ background: "linear-gradient(180deg,#1d5f47,#153f30)", border: `1px solid ${C.greenMid}`, borderRadius: 16, padding: 16, overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 13, alignItems: "center" }}>
        <Avatar src={avatarUrl} name={name} size={60} accent={C.gold} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 20, fontWeight: 800, color: C.cream, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
          <div style={{ color: C.sage, fontSize: 11, marginTop: 3 }}>{roundsPlayed} round{roundsPlayed === 1 ? "" : "s"}{badges.length ? ` · ${badges.length} badge${badges.length === 1 ? "" : "s"}` : ""}</div>
        </div>
        <div style={{ textAlign: "right", flex: "none" }}>
          <div style={{ color: C.gold, fontSize: 11, letterSpacing: 1.5, fontWeight: 800, textTransform: "uppercase" }}>Index</div>
          <div style={{ fontFamily: "Georgia, serif", fontSize: 28, fontWeight: 800, color: C.cream, lineHeight: 1 }}>{index == null ? "—" : index.toFixed(1)}</div>
          {trend != null && Math.abs(trend) >= 0.05 && (
            <div style={{ fontSize: 11, fontWeight: 800, marginTop: 2, color: trend < 0 ? "#8FE0B0" : "#FB7185" }}>{trend < 0 ? "▼" : "▲"} {Math.abs(trend).toFixed(1)}</div>
          )}
        </div>
      </div>

      {badges.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 800, textTransform: "uppercase", color: C.gold, marginBottom: 8 }}>Badges</div>
          <div className="bnn-noscroll" style={{ display: "flex", gap: 12, overflowX: "auto", scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}>
            {badges.map((b) => (
              <div key={b.key} style={{ flex: "none", width: 62, textAlign: "center" }}>
                <div style={{ position: "relative", width: 46, height: 46, margin: "0 auto" }}>
                  <div style={{ width: 46, height: 46, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, background: "radial-gradient(circle at 50% 32%, #20624a, #0e3a2c)", border: `2px solid ${TIER_COLOR[b.tier]}`, boxShadow: b.tier !== "common" ? `0 0 12px -4px ${TIER_COLOR[b.tier]}` : "none" }}>{b.icon}</div>
                  {b.count != null && b.count > 1 && (
                    <span style={{ position: "absolute", right: -4, top: -4, minWidth: 18, height: 18, padding: "0 4px", borderRadius: 9, background: C.gold, color: "#1c1c15", fontSize: 11, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", border: "1.5px solid #10402f" }}>{"×"}{b.count}</span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.sage, marginTop: 5, lineHeight: 1.2 }}>{b.label}</div>
              </div>
            ))}
          </div>
          <style>{`.bnn-noscroll::-webkit-scrollbar{display:none}`}</style>
        </div>
      )}

      {form.length >= 2 && (() => {
        const last = form[form.length - 1], first = form[0];
        const delta = Math.round((last - first) * 10) / 10;
        const verdict = delta <= -0.1 ? "Trending down" : delta >= 0.1 ? "Trending up" : "Holding steady";
        const good = delta <= -0.1; // lower differential is better
        const col = delta <= -0.1 ? "#8FE0B0" : delta >= 0.1 ? "#FB7185" : C.sage;
        return (
          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div style={{ fontSize: 11, letterSpacing: 1.5, fontWeight: 800, textTransform: "uppercase", color: C.gold }}>Recent form</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: col }}>
                {verdict}{Math.abs(delta) >= 0.1 ? ` ${delta < 0 ? "▼" : "▲"} ${Math.abs(delta).toFixed(1)}` : ""}
              </div>
            </div>
            <div style={{ marginTop: 8 }}><FormChart data={form} /></div>
            <div style={{ fontSize: 11, color: C.sage, marginTop: 6, lineHeight: 1.4 }}>
              5-round rolling average of your scoring differentials{good ? " — improving" : ""}. Lower is better; the gold line is your average over these rounds.
            </div>
          </div>
        );
      })()}
    </div>
  );
}

type Earned = { badge_key: string; count: number; best_value: number | null; last_earned_at: string };

// Self card — built from the signed-in player's own rounds + badges.
export function PlayerCard({ profile, user, rounds = [] }: { profile: any; user: any; rounds?: Round[] }) {
  const [earned, setEarned] = useState<Earned[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase.from("member_badges").select("badge_key,count,best_value,last_earned_at").eq("user_id", user.id);
      if (alive) setEarned((data || []) as Earned[]);
    })();
    return () => { alive = false; };
  }, [user.id, rounds.length]);

  const view: CardView = useMemo(() => {
    const s = computeCardStats(rounds);
    return {
      name: profile?.display_name || "Player",
      avatarUrl: profile?.avatar_url,
      index: profile?.handicap_index != null ? Number(profile.handicap_index) : s.idx,
      trend: s.idx_trend,
      roundsPlayed: s.rounds,
      badges: buildBadges(earned),
      form: s.form,
    };
  }, [earned, rounds, profile]);

  return <div style={{ marginTop: 12 }}><PlayerCardView view={view} /></div>;
}

// Peer card — opened from the roster. Reads badges + card summary via the group_*
// RPCs (a peer's own rounds aren't readable). Rendered in a modal overlay.
export function PeerCardModal({ member, groupId, viewerUserId, onClose }: { member: any; groupId: string; viewerUserId?: string; onClose: () => void }) {
  const [view, setView] = useState<CardView | null>(null);
  const [loading, setLoading] = useState(true);
  const isSelf = !!viewerUserId && member?.user_id === viewerUserId;
  const phone = member?.profiles?.phone || null;

  useEffect(() => {
    let alive = true;
    (async () => {
      const p = member.profiles || {};
      const uid = member.user_id;
      const [{ data: badges }, { data: cards }] = await Promise.all([
        supabase.rpc("group_badges", { p_group: groupId }),
        supabase.rpc("group_cards", { p_group: groupId }),
      ]);
      if (!alive) return;
      const mine = (badges || []).filter((b: any) => b.user_id === uid);
      const card = (cards || []).find((c: any) => c.user_id === uid) || null;
      const badgeRows = mine.map((b: any) => ({ badge_key: b.badge_key, count: b.count, last_earned_at: b.last_earned_at }));
      setView({
        name: p.display_name || member.email || "Player",
        avatarUrl: member.avatar_url,
        index: p.handicap_index != null ? Number(p.handicap_index) : (card?.idx != null ? Number(card.idx) : null),
        trend: card?.idx_trend != null ? Number(card.idx_trend) : null,
        roundsPlayed: card?.rounds ?? 0,
        badges: buildBadges(badgeRows),
        form: (card?.form as number[]) || [],
        shareOff: card ? card.show_card === false : false,
      });
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [member, groupId]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(6,20,15,.72)", zIndex: 60, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 460, position: "relative" }}>
        <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: -6, right: -6, zIndex: 2, width: 30, height: 30, borderRadius: 15, border: "none", background: C.green, color: C.cream, fontSize: 17, cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,.4)" }}>{"×"}</button>
        {loading ? (
          <div style={{ background: C.greenLight, borderRadius: 16, padding: 28, textAlign: "center", color: C.sage }}>Loading…</div>
        ) : view ? (
          <>
            <PlayerCardView view={view} />
            {!isSelf && <ContactBar recipientId={member.user_id} groupId={groupId} name={view.name} phone={phone} />}
            {view.shareOff ? (
              <div style={{ color: C.sage, fontSize: 11, textAlign: "center", marginTop: 8 }}>{view.name.split(" ")[0]} has profile sharing off — badges and form are hidden.</div>
            ) : view.roundsPlayed === 0 && view.badges.length === 0 ? (
              <div style={{ color: C.sage, fontSize: 11, textAlign: "center", marginTop: 8 }}>No card details yet.</div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}

// Contact bar on a peer card: phone tap-through (call/text) when a number is on
// file, plus a PII-free in-app nudge that's always available. The nudge goes
// through send_nudge (shared-club gate + 6h per-pair dedup).
function ContactBar({ recipientId, groupId, name, phone }: { recipientId: string; groupId: string; name: string; phone?: string | null }) {
  const [openMsg, setOpenMsg] = useState(false);
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<null | "sending" | "sent" | "too_soon" | "error">(null);

  const first = (name || "").split(" ")[0] || "them";

  const send = async () => {
    setStatus("sending");
    try {
      const { data, error } = await supabase.rpc("send_nudge", { p_recipient: recipientId, p_group: groupId, p_message: msg.trim() || null });
      if (error) { setStatus("error"); return; }
      setStatus(data === "too_soon" ? "too_soon" : "sent");
      if (data !== "too_soon") { setMsg(""); setOpenMsg(false); }
    } catch { setStatus("error"); }
  };

  return (
    <div style={{ marginTop: 10, background: C.greenLight, border: `1px solid ${C.greenMid}`, borderRadius: 12, padding: 12 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {phone && (
          <>
            <a href={`tel:${phone}`} style={{ flex: 1, minWidth: 96, textAlign: "center", background: C.cream, color: C.green, fontWeight: 800, fontSize: 13, textDecoration: "none", borderRadius: 9, padding: "10px 12px" }}>Call</a>
            <a href={`sms:${phone}`} style={{ flex: 1, minWidth: 96, textAlign: "center", background: C.cream, color: C.green, fontWeight: 800, fontSize: 13, textDecoration: "none", borderRadius: 9, padding: "10px 12px" }}>Text</a>
          </>
        )}
        <button onClick={() => { setOpenMsg((v) => !v); setStatus(null); }} style={{ flex: 1, minWidth: 96, background: C.gold, color: "#1c1c15", fontWeight: 800, fontSize: 13, border: "none", borderRadius: 9, padding: "10px 12px", cursor: "pointer" }}>
          {status === "sent" ? "Sent 👋" : "Say hi"}
        </button>
      </div>

      {openMsg && status !== "sent" && (
        <div style={{ marginTop: 10 }}>
          <textarea
            value={msg}
            onChange={(e) => setMsg(e.target.value.slice(0, 140))}
            placeholder={`Optional note to ${first} — e.g. "Free for Saturday?"`}
            rows={2}
            style={{ width: "100%", resize: "none", borderRadius: 8, border: `1px solid ${C.greenMid}`, background: "#0e3a2c", color: C.cream, fontSize: 13, padding: "8px 10px", fontFamily: "inherit" }}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
            <div style={{ fontSize: 11, color: C.faint }}>{msg.length}/140{status === "too_soon" ? " · you already reached out recently" : status === "error" ? " · couldn't send" : ""}</div>
            <button onClick={send} disabled={status === "sending"} style={{ background: C.green, color: C.cream, fontWeight: 800, fontSize: 13, border: "none", borderRadius: 8, padding: "8px 16px", cursor: "pointer", opacity: status === "sending" ? 0.6 : 1 }}>{status === "sending" ? "Sending…" : "Send"}</button>
          </div>
        </div>
      )}
      {status === "too_soon" && !openMsg && <div style={{ fontSize: 11, color: C.sage, marginTop: 8 }}>You already reached out to {first} recently — try again later.</div>}
    </div>
  );
}

// Profile setting: hide only the performance layer (badges, bests, form, trend)
// from other club members. Name, handicap, and contact stay visible either way.
export function CardVisibilityToggle({ user, initial }: { user: any; initial: boolean }) {
  const [on, setOn] = useState(initial);
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    const next = !on; setOn(next); setBusy(true);
    const { error } = await supabase.from("profiles").update({ show_card: next }).eq("id", user.id);
    if (error) setOn(!next);
    setBusy(false);
  };
  return (
    <div style={{ background: C.greenLight, borderRadius: 12, padding: 14, marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
      <div style={{ flex: 1 }}>
        <div style={{ color: C.cream, fontSize: 13, fontWeight: 700 }}>Show my card to the club {on ? "" : "· off"}</div>
        <div style={{ color: C.sage, fontSize: 12, lineHeight: 1.5, marginTop: 3 }}>
          Your name, handicap, and contact are always visible to club members. This controls whether they also see your badges, career bests, and recent form.
        </div>
      </div>
      <button onClick={toggle} disabled={busy} style={{ flex: "none", background: on ? C.gold : "transparent", color: on ? "#1c1c15" : C.cream, border: `1px solid ${on ? C.gold : C.sage}`, borderRadius: 9, padding: "8px 14px", fontSize: 12, fontWeight: 800, cursor: "pointer", whiteSpace: "nowrap", opacity: busy ? 0.6 : 1 }}>{on ? "On" : "Off"}</button>
    </div>
  );
}
