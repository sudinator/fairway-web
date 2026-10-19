/** RENDERED CHECK (209.4): the team colour dot, as the owner-approved mock. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { TeamColourDot } from "@/components/team-colour-dot";

function Two({ names }: { names: [string, string] }) {
  const [colors, setColors] = React.useState<[string | null, string | null]>([null, null]);
  const teams: [{ name: string; color: string | null }, { name: string; color: string | null }] = [{ name: names[0], color: colors[0] }, { name: names[1], color: colors[1] }];
  return <div data-colours={JSON.stringify(colors)}>
    {([0, 1] as const).map((i) => <TeamColourDot key={i} index={i} teams={teams} onChange={setColors}><span>{names[i]}</span></TeamColourDot>)}
  </div>;
}
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });
const colours = (el: Element) => el.querySelector("[data-colours]")?.getAttribute("data-colours");

(async () => {
  const t = renderScreen(<Two names={["Eagles", "Hawks"]} />);
  const txt = () => t.el.textContent || "";
  ok(txt().includes("Blue · automatic") && txt().includes("Gold · automatic"), "automatic colours say so");
  await act(async () => { (t.el.querySelector('[data-team-colour="0"] button') as HTMLButtonElement).click(); });
  ok(!!t.el.querySelector("[data-colour-picker]"), "tapping the dot opens the five colours");
  ok(t.el.querySelectorAll("[data-colour-picker] button").length === 5, "five colours");
  ok(txt().includes("Gold belongs to Hawks — picking it swaps the two teams' colours."), "the other team's colour is explained, not greyed out");
  ok(Array.from(t.el.querySelectorAll("[data-colour-picker] button")).every((b) => !(b as HTMLButtonElement).disabled), "nothing is greyed out");
  await act(async () => { (t.el.querySelector('[data-colour-picker] button[aria-label^="Gold"]') as HTMLButtonElement).click(); });
  await settle();
  ok(colours(t.el) === JSON.stringify(["gold", "blue"]), `picking Hawks' colour swapped them (${colours(t.el)})`);
  ok(txt().includes("Eagles and Hawks swapped colours."), "the swap is announced");
  await act(async () => { Array.from(t.el.querySelectorAll("[data-colour-swapped] button")).find((b) => b.textContent === "Undo")?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
  ok(colours(t.el) === JSON.stringify([null, null]), `Undo puts them back (${colours(t.el)})`);
  t.unmount();

  const r = renderScreen(<Two names={["Red", "Sharks"]} />);
  ok((r.el.textContent || "").includes("Colour from the name"), "a team named Red: colour from the name");
  ok((r.el.querySelector('[data-team-colour="0"] button') as HTMLButtonElement).disabled, "its dot doesn't open");
  r.unmount();
  report("team colour dot");
})().catch((e) => { console.error(e); process.exit(1); });
