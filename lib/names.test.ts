/** 212.48 — every setup list of players to pick from is alphabetical by first name (owner, Oct 26). */
import { ok, report } from "./screen-harness";
import { sortByName } from "@/lib/names";
const names = (xs: { display_name: string }[]) => sortByName(xs).map((x) => x.display_name).join(" | ");
ok(names([{ display_name: "Sam Lee" }, { display_name: "amit Sud" }, { display_name: "Bo Li" }, { display_name: "Álvaro Díaz" }]) === "Álvaro Díaz | amit Sud | Bo Li | Sam Lee", `by first name, ignoring capitals and accents (got ${names([{ display_name: "Sam Lee" }, { display_name: "amit Sud" }, { display_name: "Bo Li" }, { display_name: "Álvaro Díaz" }])})`);
ok(names([{ display_name: "Raj Patel" }, { display_name: "Raj Mehta" }]) === "Raj Mehta | Raj Patel", "same first name: then the rest of the name");
const orig = [{ display_name: "b" }, { display_name: "a" }]; sortByName(orig);
ok(orig[0].display_name === "b", "it returns a new list and leaves the original alone");
report("names");
