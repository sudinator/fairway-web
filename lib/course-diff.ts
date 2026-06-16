import type { Course } from "@/lib/courses";
import { courseLabel } from "@/lib/courses";

function normalizeText(v: any): string {
  return String(v ?? "").trim();
}

function sameValue(a: any, b: any): boolean {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return true;
  const na = Number(a), nb = Number(b);
  if ((Number.isFinite(na) && normalizeText(a) !== "") || (Number.isFinite(nb) && normalizeText(b) !== "")) {
    return Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 0.001;
  }
  return normalizeText(a) === normalizeText(b);
}

function changeLine(label: string, before: any, after: any): string | null {
  if (sameValue(before, after)) return null;
  const b = normalizeText(before) || "—";
  const a = normalizeText(after) || "—";
  return `${label}: ${b} → ${a}`;
}

function holeNumber(h: any, fallback: number): number {
  const n = Number(h?.n ?? h?.hole_number ?? h?.holeNumber ?? h?.number ?? h?.hole ?? fallback);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function holeStrokeIndex(h: any): number | null {
  const v = h?.si ?? h?.stroke_index ?? h?.strokeIndex ?? h?.handicap ?? h?.hcp ?? null;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeHoleForDiff(h: any, fallback: number): { n: number; par: any; si: any } {
  return { n: holeNumber(h, fallback), par: h?.par ?? null, si: holeStrokeIndex(h) };
}

function normalizeHolesForDiff(holes: any[] | undefined | null): { n: number; par: any; si: any }[] {
  return (holes || []).map((h, i) => normalizeHoleForDiff(h, i + 1));
}

function holesFromCourse(course: any): { n: number; par: any; si: any }[] {
  const direct = normalizeHolesForDiff(course?.holes);
  if (direct.length) return direct;
  const teeWithHoles = Array.isArray(course?.tees) ? course.tees.find((t: any) => Array.isArray(t?.holes) && t.holes.length) : null;
  return normalizeHolesForDiff(teeWithHoles?.holes);
}

function normalizeTeesForDiff(tees: any[] | undefined | null): any[] {
  return (tees || []).map((t, i) => ({
    key: normalizeText(t?.name ?? t?.tee_name ?? t?.teeName ?? `Tee ${i + 1}`).toLowerCase() || `tee-${i + 1}`,
    name: t?.name ?? t?.tee_name ?? t?.teeName ?? "",
    rating: t?.rating ?? t?.course_rating ?? t?.courseRating ?? null,
    slope: t?.slope ?? t?.slope_rating ?? t?.slopeRating ?? null,
    par: t?.par ?? t?.par_total ?? t?.parTotal ?? null,
    holes: normalizeHolesForDiff(t?.holes),
  }));
}

function courseDisplayName(c: any): string {
  if (!c) return "";
  return courseLabel(c as Course);
}

function addUniqueLine(lines: string[], line: string | null) {
  if (line && !lines.includes(line)) lines.push(line);
}

function compareHoleSets(lines: string[], prefix: string, currentHoles: { n: number; par: any; si: any }[], proposedHoles: { n: number; par: any; si: any }[]) {
  const byCurrentHole = new Map(currentHoles.map((h) => [h.n, h]));
  const byProposedHole = new Map(proposedHoles.map((h) => [h.n, h]));
  const holeNums = Array.from(new Set([...Array.from(byCurrentHole.keys()), ...Array.from(byProposedHole.keys())])).sort((a, b) => a - b);
  for (const n of holeNums) {
    const before = byCurrentHole.get(n);
    const after = byProposedHole.get(n);
    const label = prefix ? `${prefix} hole ${n}` : `Hole ${n}`;
    if (!before && after) { addUniqueLine(lines, `Added ${label}: par ${after.par ?? "—"}, S.I. ${after.si ?? "—"}`); continue; }
    if (before && !after) { addUniqueLine(lines, `Removed ${label}`); continue; }
    if (!before || !after) continue;
    addUniqueLine(lines, changeLine(`${label} par`, before.par, after.par));
    addUniqueLine(lines, changeLine(`${label} stroke index`, before.si ?? "—", after.si ?? "—"));
  }
}

export function courseChangeLines(current: Course | null | undefined, proposed: Course | null | undefined): string[] {
  if (!proposed) return ["No proposed course data was included with this request."];
  if (!current) return ["New or missing global baseline — review the proposed course details before approval."];
  const lines: string[] = [];
  const add = (line: string | null) => addUniqueLine(lines, line);

  add(changeLine("Display name", courseDisplayName(current), courseDisplayName(proposed)));
  add(changeLine("Course name", (current as any).name, (proposed as any).name));
  add(changeLine("Location", (current as any).location, (proposed as any).location));
  add(changeLine("Facility/club", (current as any).club ?? (current as any).facility, (proposed as any).club ?? (proposed as any).facility));
  add(changeLine("External course ID", (current as any).externalId ?? (current as any).external_id, (proposed as any).externalId ?? (proposed as any).external_id));
  add(changeLine("Corrected flag", (current as any).corrected, (proposed as any).corrected));

  const currentTees = normalizeTeesForDiff((current as any).tees);
  const proposedTees = normalizeTeesForDiff((proposed as any).tees);
  const maxTees = Math.max(currentTees.length, proposedTees.length);
  for (let i = 0; i < maxTees; i++) {
    const before = currentTees[i];
    const after = proposedTees[i];
    const label = after?.name || before?.name || `Tee ${i + 1}`;
    if (!before && after) { add(`Added tee ${label}: rating ${after.rating ?? "—"}, slope ${after.slope ?? "—"}, par ${after.par ?? "—"}`); continue; }
    if (before && !after) { add(`Removed tee ${label}`); continue; }
    if (!before || !after) continue;
    add(changeLine(`${label} tee name`, before.name, after.name));
    add(changeLine(`${label} rating`, before.rating, after.rating));
    add(changeLine(`${label} slope`, before.slope, after.slope));
    add(changeLine(`${label} tee par`, before.par, after.par));
  }

  // Compare tee-specific holes by position first. This catches a common edit flow
  // where the user renames a tee and also changes nested hole data in that same tee.
  for (let i = 0; i < maxTees; i++) {
    const before = currentTees[i];
    const after = proposedTees[i];
    if (before && after && (before.holes.length || after.holes.length)) {
      const label = after.name || before.name || `Tee ${i + 1}`;
      compareHoleSets(lines, `${label} tee`, before.holes, after.holes);
    }
  }

  // Also compare tee-specific holes by normalized tee name/key. This catches
  // reordered tees when the tee name stayed the same. addUniqueLine prevents
  // duplicate lines when index and key matching both find the same change.
  const currentByKey = new Map(currentTees.map((t, i) => [t.key || `idx-${i}`, t]));
  const proposedByKey = new Map(proposedTees.map((t, i) => [t.key || `idx-${i}`, t]));
  const teeKeys = Array.from(new Set([...Array.from(currentByKey.keys()), ...Array.from(proposedByKey.keys())]));
  for (const key of teeKeys) {
    const before = currentByKey.get(key);
    const after = proposedByKey.get(key);
    if (before && after && (before.holes.length || after.holes.length)) {
      const label = after.name || before.name || "Tee";
      compareHoleSets(lines, `${label} tee`, before.holes, after.holes);
    }
  }

  compareHoleSets(lines, "", holesFromCourse(current), holesFromCourse(proposed));

  const fallbackChanged = JSON.stringify(current) !== JSON.stringify(proposed);
  return lines.length ? lines : [fallbackChanged ? "Underlying course data changed, but no mapped field-level difference was detected. Review the side-by-side course details before approval." : "No material field changes detected versus the current global course record."];
}

export function buildCourseChangeSummary(current: Course | null | undefined, proposed: Course | null | undefined): string {
  return courseChangeLines(current, proposed).join("\n").slice(0, 4000);
}
