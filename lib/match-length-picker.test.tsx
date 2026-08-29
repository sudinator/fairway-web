/**
 * The match length picker, rendered.
 *
 * The reported bug was that this did not exist anywhere in the UI — the lib module was built and
 * tested, nothing rendered it, and the deploy notes said it applied "to every format". These
 * assertions pin that it renders, and that the states a two-question picker can get wrong stay
 * wrong-proof.
 */
import { renderScreen, assertReadable, assertTappable, ok, eq, report } from "./screen-harness";
import * as React from "react";
import { MatchLengthPicker } from "@/components/game/match-length-picker";
import { C } from "@/lib/golf";

const course18 = Array.from({ length: 18 }, (_, i) => ({ n: i + 1 }));
const course9 = course18.slice(0, 9);

const render = (props: Partial<React.ComponentProps<typeof MatchLengthPicker>> = {}) =>
  renderScreen(
    <div style={{ background: C.greenLight }}>
      <MatchLengthPicker value="18" onChange={() => {}} courseHoles={course18} {...props} />
    </div>,
    { background: C.greenLight },
  );

// ── it renders at all — the reported defect ────────────────────────────────
{
  const s = render();
  ok(s.text.includes("18 holes"), "offers 18 holes");
  ok(s.text.includes("9 holes"), "offers 9 holes");
  assertReadable(s, "MatchLengthPicker 18");
  assertTappable(s, "MatchLengthPicker 18");
  s.unmount();
}

// ── the second question appears only when it applies ───────────────────────
{
  const s = render({ value: "18" });
  ok(!s.text.includes("Front nine"), "18 does NOT ask which nine");
  ok(!s.text.includes("Back nine"), "18 does not show Back nine either");
  s.unmount();
}
{
  const s = render({ value: "front9" });
  ok(s.text.includes("Front nine"), "9 asks which nine");
  ok(s.text.includes("Back nine"), "and offers both");
  // Hole numbers are the course's own — a back-nine card must read 10-18, or a player looks at
  // "hole 1" while standing on the 10th tee.
  ok(s.text.includes("1\u20139"), "front nine is labelled 1-9");
  ok(s.text.includes("10\u201318"), "back nine is labelled 10-18, NOT renumbered");
  s.unmount();
}

// ── a nine-hole course is not asked ────────────────────────────────────────
{
  const s = render({ courseHoles: course9 });
  eq(s.text.trim(), "", "a nine-hole course gets no picker at all");
  s.unmount();
}

// ── the transitions a two-step picker gets wrong ───────────────────────────
{
  const seen: string[] = [];
  const s = render({ value: "back9", onChange: (n) => seen.push(n) });
  s.click("18 holes");
  eq(seen.join(), "18", "choosing 18 from back9 clears the nine");
  s.unmount();
}
{
  const seen: string[] = [];
  const s = render({ value: "18", onChange: (n) => seen.push(n) });
  s.click("9 holes");
  eq(seen.join(), "front9", "choosing 9 from 18 defaults to the front");
  s.unmount();
}
{
  // Re-picking 9 while already on the back must NOT snap to the front.
  const seen: string[] = [];
  const s = render({ value: "back9", onChange: (n) => seen.push(n) });
  s.click("9 holes");
  eq(seen.join(), "back9", "re-picking 9 keeps the chosen nine");
  s.unmount();
}

// ── locked after scoring: greyed WITH its reason, never hidden ─────────────
{
  const seen: string[] = [];
  const s = render({
    value: "18",
    onChange: (n) => seen.push(n),
    verdict: { allowed: false, reason: "The number of holes is locked once scoring begins." },
  });
  ok(s.text.includes("9 holes"), "a locked picker is still SHOWN");
  ok(s.text.includes("locked once scoring begins"), "and says why");
  const btns = Array.from(s.el.querySelectorAll("button"));
  ok(btns.every((b) => b.disabled), "every option is disabled");
  s.click("9 holes");
  eq(seen.length, 0, "a locked option does not fire onChange");
  s.unmount();
}

report("match length picker");
