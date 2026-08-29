/**
 * Match length picker — "how many holes?", then "which nine?".
 *
 * Two questions rather than one three-way choice, so 18 stays the obvious default instead of
 * being one option among three, and the second question only appears when it applies.
 *
 * Used by Create Game and by the post-creation Format tab. After creation the length is editable
 * until the first score and locked afterwards — scores are stored positionally against
 * holes_meta, so shortening an 18-hole game once someone has played the 12th would orphan those
 * entries. `verdict` carries that; Create Game omits it because nothing is scored yet.
 *
 * A nine-hole course gets no picker at all: there is one nine and it is the course, so asking
 * would be nonsense and answering "back" would have to mean "all of it".
 */
import * as React from "react";
import { btn } from "@/components/ui";
import { C } from "@/lib/golf";
import {
  type MatchLength,
  holeCountOf,
  needsNineChoice,
  setHoleCount,
  setNine,
  canChooseNine,
  holesForLength,
  holeNumberOf,
} from "@/lib/match-length";

export type MatchLengthVerdict = { allowed: boolean; reason?: string };
const ALLOWED: MatchLengthVerdict = { allowed: true };

export type MatchLengthPickerProps = {
  value: MatchLength;
  onChange: (next: MatchLength) => void;
  /** The course's holes, to decide whether a nine can be chosen and to label the ranges. */
  /** Course holes use `n`; round holes use `hole_number`. holeNumberOf reads either. */
  courseHoles: { n?: number | null; hole_number?: number | null }[];
  /** Mid-game legality. Omitted by Create Game. */
  verdict?: MatchLengthVerdict;
};

export function MatchLengthPicker({ value, onChange, courseHoles, verdict }: MatchLengthPickerProps) {
  const v = verdict ?? ALLOWED;
  // Nothing to ask on a nine-hole course. Rendering a disabled picker would imply a choice exists.
  if (!canChooseNine(courseHoles)) return null;

  const count = holeCountOf(value);
  const showNine = needsNineChoice(value);
  const rangeOf = (l: MatchLength) => {
    const hs = holesForLength(courseHoles, l);
    const a = holeNumberOf(hs[0]);
    const b = holeNumberOf(hs[hs.length - 1]);
    return a != null && b != null ? `${a}\u2013${b}` : "";
  };

  const tile = (label: string, sub: string, active: boolean, onClick: () => void) => (
    <button
      disabled={!v.allowed}
      title={v.allowed ? undefined : v.reason}
      onClick={() => { if (v.allowed) onClick(); }}
      style={{
        ...btn(active),
        flex: 1,
        minWidth: 150,
        fontSize: 13,
        opacity: v.allowed ? 1 : 0.4,
        cursor: v.allowed ? "pointer" : "not-allowed",
      }}
    >
      {label}
      {sub ? <span style={{ opacity: 0.75, fontWeight: 700 }}>{` \u00b7 ${sub}`}</span> : null}
    </button>
  );

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ color: C.sage, fontSize: 12 }}>Holes</div>
      <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        {tile("18 holes", "", count === "18", () => onChange(setHoleCount(value, "18")))}
        {tile("9 holes", "", count === "9", () => onChange(setHoleCount(value, "9")))}
      </div>

      {/* Only once "9" is chosen. Asking up front would make 18 look like one of three options. */}
      {showNine && (
        <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
          {tile("Front nine", rangeOf("front9"), value === "front9", () => onChange(setNine("front9")))}
          {tile("Back nine", rangeOf("back9"), value === "back9", () => onChange(setNine("back9")))}
        </div>
      )}

      <div style={{ color: C.sage, fontSize: 11, marginTop: 4 }}>
        {!v.allowed
          ? v.reason
          : showNine
          ? "Course handicaps are halved for a nine. Hole numbers stay as they are on the course."
          : "The full round."}
      </div>
    </div>
  );
}
