/** 212.70 — test clubs' games don't exist for stats (lib/test-clubs). */
import { ok, report } from "./screen-harness";
import { withoutTestClubs } from "@/lib/test-clubs";
const games = [{ id: "1", group_id: "club" }, { id: "2", group_id: "test" }, { id: "3", group_id: null }, { id: "4", group_id: "test" }];
ok(withoutTestClubs(games, new Set(["test"])).map((g) => g.id).join(",") === "1,3", "a test club's games are dropped; club games and clubless games stay");
ok(withoutTestClubs(games, new Set()).length === 4, "no test clubs: nothing dropped");
report("test clubs");
