/**
 * The format + allowance picker, shared by Create Game and the post-creation Format tab.
 *
 * WHY THIS EXISTS
 * The two screens had grown separate implementations of the same control, and they had drifted:
 *
 *   * the Format tab carried its OWN hardcoded list of game types — an eighth copy of a list that
 *     had already been consolidated seven times — so Alternate Shot appeared in Create Game and
 *     was simply absent after creation
 *   * the tiles were sized differently (minWidth 100 / padding "7px 12px" against 150 / standard),
 *     so the same control looked like two different controls
 *   * Create Game offered a free-text allowance; the Format tab offered three presets and no way
 *     to type a value, so a game could be CREATED at 50% and never corrected back to it
 *
 * One component, driven by the single GAME_TYPES list, fixes all three and means the next format
 * appears in both places or neither.
 *
 * WHAT THE FORMAT TAB HAS THAT CREATE GAME DOES NOT
 * Mid-game legality. Once scores exist, some format changes are refused and some allowances are
 * frozen. Create Game has nothing scored, so everything is legal — which is why the policy hooks
 * are OPTIONAL and default to permitting everything, rather than each caller passing a stub.
 * Losing them would silently let an organiser break a game in progress.
 */
import * as React from "react";
import { btn, inputStyle } from "@/components/ui";
import { C } from "@/lib/golf";
import { GAME_TYPES, type GameType } from "@/lib/game-shape";
import { gameTypeLabel } from "@/lib/game-create";
import { commitAllowance, editAllowance } from "@/lib/handicap-allowance";

/** Which formats belong to which family, derived from one list rather than restated per screen. */
export const STROKE_FAMILY: GameType[] = ["stableford", "stroke", "skins"];
export const MATCH_FAMILY: GameType[] = ["match", "fourball", "alt_shot", "trifecta", "skins"];

export type FormatVerdict = { allowed: boolean; reason?: string };
const ALWAYS_ALLOWED: FormatVerdict = { allowed: true };

export type FormatPickerProps = {
  family: "stroke" | "match";
  current: GameType;
  onPick: (t: GameType) => void;
  /**
   * Mid-game legality. Omitted by Create Game, where nothing is scored and everything is legal.
   * A blocked format is shown GREYED with its reason rather than hidden — an organiser looking for
   * a format that has silently vanished has no way to learn why it is unavailable.
   */
  verdictFor?: (t: GameType) => FormatVerdict;
  /** Restricts the list, e.g. the Format tab offering Match before Four-ball. Defaults to family. */
  types?: GameType[];
};

export function FormatPicker({ family, current, onPick, verdictFor, types }: FormatPickerProps) {
  const list = types ?? (family === "stroke" ? STROKE_FAMILY : MATCH_FAMILY);
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
      {list.map((t) => {
        const isCur = current === t;
        const v = verdictFor && !isCur ? verdictFor(t) : ALWAYS_ALLOWED;
        return (
          <button
            key={t}
            disabled={!v.allowed}
            title={v.allowed ? undefined : v.reason}
            onClick={() => { if (!isCur && v.allowed) onPick(t); }}
            style={{
              ...btn(isCur),
              flex: 1,
              // 150 puts four tiles in a 2x2 on a 393px phone: usable row 337px, so three at 150
              // need 466 (wraps) and two need 308 (fits). Measured, not guessed.
              minWidth: 150,
              fontSize: 13,
              opacity: v.allowed ? 1 : 0.4,
              cursor: v.allowed ? "pointer" : "not-allowed",
            }}
          >
            {gameTypeLabel(t)}
          </button>
        );
      })}
    </div>
  );
}

export type AllowanceProps = {
  value: number | null;
  onPick: (pct: number) => void;
  /** Free-text state, so a half-typed value does not snap back while the organiser types. */
  text: string;
  onText: (s: string) => void;
  /** Mid-game legality per preset. Omitted by Create Game. */
  blocked?: (pct: number) => FormatVerdict;
  note?: React.ReactNode;
};

/**
 * Allowance presets plus a free-text field.
 *
 * 50 is a preset because it is alternate shot's defined allowance — without it a game created in
 * that format could not be corrected back to it after creation, which is exactly the gap that was
 * reported. The free-text field is what the Format tab was missing entirely.
 */
export const ALLOWANCE_PRESETS = [100, 90, 85, 50];

export function AllowancePicker({ value, onPick, text, onText, blocked, note }: AllowanceProps) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: C.sage, fontSize: 12 }}>Handicap allowance</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
        {ALLOWANCE_PRESETS.map((amt) => {
          const v = blocked ? blocked(amt) : ALWAYS_ALLOWED;
          return (
            <button
              key={amt}
              disabled={!v.allowed}
              title={v.allowed ? undefined : v.reason}
              onClick={() => { if (v.allowed) { onPick(amt); onText(String(amt)); } }}
              style={{
                ...btn(value === amt),
                fontSize: 13,
                opacity: v.allowed ? 1 : 0.4,
                cursor: v.allowed ? "pointer" : "not-allowed",
              }}
            >
              {amt}%
            </button>
          );
        })}
        <input
          value={text}
          onChange={(e) => onText(editAllowance(e.target.value).text)}
          onBlur={() => { const c = commitAllowance(text); onText(c.text); onPick(c.pct); }}
          inputMode="numeric"
          aria-label="Handicap allowance percent"
          style={{ ...inputStyle, width: 76, textAlign: "center" }}
        />
        <span style={{ color: C.sage, fontSize: 12 }}>%</span>
      </div>
      {note}
    </div>
  );
}
