"use client";
import React, { useState, useRef, useEffect } from "react";
import { C } from "@/lib/golf";
import { btn, inputStyle } from "@/components/ui";

// A no-LLM, no-network help search. Curated Q&A, matched on the client with a small
// keyword/fuzzy scorer. Deterministic, instant, works offline, costs nothing.
type Faq = { q: string; keywords: string; steps: string[] };

const FAQ: Faq[] = [
  {
    q: "How do I create a game?",
    keywords: "create start new game organize set up tournament begin host",
    steps: [
      "Open the Games screen.",
      "Tap '+ Start a game'.",
      "Pick the course and tee, choose a format, and select the players.",
      "Tap Create. You'll get a 6-digit code to share.",
    ],
  },
  {
    q: "How do I add or invite players to a game?",
    keywords: "invite add players join friends roster members code include",
    steps: [
      "When creating, tick the club members you want to include.",
      "After creating, share the 6-digit game code (tap it to copy).",
      "Players enter that code on their own Games screen to join.",
    ],
  },
  {
    q: "How do I join a game someone else created?",
    keywords: "join enter code existing game friend created someone",
    steps: [
      "Open the Games screen.",
      "Enter the 6-digit code the organizer shared.",
      "You'll appear in the game and can start entering scores.",
    ],
  },
  {
    q: "Where is the game code and how do I share it?",
    keywords: "code share copy six digit text invite link send",
    steps: [
      "Open the game.",
      "The 6-digit code is shown near the top of the screen.",
      "Tap it to copy, then paste it into a text or chat.",
    ],
  },
  {
    q: "How do I enter my scores?",
    keywords: "enter score strokes scorecard record putt hole input add",
    steps: [
      "Open the game and go to the Scorecard.",
      "Tap a hole and set your strokes (and putts/fairway if you track stats).",
      "Scores save automatically. You'll see a 'Synced' confirmation.",
    ],
  },
  {
    q: "How does one person keep score for the whole group?",
    keywords: "marker keep score group one phone scorer take over single",
    steps: [
      "On the group scorecard, tap 'Take over scoring'.",
      "You become the marker and enter everyone's scores on one phone.",
      "The others' own cards lock so two phones aren't entering at once.",
      "Tap it again to hand scoring back.",
    ],
  },
  {
    q: "How do I set my handicap?",
    keywords: "handicap index set change scratch course enter mine",
    steps: [
      "Open the Players tab (or your Profile).",
      "Enter your handicap index.",
      "It converts to a course handicap for the selected tee automatically.",
    ],
  },
  {
    q: "What happens if a player has no handicap?",
    keywords: "no handicap missing scratch zero default without unset",
    steps: [
      "They play off scratch (0) until a handicap is set.",
      "Set it any time in the Players tab and scoring updates immediately.",
    ],
  },
  {
    q: "How do I set up teams or matchups?",
    keywords: "teams matchups four ball fourball trifecta assign foursomes setup pairings sides",
    steps: [
      "Open the game's Setup tab.",
      "Use the Teams step to assign players to sides.",
      "Use the Matchups step to build the foursomes or 1-v-1 pairings.",
      "New team games open on Setup automatically so you don't miss this.",
    ],
  },
  {
    q: "How do I change the format after starting?",
    keywords: "change format switch stableford stroke skins match convert different",
    steps: [
      "Open the game's Setup tab.",
      "Choose a new format under Change format.",
      "Switching to a simpler format is instant; team formats may add a teams step.",
      "Adding teams is locked once play has started.",
    ],
  },
  {
    q: "What are the different formats?",
    keywords: "formats stableford stroke play skins match four ball trifecta difference explain types which",
    steps: [
      "Stableford - points per hole vs par (kindest for mixed groups).",
      "Stroke play - lowest total wins, gross or net.",
      "Skins - each hole is its own prize (carry over or split).",
      "Singles match - you vs one opponent, hole by hole.",
      "Four-ball - two teams, best ball or shootout (aggregate).",
      "Trifecta - four-ball plus the two 1-v-1 singles (three contests).",
    ],
  },
  {
    q: "How do I finish or end the round?",
    keywords: "finish end close round complete post done over stop",
    steps: [
      "The organizer can end the game from the Setup tab.",
      "If your group has its own marker, use 'Finish my group' to lock and post that group's scores.",
      "Finishing posts each player's round to their Rounds tab and handicap.",
    ],
  },
  {
    q: "How do I see the results or leaderboard?",
    keywords: "results leaderboard standings winner score who winning rank position",
    steps: [
      "Open the game's Scorecard screen.",
      "The leaderboard or standings show at the top and update live as scores come in.",
    ],
  },
  {
    q: "How do I add a guest who isn't in the club?",
    keywords: "guest non member visitor add outsider friend stranger",
    steps: [
      "When creating the game, add a guest with their name and handicap index.",
      "Add guests before creating so teams and scoring start with the full field.",
    ],
  },
  {
    q: "How do I record putts and fairways?",
    keywords: "stats putts fairways gir greens penalties track detail record extra",
    steps: [
      "On the hole entry, expand the stats fields.",
      "Add putts, fairway hit, and penalties as you go.",
      "Stats are optional and don't affect the core score.",
    ],
  },
  {
    q: "How do I fix a score I entered wrong?",
    keywords: "fix wrong mistake edit correct change score re-enter undo wrong",
    steps: [
      "Open the same hole on the Scorecard.",
      "Re-enter the correct strokes; it overwrites the old value.",
      "If a marker is keeping score, ask them to fix it, or take over scoring.",
    ],
  },
  {
    q: "What is the maximum score on a hole?",
    keywords: "max maximum net double bogey cap blow up triple highest limit",
    steps: [
      "For handicap, each hole is capped at net double bogey (par + 2 + your strokes on that hole).",
      "In stroke play you record every stroke with no cap, but your handicap still uses the net-double cap behind the scenes.",
    ],
  },
  {
    q: "How do I switch between my clubs?",
    keywords: "switch change club group society multiple active another which",
    steps: [
      "Use the club selector to pick the active club.",
      "Your dashboard and rounds always cover all of your groups together.",
    ],
  },
  {
    q: "What's the difference between split and carryover skins?",
    keywords: "skins split carryover carry over tie share pot difference half",
    steps: [
      "Carry over - a tied hole pushes its skin to the next, building the pot (works for any size field).",
      "Split - each hole is its own prize and a tie shares it evenly (best for up to 4 players).",
    ],
  },
  {
    q: "How do my games count toward my handicap?",
    keywords: "handicap post count round games index differential record toward affect",
    steps: [
      "When a round is finished or ended, it posts to your Rounds tab.",
      "The app uses your posted rounds (best 8 of the last 20) to compute your index.",
      "Each hole is capped at net double bogey for that calculation.",
    ],
  },
];

const STOP = new Set(
  "how do i to the a an and or my me you your is are it of get got can want need help with on for what where when which".split(" "),
);
function norm(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}
function scoreFaq(query: string, e: Faq): number {
  const q = norm(query);
  if (!q) return 0;
  const toks = q.split(" ").filter((t) => t.length > 1 && !STOP.has(t));
  const hay = norm(e.q + " " + e.keywords);
  const hayWords = hay.split(" ");
  let s = 0;
  for (const t of toks) {
    if (hay.includes(t)) s += 2;
    else if (hayWords.some((w) => w.length > 3 && (w.startsWith(t) || t.startsWith(w)))) s += 1;
  }
  if (norm(e.q).includes(q)) s += 3; // whole query is a substring of the question
  return s;
}

type Msg =
  | { role: "user"; text: string }
  | { role: "bot"; faq?: Faq; text?: string; related?: string[]; unanswered?: string };

export function HelpSearch({ onSendQuestion }: { onSendQuestion?: (q: string) => void }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  const ask = (text: string) => {
    const query = text.trim();
    if (!query) return;
    const ranked = FAQ.map((e, i) => ({ i, score: scoreFaq(query, e) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const userMsg: Msg = { role: "user", text: query };
    let botMsg: Msg;
    if (ranked.length && ranked[0].score >= 2) {
      const best = FAQ[ranked[0].i];
      const related = ranked.slice(1, 4).filter((x) => x.score >= 2).map((x) => FAQ[x.i].q);
      botMsg = { role: "bot", faq: best, related };
    } else {
      botMsg = {
        role: "bot",
        text: "I couldn't find a clear answer to that. Try rephrasing, pick one of these, or send it to the team as a question:",
        related: FAQ.slice(0, 6).map((e) => e.q),
        unanswered: query,
      };
    }
    setMsgs((m) => [...m, userMsg, botMsg]);
    setInput("");
  };

  const starters = [
    "How do I create a game?",
    "How do I enter my scores?",
    "How does one person keep score for the group?",
    "How do I set my handicap?",
  ];

  const chip = (q: string, faded?: boolean) => (
    <button
      key={q}
      onClick={() => ask(q)}
      style={{
        background: faded ? "transparent" : C.green,
        color: faded ? C.green : C.sage,
        border: `1px solid ${C.line}`,
        borderRadius: 999,
        fontSize: 11.5,
        padding: "6px 11px",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      {q}
    </button>
  );

  return (
    <div style={{ background: C.greenLight, borderRadius: 14, padding: 16, marginTop: 12 }}>
      <div style={{ color: C.cream, fontFamily: "Georgia, serif", fontSize: 18, fontWeight: 700 }}>
        Ask &ldquo;how do I&hellip;&rdquo;
      </div>
      <div style={{ color: C.sage, fontSize: 12, marginTop: 4 }}>
        Type a question about using the app. Answers are built in &mdash; no internet needed.
      </div>

      <div
        ref={scrollRef}
        style={{ maxHeight: 380, overflowY: "auto", marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}
      >
        {msgs.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
            {starters.map((q) => chip(q))}
          </div>
        )}
        {msgs.map((m, i) =>
          m.role === "user" ? (
            <div
              key={i}
              style={{
                alignSelf: "flex-end",
                maxWidth: "85%",
                background: C.gold,
                color: C.green,
                borderRadius: "14px 14px 4px 14px",
                padding: "9px 13px",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              style={{
                alignSelf: "flex-start",
                maxWidth: "92%",
                background: C.card,
                borderRadius: "14px 14px 14px 4px",
                padding: "11px 14px",
              }}
            >
              {m.faq ? (
                <>
                  <div style={{ color: C.green, fontWeight: 800, fontSize: 13.5, marginBottom: 6 }}>{m.faq.q}</div>
                  <ol style={{ margin: 0, paddingLeft: 18, color: C.ink, fontSize: 12.8, lineHeight: 1.5 }}>
                    {m.faq.steps.map((s, j) => (
                      <li key={j} style={{ marginBottom: 3 }}>
                        {s}
                      </li>
                    ))}
                  </ol>
                </>
              ) : (
                <div style={{ color: C.ink, fontSize: 12.8, lineHeight: 1.5 }}>{m.text}</div>
              )}
              {m.unanswered && onSendQuestion && (
                <button
                  onClick={() => onSendQuestion(m.unanswered!)}
                  style={{ marginTop: 10, background: C.gold, color: C.green, border: "none", borderRadius: 999, fontSize: 12, fontWeight: 800, padding: "7px 13px", cursor: "pointer" }}
                >
                  Send &ldquo;{m.unanswered.length > 32 ? m.unanswered.slice(0, 32) + "\u2026" : m.unanswered}&rdquo; as a question &rarr;
                </button>
              )}
              {m.related && m.related.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-start" }}>
                  <div style={{ color: C.faint, fontSize: 10.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase" }}>
                    Related
                  </div>
                  {m.related.map((q) => chip(q, true))}
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          placeholder="e.g. how do I keep score for everyone?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ask(input);
          }}
        />
        <button onClick={() => ask(input)} style={{ ...btn(true), padding: "0 16px" }}>
          Ask
        </button>
      </div>
    </div>
  );
}
