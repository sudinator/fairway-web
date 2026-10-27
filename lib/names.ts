/**
 * 212.48 (owner, Oct 26): "when picking teams, rather than a random order, make it alphabetical by name so it is easier
 * to find on the screen … even when you list names, make it alphabetical from first name". ONE rule for every setup list
 * of players to pick from: by the name as written (so first name first), ignoring capitals and accents.
 */
type Named = { display_name?: string | null };
export const byName = (a: Named, b: Named): number =>
  (a.display_name ?? "").localeCompare(b.display_name ?? "", undefined, { sensitivity: "base" });
export const sortByName = <T extends Named>(xs: readonly T[]): T[] => [...xs].sort(byName);
