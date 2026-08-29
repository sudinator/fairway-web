/**
 * The shared format + allowance picker.
 *
 * These pin the three defects that prompted it, each reported from staging:
 *   * Alternate Shot appeared in Create Game and was ABSENT from the Format tab, because the tab
 *     carried its own hardcoded list — an eighth copy of the game types
 *   * the tiles were sized differently, so the same control looked like two controls
 *   * the Format tab had presets only, with no free-text field and no 50 — so a game created as
 *     alternate shot could never be corrected back to its defined allowance
 */
import { renderScreen, assertReadable, assertTappable, ok, eq, report } from "./screen-harness";
import * as React from "react";
import { FormatPicker, AllowancePicker, ALLOWANCE_PRESETS, MATCH_FAMILY, STROKE_FAMILY } from "@/components/game/format-picker";
import { C } from "@/lib/golf";

// ── the format list comes from GAME_TYPES, not a local copy ────────────────
{
  const s = renderScreen(
    <div style={{ background: C.greenLight }}>
      <FormatPicker family="match" current="match" onPick={() => {}} />
    </div>,
    { background: C.greenLight },
  );
  // The reported bug, pinned: this is what was missing after creation.
  ok(s.text.includes("Alternate Shot"), "match family offers Alternate Shot");
  for (const label of ["Match Play", "Four-Ball", "Trifecta", "Skins"]) {
    ok(s.text.includes(label), `match family still offers ${label}`);
  }
  assertReadable(s, "FormatPicker match");
  assertTappable(s, "FormatPicker match");
  s.unmount();
}
{
  const s = renderScreen(
    <div style={{ background: C.greenLight }}>
      <FormatPicker family="stroke" current="stableford" onPick={() => {}} />
    </div>,
    { background: C.greenLight },
  );
  ok(!s.text.includes("Alternate Shot"), "stroke family does NOT offer Alternate Shot");
  ok(s.text.includes("Stableford"), "stroke family offers Stableford");
  s.unmount();
}

// ── a blocked format is GREYED WITH ITS REASON, never hidden ───────────────
// An option that silently vanishes teaches nobody why. This is the behaviour the Format tab has
// and Create Game does not, and it must survive the extraction.
{
  const picked: string[] = [];
  const s = renderScreen(
    <div style={{ background: C.greenLight }}>
      <FormatPicker
        family="match"
        current="fourball"
        onPick={(t) => picked.push(t)}
        verdictFor={(t) => t === "alt_shot"
          ? { allowed: false, reason: "Scores are in — can't switch to a one-ball format." }
          : { allowed: true }}
      />
    </div>,
    { background: C.greenLight },
  );
  ok(s.text.includes("Alternate Shot"), "a blocked format is still SHOWN");
  const btns = Array.from(s.el.querySelectorAll("button"));
  const blocked = btns.find((b) => (b.textContent || "").includes("Alternate Shot"))!;
  ok(blocked.disabled, "a blocked format is disabled");
  ok((blocked.getAttribute("title") || "").includes("Scores are in"), "the reason is on the control");
  // The current format is never blocked by its own verdict — you cannot be blocked from where you are.
  const cur = btns.find((b) => (b.textContent || "").includes("Four-Ball"))!;
  ok(!cur.disabled, "the current format is never disabled");
  s.click("Trifecta");
  eq(picked.length, 1, "an allowed format still fires onPick");
  s.unmount();
}

// ── allowance: presets INCLUDING 50, plus a free-text field ────────────────
{
  ok(ALLOWANCE_PRESETS.includes(50), "50 is a preset — alternate shot's defined allowance");
  ok(ALLOWANCE_PRESETS.includes(100), "100 is a preset");

  const picks: number[] = [];
  let text = "50";
  const s = renderScreen(
    <div style={{ background: C.greenLight }}>
      <AllowancePicker value={50} onPick={(p) => picks.push(p)} text={text} onText={(t) => { text = t; }} />
    </div>,
    { background: C.greenLight },
  );
  // The gap that was reported: no way to type a value after creation.
  ok(s.el.querySelector("input") !== null, "a free-text field is present");
  ok(s.text.includes("50%"), "the 50% preset is on screen");
  s.click("85%");
  eq(picks.join(), "85", "tapping a preset sets it");
  assertReadable(s, "AllowancePicker");
  assertTappable(s, "AllowancePicker");
  s.unmount();
}
{
  // A blocked preset is greyed with its reason, same rule as formats.
  const s = renderScreen(
    <div style={{ background: C.greenLight }}>
      <AllowancePicker value={100} onPick={() => {}} text="100" onText={() => {}}
        blocked={(p) => p === 50 ? { allowed: false, reason: "Scores are in." } : { allowed: true }} />
    </div>,
    { background: C.greenLight },
  );
  const b50 = Array.from(s.el.querySelectorAll("button")).find((b) => b.textContent === "50%")!;
  ok(b50.disabled, "a blocked preset is disabled");
  ok((b50.getAttribute("title") || "").includes("Scores are in"), "its reason is on the control");
  s.unmount();
}

// Both families are drawn from one list, so a new format cannot reach one screen and not the other.
ok(MATCH_FAMILY.includes("alt_shot"), "alt_shot is in the match family");
ok(!STROKE_FAMILY.includes("alt_shot"), "alt_shot is not in the stroke family");

report("format picker");
