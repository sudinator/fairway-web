function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { shortLabels, shortNamer } from "./short-names";

// No collision: first names, as before.
eq(shortLabels(["Amit Sud", "Bob Jones", "Carl Diaz"]).join("|"), "Amit|Bob|Carl", "unique first names stay first names");
// Two Amits with different initials.
eq(shortLabels(["Amit Sud", "Amit Bhatia", "Bob Jones"]).join("|"), "Amit S|Amit B|Bob", "collision → first + last initial; others untouched");
// Amit's game: three Amits, two of whom share the initial S → those two spelled out, the third keeps the initial.
eq(shortLabels(["Amit Sud", "Amit Bhatia", "Amit Shah", "Bob Jones"]).join("|"), "Amit Sud|Amit B|Amit Shah|Bob", "initial still collides → full name for those two only");
// Single-word names.
eq(shortLabels(["Amit", "Amit Sud"]).join("|"), "Amit|Amit S", "a single-word name cannot take an initial; the other disambiguates");
// Case and spacing do not defeat the collision test; the label keeps the person's own spelling.
eq(shortLabels(["amit  sud", "Amit Bhatia"]).join("|"), "amit S|Amit B", "normalised for comparison only");
// Per-set: the same person is "Amit" in a foursome without another Amit.
eq(shortLabels(["Amit Sud", "Bob Jones"]).join("|"), "Amit|Bob", "decided within the set shown");
// shortNamer: build once per surface, look up by player or by name; unknown names fall back to first name.
{
  const s = shortNamer([{ display_name: "Amit Sud" }, { display_name: "Amit Bhatia" }, { display_name: "Bob Jones" }]);
  eq(s({ display_name: "Amit Sud" }), "Amit S", "by player");
  eq(s("Bob Jones"), "Bob", "by name");
  eq(s("Dan Lee"), "Dan", "not in set → first name");
  eq(s(null, "opponent"), "opponent", "fallback");
}
console.log("short-names tests passed");
