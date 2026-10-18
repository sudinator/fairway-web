// Choose which provider changes to apply (209.1). One place turns the provider's differences into tick-box
// items and builds the merged course from the ticked ones — the review screen, the server route that applies
// them, and the course check (which skips declined changes) all use this, so they can never disagree.
//
// Owner rules (Oct 2026):
//   * each change is its own item; ALL stroke-index changes are ONE item (providers swap indexes between
//     holes — taking half a swap leaves two holes on the same index and breaks handicap strokes);
//   * a change to something corrected by hand, and a removed tee, start UNticked; everything else ticked;
//   * an unticked change is remembered (its key + the provider value) and not offered again unless the
//     provider's value changes.
import type { Course, CourseTee } from "@/lib/courses";
import { buildFreshnessDiff, sameValue } from "@/lib/course-diff";

export type ChangeKind = "rating" | "slope" | "yardages" | "tee_add" | "tee_remove" | "par" | "si";
export type ChangeItem = {
  key: string;
  kind: ChangeKind;
  label: string;          // "Blue tees · slope 125 → 128"
  detail?: string;        // second line: "rating 66.8 · slope 117 · 5,410 yds"
  apiValue: unknown;      // what the provider says — remembered when declined
  handCorrected: boolean; // the current value differs from the provider's last version
  defaultOn: boolean;
};

const tk = (n: unknown) => String(n ?? "").trim().toLowerCase();
const teeOf = (c: Course | null | undefined, name: string) => (c?.tees || []).find((t) => tk(t.name) === tk(name));
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const fmt = (v: unknown) => (v == null || v === "" ? "—" : String(v));

/**
 * The tick-box items for a provider update. `lastProvider` is the course as the provider last supplied it
 * (from course history): where today's value differs from it, someone corrected it by hand.
 */
export function changeItems(stored: Course, api: Course, lastProvider?: Course | null): ChangeItem[] {
  const d = buildFreshnessDiff(stored, api);
  const items: ChangeItem[] = [];
  const corrected = (fn: (c: Course) => unknown) => !!lastProvider && !same(fn(stored), fn(lastProvider));
  for (const t of d.tees) {
    if (t.ratingChanged) {
      const hc = corrected((c) => teeOf(c, t.name)?.rating ?? null);
      items.push({ key: `rating:${tk(t.name)}`, kind: "rating", label: `${t.name} tees · rating ${fmt(t.ratingFrom)} → ${fmt(t.ratingTo)}`, apiValue: t.ratingTo, handCorrected: hc, defaultOn: !hc });
    }
    if (t.slopeChanged) {
      const hc = corrected((c) => teeOf(c, t.name)?.slope ?? null);
      items.push({ key: `slope:${tk(t.name)}`, kind: "slope", label: `${t.name} tees · slope ${fmt(t.slopeFrom)} → ${fmt(t.slopeTo)}`, apiValue: t.slopeTo, handCorrected: hc, defaultOn: !hc });
    }
    if (t.yardageChanges.length) {
      const hc = corrected((c) => teeOf(c, t.name)?.yardages ?? null);
      const n = t.yardageChanges.length;
      items.push({ key: `yardages:${tk(t.name)}`, kind: "yardages", label: `${t.name} tees · yardages on ${n} hole${n === 1 ? "" : "s"}`,
        detail: t.yardageChanges.slice(0, 4).map((y) => `${y.hole}: ${fmt(y.from)} → ${fmt(y.to)}`).join(" · ") + (n > 4 ? " …" : ""),
        apiValue: teeOf(api, t.name)?.yardages ?? null, handCorrected: hc, defaultOn: !hc });
    }
  }
  for (const name of d.teesAdded || []) {
    const t = teeOf(api, name) as CourseTee;
    const yds = (t?.yardages || []).reduce((s: number, y) => s + (Number(y) || 0), 0);
    items.push({ key: `tee_add:${tk(name)}`, kind: "tee_add", label: `New tees: ${name}`,
      detail: `rating ${fmt(t?.rating)} · slope ${fmt(t?.slope)}${yds ? ` · ${yds.toLocaleString()} yds` : ""}`, apiValue: t ?? null, handCorrected: false, defaultOn: true });
  }
  for (const name of d.teesRemoved || []) {
    // A tee the provider never had was added by hand — doubly worth keeping.
    const hc = !!lastProvider && !teeOf(lastProvider, name);
    items.push({ key: `tee_remove:${tk(name)}`, kind: "tee_remove", label: `${name} tees removed`, apiValue: null, handCorrected: hc, defaultOn: false });
  }
  for (const h of d.holeChanges || []) {
    if (!sameValue(h.parFrom, h.parTo)) {
      const hc = corrected((c) => c.holes?.[h.hole - 1]?.par ?? null);
      items.push({ key: `par:${h.hole}`, kind: "par", label: `Hole ${h.hole} · par ${fmt(h.parFrom)} → ${fmt(h.parTo)}`, apiValue: h.parTo, handCorrected: hc, defaultOn: !hc });
    }
  }
  const siHoles = (d.holeChanges || []).filter((h) => !sameValue(h.siFrom, h.siTo));
  if (siHoles.length) {
    const hc = corrected((c) => (c.holes || []).map((x) => x.si ?? null));
    items.push({ key: "si", kind: "si", label: `Stroke indexes on ${siHoles.length} hole${siHoles.length === 1 ? "" : "s"}`,
      detail: siHoles.map((h) => `${h.hole}: ${fmt(h.siFrom)} → ${fmt(h.siTo)}`).join(" · "),
      apiValue: (api.holes || []).map((x) => x.si ?? null), handCorrected: hc, defaultOn: !hc });
  }
  return items;
}

/** Items still worth asking about: a declined change is skipped while the provider's value stays the same. */
export function withoutDeclined(items: ChangeItem[], declined: Record<string, unknown> | null | undefined): ChangeItem[] {
  if (!declined) return items;
  return items.filter((it) => !(it.key in declined) || !same(declined[it.key], it.apiValue));
}

/** What to remember when these items are left unticked: key → the provider value declined. */
export function declinedFor(items: ChangeItem[], selected: string[]): Record<string, unknown> {
  const sel = new Set(selected);
  return Object.fromEntries(items.filter((it) => !sel.has(it.key)).map((it) => [it.key, it.apiValue ?? null]));
}

/** The course with ONLY the selected provider changes applied. Throws on a key that isn't on offer. */
export function mergeSelected(stored: Course, api: Course, selected: string[], items = changeItems(stored, api)): Course {
  const offered = new Set(items.map((i) => i.key));
  for (const k of selected) if (!offered.has(k)) throw new Error(`not an offered change: ${k}`);
  const sel = new Set(selected);
  let tees: CourseTee[] = (stored.tees || []).map((t) => ({ ...t, yardages: t.yardages ? [...t.yardages] : t.yardages }));
  for (const t of tees) {
    const a = teeOf(api, t.name);
    if (!a) continue;
    if (sel.has(`rating:${tk(t.name)}`)) t.rating = a.rating;
    if (sel.has(`slope:${tk(t.name)}`)) t.slope = a.slope;
    if (sel.has(`yardages:${tk(t.name)}`)) t.yardages = a.yardages ? [...a.yardages] : a.yardages;
  }
  tees = tees.filter((t) => !sel.has(`tee_remove:${tk(t.name)}`));
  for (const a of api.tees || []) if (sel.has(`tee_add:${tk(a.name)}`) && !teeOf({ tees } as Course, a.name)) tees.push({ ...a, yardages: a.yardages ? [...a.yardages] : a.yardages });
  const holes = (stored.holes || []).map((h, i) => {
    const a = api.holes?.[i];
    return { ...h, ...(a && sel.has(`par:${i + 1}`) ? { par: a.par } : {}), ...(a && sel.has("si") ? { si: a.si } : {}) };
  });
  return { ...stored, tees, holes };
}
