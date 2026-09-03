/**
 * Screen render tests — REAL components from components/, not stand-ins.
 *
 * Every assertion here corresponds to something that actually shipped and was found by a person
 * looking at a phone:
 *
 *   text readable       44 destructive actions at 1.42:1; six confirm buttons rendered blue
 *   rows all present    a list that renders nothing is indistinguishable from an empty list
 *   tap targets         30 buttons under 24px, the worst an 18px band around 11px text
 *   mounts at all       a conditional hook or an undefined prop crashes the screen
 *
 * Deliberately scoped to components that take PROPS ONLY. Eighteen of them do, including the
 * scorecard, the leaderboard row and the share modal — no database stand-in needed to start.
 * The Supabase-coupled screens come next and need a fake client; doing the prop-only ones first
 * gets real coverage today rather than after a day of infrastructure.
 */
// screen-harness FIRST: it sets the Supabase env placeholders that module-scope
// createClient() calls need, and imports run in declaration order.
import { renderScreen, assertReadable, assertTappable, ok, eq, contrast, report } from "./screen-harness";
import * as React from "react";
import { C } from "@/lib/golf";
import { RoundsList } from "@/components/rounds-list";
import { LeaderRow } from "@/components/game/leader-row";
import { SegmentBoard } from "@/components/game/segment-views";
import { FourballView } from "@/components/game/scoring-views";
import { ShotSynthesis } from "@/components/compare-stats";

// ---------------------------------------------------------------------------
// Fixtures. Shaped like real rows, with the awkward cases a live database produces: a round with
// no stats, a name long enough to wrap, a score that is not a personal best.

/** 18 holes shaped like a real card: par 4/3/5 mix, a couple of missing putts, one penalty. */
const holes = (opts: { complete?: boolean } = {}) =>
  Array.from({ length: 18 }, (_, i) => {
    const n = i + 1;
    const par = n % 6 === 0 ? 5 : n % 4 === 0 ? 3 : 4;
    return {
      hole_number: n,
      par,
      stroke_index: ((n * 7) % 18) + 1,
      strokes: par + (n % 3 === 0 ? 1 : 0),
      // A few holes with no putts recorded — the shape that drives the "incomplete stats" badge.
      putts: !opts.complete && n % 7 === 0 ? null : 2,
      fairway: par === 3 ? null : n % 3 === 0 ? "miss" : "hit",
      penalties: n === 12 ? 1 : 0,
      sand: n === 5,
      yardage: par === 3 ? 160 : par === 5 ? 520 : 390,
    };
  });

const round = (over: Partial<Record<string, unknown>> = {}) => ({
  holes: holes(),
  id: "r1",
  played_at: "2026-08-02",
  course: "Francis Byrne Golf Course",
  tee_name: "Blue",
  gross: 93,
  vs_par: 23,
  stableford: 33,
  rating: 72.9,
  slope: 137,
  holes_played: 18,
  gir: 5,
  fir: 6,
  putts: 38,
  penalties: 0,
  ...over,
});

// ---------------------------------------------------------------------------
{
  const s = renderScreen(<RoundsList rounds={[] as never} onOpen={() => {}} />);
  ok(s.text.length > 0, "RoundsList: empty state renders something rather than nothing");
  assertReadable(s, "RoundsList empty");
  s.unmount();
}

{
  const rounds = [
    round(),
    round({
      id: "r2",
      course: "Neshanic Valley Golf Course — Lake/Ridge",
      // Gross is derived from the holes, not read off the row — so a different score means
      // different holes. par 4 played in 4 across 18 = 72.
      holes: holes().map((h) => ({ ...h, par: 4, strokes: 4 })),
    }),
    // A round with no stats recorded — the shape that produces null-vs-zero bugs.
    round({ id: "r3", gross: 88, vs_par: 18, stableford: null, gir: null, fir: null, putts: null,
            // Distinct total (par + 2 everywhere = 90 + 18 = 108) so that dropping THIS row
            // fails the "every round is on screen" check. Identical totals would hide it.
            holes: holes().map((h) => ({ ...h, strokes: h.par + 2, putts: null, fairway: null })) }),
  ];
  const s = renderScreen(<RoundsList rounds={rounds as never} onOpen={() => {}} />);

  // Every round must appear. A list that silently drops a row looks identical to a short list.
  // Assert on the totals the card DERIVES from the holes, which is what a user reads, rather
  // than on row fields the component never looks at.
  const grossOf = (r: { holes: { strokes: number | null }[] }) =>
    r.holes.reduce((t, h) => t + (h.strokes ?? 0), 0);
  for (const r of rounds) {
    ok(
      s.text.includes(String(grossOf(r as never))),
      `RoundsList: round ${r.id} shows its gross (${grossOf(r as never)})`,
    );
  }
  ok(s.text.includes("Francis Byrne"), "RoundsList: course name is shown");
  ok(s.text.includes("Neshanic Valley"), "RoundsList: a long course name is shown in full");

  // The assertion that would have caught the blue buttons and the invisible Delete text.
  assertReadable(s, "RoundsList with rounds");
  assertTappable(s, "RoundsList");

  // A round missing its stats must not crash or print "null" at the user.
  ok(!/\bnull\b|\bundefined\b|NaN/.test(s.text), "RoundsList: no null/undefined/NaN leaks into the UI");
  s.unmount();
}

// ---------------------------------------------------------------------------
// LeaderRow — the component whose four net-vs-par states were ALL unreadable at 177.69
// (1.33–2.27:1) because its colours were chosen for a cream surface and the row turned green.
{
  const player = (over: Partial<Record<string, unknown>> = {}) => ({
    id: "p1",
    user_id: "u1",
    display_name: "Amit Sud",
    thru: 9,
    rel: -3,
    net: -3,
    gross: 40,
    ...over,
  });

  const cases: [string, Record<string, unknown>][] = [
    ["under par", player({ rel: -3 })],
    ["level par", player({ id: "p2", user_id: "u2", rel: 0 })],
    ["over par", player({ id: "p3", user_id: "u3", rel: 4 })],
    ["not started", player({ id: "p4", user_id: "u4", thru: 0, rel: null, net: null })],
  ];

  // LeaderRow derives its numbers through callbacks, so the test supplies them exactly as the
  // game room does. Passing plain fields instead would have tested a component that does not exist.
  const relOf = (x: Record<string, unknown>) => (x.rel as number | null);
  for (const [name, p] of cases) {
    const s = renderScreen(
      <div style={{ background: C.greenLight }}>
        <LeaderRow
          p={p as never}
          pos={1}
          tied={false}
          showTag={false}
          showBetStatus={false}
          user={{ id: "u1" }}
          isStroke
          strokeNet
          playerPoints={() => 0}
          playerThru={(x) => ((x as never as Record<string, number>).thru ?? 0)}
          playerNet={() => (relOf(p) ?? 0)}
          playerGross={(x) => ((x as never as Record<string, number>).gross ?? 0)}
          parThru={() => 36}
          relToParStr={() => (relOf(p) == null ? "\u2013" : relOf(p)! > 0 ? `+${relOf(p)}` : relOf(p) === 0 ? "E" : String(relOf(p)))}
          leaderName={(full) => full}
        />
      </div>,
      { background: C.greenLight },
    );
    ok(s.text.length > 0, `LeaderRow ${name}: renders`);
    assertReadable(s, `LeaderRow ${name}`);
    s.unmount();
  }
}


// ---------------------------------------------------------------------------
// SegmentBoard — the front/back/total board. Its rows carry a per-player total, so a tie and a
// player who has not started are the states most likely to render blank or NaN.
{
  // Three segments of six holes (1-6, 7-12, 13-18), not front/back nine.
  const rows = [
    { name: "Amit Sud", thru: 18, segs: [12, 14, 13], total: 39, isMe: true },
    { name: "Bryan Fingeroot", thru: 18, segs: [14, 12, 13], total: 39, isMe: false }, // tie on total
    { name: "Shubho Ghosh", thru: 9, segs: [11, 5, 0], total: 16, isMe: false },       // mid-round
    { name: "Arinjay Rathore", thru: 0, segs: [0, 0, 0], total: 0, isMe: false },      // not started
  ];

  for (const isStroke of [true, false]) {
    const s = renderScreen(
      <div style={{ background: C.greenLight }}>
        <SegmentBoard rows={rows} isStroke={isStroke} />
      </div>,
      { background: C.greenLight },
    );
    const kind = isStroke ? "stroke" : "points";
    // Collapsed by default — this is the state a user actually meets, so it is tested as such.
    ok(s.text.includes("Full segment breakdown"), `SegmentBoard ${kind}: collapsed header is shown`);
    ok(!/NaN|undefined/.test(s.text), `SegmentBoard ${kind}: no NaN or undefined when collapsed`);
    assertReadable(s, `SegmentBoard ${kind} collapsed`);
    assertTappable(s, `SegmentBoard ${kind} collapsed`);

    // Expanded: every player and every segment column must appear.
    s.click("Full segment breakdown");
    for (const r of rows) {
      ok(s.text.includes(r.name.split(" ")[0]), `SegmentBoard ${kind}: ${r.name} listed once expanded`);
    }
    for (const col of ["1\u20136", "7\u201312", "13\u201318"]) {
      ok(s.text.includes(col), `SegmentBoard ${kind}: column ${col} is shown`);
    }
    ok(!/NaN|undefined/.test(s.text), `SegmentBoard ${kind}: no NaN or undefined when expanded`);
    assertReadable(s, `SegmentBoard ${kind} expanded`);
    s.unmount();
  }

  // An empty board must not render a stray heading with nothing under it.
  const empty = renderScreen(<SegmentBoard rows={[]} isStroke />);
  ok(empty.text.trim() === "", "SegmentBoard: renders nothing at all when there are no rows");
  empty.unmount();
}

// ---------------------------------------------------------------------------
// ShotSynthesis — every field is nullable, which is the normal state for a new player with no
// stats recorded. This is the shape that produces "NaN%" and "null putts" in the UI.
{
  const full = renderScreen(
    <div style={{ background: C.greenLight }}>
      <ShotSynthesis
        fir={{ hit: 9, total: 14 }}
        gir={{ hit: 8, total: 18 }}
        puttsPerRound={31.4}
        scramble={{ hit: 4, total: 10 }}
        index={14.2}
        goalHcp={10}
        setGoalHcp={() => {}}
        detailRounds={12}
      />
    </div>,
    { background: C.greenLight },
  );
  ok(full.text.length > 0, "ShotSynthesis: renders with full stats");
  ok(!/NaN|undefined|null/.test(full.text), "ShotSynthesis: no NaN/undefined/null with full stats");
  assertReadable(full, "ShotSynthesis full");
  assertTappable(full, "ShotSynthesis full");
  full.unmount();

  // No handicap index: the panel compares you against a target band, which means nothing without
  // one, so it renders nothing at all. Deliberate — pinned so a future change cannot start
  // showing an empty comparison.
  const noIndex = renderScreen(
    <ShotSynthesis
      fir={{ hit: 0, total: 0 }}
      gir={{ hit: 0, total: 0 }}
      puttsPerRound={null}
      scramble={{ hit: 0, total: 0 }}
      index={null}
      goalHcp={null}
      setGoalHcp={() => {}}
      detailRounds={0}
    />,
  );
  ok(noIndex.text.trim() === "", "ShotSynthesis: renders nothing without a handicap index");
  noIndex.unmount();

  // The real empty state: an index exists, but no shots recorded yet — a new member who has
  // entered a handicap. Every percentage is 0/0, which is where NaN comes from.
  const noShots = renderScreen(
    <div style={{ background: C.greenLight }}>
      <ShotSynthesis
        fir={{ hit: 0, total: 0 }}
        gir={{ hit: 0, total: 0 }}
        puttsPerRound={null}
        scramble={{ hit: 0, total: 0 }}
        index={14.2}
        goalHcp={null}
        setGoalHcp={() => {}}
        detailRounds={0}
      />
    </div>,
    { background: C.greenLight },
  );
  // Also nothing: every stat has a minimum round count, and with none recorded no row qualifies.
  // A comparison panel with nothing to compare is noise, so this is right.
  ok(noShots.text.trim() === "", "ShotSynthesis: renders nothing when no stat has a sample");
  noShots.unmount();

  // The meaningful edge: enough rounds to qualify, with percentages at the extremes where
  // formatting and rounding tend to break.
  const extremes = renderScreen(
    <div style={{ background: C.greenLight }}>
      <ShotSynthesis
        fir={{ hit: 0, total: 14 }}          /* 0% */
        gir={{ hit: 18, total: 18 }}         /* 100% */
        puttsPerRound={45}                   /* implausibly high but valid */
        scramble={{ hit: 1, total: 3 }}      /* 33.33... — a repeating decimal */
        index={14.2}
        goalHcp={8}
        setGoalHcp={() => {}}
        detailRounds={20}
      />
    </div>,
    { background: C.greenLight },
  );
  ok(extremes.text.length > 0, "ShotSynthesis: renders with a qualifying sample");
  ok(!/NaN|undefined/.test(extremes.text), "ShotSynthesis: no NaN at 0% / 100% / repeating decimals");
  ok(!/\d{3,}\.\d{3,}/.test(extremes.text), "ShotSynthesis: no unrounded repeating decimal on screen");
  assertReadable(extremes, "ShotSynthesis extremes");
  assertTappable(extremes, "ShotSynthesis extremes");
  extremes.unmount();
}

// ---------------------------------------------------------------------------
// Game 645502: the real Trifecta result component must render mathematical close-outs, not the
// raw lead after all nine gross scores. The gross rows intentionally remain complete.
{
  const triHoles = [
    { n: 1, si: 5, par: 4 }, { n: 2, si: 11, par: 3 }, { n: 3, si: 7, par: 4 },
    { n: 4, si: 13, par: 4 }, { n: 5, si: 17, par: 3 }, { n: 6, si: 1, par: 4 },
    { n: 7, si: 15, par: 4 }, { n: 8, si: 9, par: 4 }, { n: 9, si: 3, par: 4 },
  ];
  const parScores = triHoles.map((h) => h.par);
  const triRows: [string, string, "A" | "B", number][] = [
    ["a1", "A.J. Patel", "A", 3.2], ["a2", "Bo Li", "A", 0.8],
    ["b1", "Amit Sud", "B", 14], ["b2", "R. K. Srinivasan", "B", 12.4],
    ["a3", "Christopher Alexander Reed", "A", 29.7], ["a4", "Lex Rivera-Santos", "A", 17.3],
    ["b3", "Chris O'Neal", "B", 5.5], ["b4", "DeShawn Brooks Jr.", "B", 14.8],
    ["a5", "Michael Van Der Meer", "A", 24.2], ["a6", "Sebastian Montgomery", "A", 20.6],
    ["b5", "Marcus Johnson", "B", 10.1], ["b6", "T.J. Wu", "B", 7.9],
  ];
  const triGame = {
    id: "645502", code: "645502", name: "Yes 123 · Saturday Morning", course: "Francis Byrne Golf Course",
    course_par: 70, holes_meta: triHoles, game_type: "trifecta", allowance_pct: 100, pairings: [],
    trifecta_scoring: "match", team_score_mode: "best_ball", status: "active",
    teams: [{ key: "A", name: "Violet" }, { key: "B", name: "Burgundy" }],
    foursomes: [
      { id: "group-1", name: "Group 1", a: ["a1", "a2"], b: ["b1", "b2"], swap: true },
      { id: "group-2", name: "Group 2", a: ["a3", "a4"], b: ["b3", "b4"], swap: true },
      { id: "group-3", name: "Group 3", a: ["a5", "a6"], b: ["b5", "b6"], swap: true },
    ], created_by: "owner", created_at: "2026-09-03T00:00:00Z",
  } as any;
  const triPlayers = triRows.map(([user_id, display_name, team, handicap_index], i) => ({
    id: `p${i}`, game_id: triGame.id, user_id, display_name, team, handicap_index,
    rating: 73.5, slope: 137, tee_name: "Black", course_handicap: 0,
    scores: [...parScores], putts: [], fairways: [], tee_group: Math.floor(i / 4) + 1,
  })) as any;
  const rendered = renderScreen(<FourballView game={triGame} players={triPlayers} user={{ id: "viewer" }} isCreator={false} onChanged={() => {}} />);
  ok(rendered.text.includes("3 & 2"), "game 645502: rendered first Single freezes at 3 & 2");
  ok(rendered.text.includes("5 & 3"), "game 645502: rendered second Single freezes at 5 & 3");
  ok(rendered.text.includes("4 & 3"), "game 645502: rendered Best Ball freezes at 4 & 3");
  ok(!rendered.text.includes("5DN"), "game 645502: rendered result never degrades to 5 DN");
  ok(!rendered.text.includes("8DN"), "game 645502: rendered result never degrades to 8 DN");
  rendered.unmount();
}

// ---------------------------------------------------------------------------
// The token contract every screen depends on. Cheap, and it pins the pairings that were wrong.
ok((contrast(C.faint, C.card) ?? 0) >= 4.5, "C.faint on cream is AA");
ok((contrast(C.sage, C.greenLight) ?? 0) >= 4.5, "C.sage on green is AA");
ok((contrast(C.overRedDark, C.greenLight) ?? 0) >= 4.5, "C.overRedDark on green is AA");
ok((contrast(C.cream, C.danger) ?? 0) >= 4.5, "C.cream on C.danger is AA");
// The inverse cases: these must STAY unusable, or the surface rule has quietly been abandoned.
ok((contrast(C.birdie, C.greenLight) ?? 9) < 4.5, "C.birdie stays cream-only");
ok((contrast(C.faint, C.greenLight) ?? 9) < 4.5, "C.faint stays cream-only");

report("screen render");
