/** 212.74 (owner, Oct 30): the Cup roster row — the avatar shows, the name keeps at least 10 characters, the team
 *  buttons carry short labels so a long team name never squeezes the name. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { CupRosterRow, shortTeamLabel } from "@/components/competitions";
ok(shortTeamLabel("Hawks", "Team 2") === "Hawks" && shortTeamLabel("Americas", "Team 1") === "Amer" && shortTeamLabel("The Magnificent Eagles", "Team 1") === "Magn" && shortTeamLabel("", "Team 1") === "Team 1",
  `short labels: Hawks / Amer / Magn / Team 1 (got ${[shortTeamLabel("Hawks", "x"), shortTeamLabel("Americas", "x"), shortTeamLabel("The Magnificent Eagles", "x"), shortTeamLabel("", "Team 1")].join(" / ")})`);
const t = renderScreen(<CupRosterRow p={{ id: "u1", display_name: "Christopher Alexander Reed", handicap_index: 12.4, avatar_url: "https://example.test/a.png" }} t="A" playing
  teamA="The Magnificent Eagles of Essex County" teamB="Hawks of Livingston and Short Hills" onIn={() => {}} onOut={() => {}} onAssign={() => {}} />);
ok(!!t.el.querySelector("img[src='https://example.test/a.png']"), "the avatar picture shows");
const name = t.el.querySelector("[data-cup-roster-name]") as HTMLElement;
ok(name && name.parentElement?.style.minWidth === "10ch", "the name keeps at least 10 characters before truncating");
ok((t.el.querySelector("[data-cup-team-btn=A]")?.textContent || "") === "Magn" && (t.el.querySelector("[data-cup-team-btn=B]")?.textContent || "") === "Hawk", "the team buttons carry the short labels");
ok(t.el.querySelector("[data-cup-team-btn=A]")?.getAttribute("title") === "The Magnificent Eagles of Essex County", "the full team name is the button's title");
t.unmount();
report("cup roster row");
