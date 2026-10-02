"use client";
import { C } from "@/lib/golf";
import type { FreshnessDiff } from "@/lib/course-diff";

// The ONE rendering of a course freshness diff. Used by the New Round sheet and by the Courses
// "Needs review" section, so an admin sees the same list in both places (0165).
export function FreshnessDiffList({ diff, maxHeight = 260 }: { diff: FreshnessDiff; maxHeight?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight, overflowY: "auto" }}>
      {diff.tees.map((t) => (
        <div key={t.name} style={{ background: C.green, borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ color: C.gold, fontWeight: 800, fontSize: 12, letterSpacing: 1, marginBottom: 4 }}>{t.name}</div>
          {t.ratingChanged && <div style={{ color: C.cream, fontSize: 12.5 }}>Rating: {t.ratingFrom ?? "—"} → <b>{t.ratingTo ?? "—"}</b></div>}
          {t.slopeChanged && <div style={{ color: C.cream, fontSize: 12.5 }}>Slope: {t.slopeFrom ?? "—"} → <b>{t.slopeTo ?? "—"}</b></div>}
          {t.yardageChanges.map((y) => (
            <div key={y.hole} style={{ color: C.sage, fontSize: 12.5 }}>Hole {y.hole}: {y.from ?? "—"} → <b style={{ color: C.cream }}>{y.to ?? "—"}</b> yds</div>
          ))}
        </div>
      ))}
    </div>
  );
}
