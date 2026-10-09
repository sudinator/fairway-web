// The ONE rule for how a player's name is shortened wherever names sit side by side (202.2).
//
// First name alone, as before — unless it collides within the set being shown. Then first name +
// last initial ("Amit S", "Amit B"). If THAT still collides ("Amit S" twice), the full name. A game
// with three Amits showed three "Amit"s on the scorecard; the rule is decided per set, so the same
// person can be "Amit" in one foursome and "Amit S" on the full leaderboard — which is what a
// human would do.
//
// Single-word names stay as they are. Whitespace and case are normalised for the collision test
// only; the label keeps the person's own spelling.

export type Named = { display_name?: string | null; name?: string | null };

const nameOf = (p: Named | string | null | undefined): string => {
  const n = typeof p === "string" ? p : (p?.display_name ?? p?.name ?? "");
  return (n || "").trim().replace(/\s+/g, " ");
};
const first = (n: string) => n.split(" ")[0] || n;
const initial = (n: string) => { const parts = n.split(" "); return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}` : parts[0]; };
const key = (s: string) => s.toLowerCase();

/** Labels for each name in `names`, in the same order, disambiguated within the set. */
export function shortLabels(names: Array<Named | string | null | undefined>): string[] {
  const full = names.map(nameOf);
  const count = (labels: string[]) => { const m = new Map<string, number>(); for (const l of labels) m.set(key(l), (m.get(key(l)) || 0) + 1); return m; };
  const firsts = full.map(first);
  const firstCount = count(firsts);
  const step2 = full.map((n, i) => (firstCount.get(key(firsts[i])) || 0) > 1 ? initial(n) : firsts[i]);
  const step2Count = count(step2);
  return full.map((n, i) => {
    if ((firstCount.get(key(firsts[i])) || 0) <= 1) return firsts[i];
    if ((step2Count.get(key(step2[i])) || 0) <= 1) return step2[i];
    return n;
  });
}

/** A function from a player (or name) to its label within `set`. Build it once per surface. */
export function shortNamer<T extends Named | string>(set: Array<T | null | undefined>): (p: Named | string | null | undefined, fallback?: string) => string {
  const members = set.filter((x): x is T => x != null);
  const labels = shortLabels(members);
  const byFull = new Map<string, string>();
  members.forEach((m, i) => { const k = key(nameOf(m)); if (!byFull.has(k)) byFull.set(k, labels[i]); });
  return (p, fallback = "—") => {
    const n = nameOf(p);
    if (!n) return fallback;
    return byFull.get(key(n)) ?? first(n);
  };
}
