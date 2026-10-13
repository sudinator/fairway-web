/**
 * RENDERED CHECK (205.0): Season Wrapped entry points. On staging the Dashboard shows a preview card
 * any day; in production nothing shows mid-season. Rounds lists every FINISHED season.
 */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { SeasonWrappedEntry } from "@/components/season-wrapped";
import type { Round } from "@/lib/golf";

const r = (d: string): Round => ({ id: d, course: "C", played_at: d, holes: [], status: "final" } as unknown as Round);
const rounds = [r("2025-06-01"), r(`${new Date().getFullYear()}-05-01`)];

document.documentElement.setAttribute("data-env", "production");
{
  const s = renderScreen(<SeasonWrappedEntry rounds={rounds} userId="u" name="Amit" variant="dashboard" />);
  const m = new Date().getMonth(), day = new Date().getDate();
  const live = (m === 11 && day === 31) || m === 0;
  ok(!!s.el.querySelector("[data-season-entry]") === live, "production dashboard card only Dec 31 – Jan 31");
  s.unmount();
}
{
  const s = renderScreen(<SeasonWrappedEntry rounds={rounds} userId="u" name="Amit" variant="rounds" />);
  ok(!!s.el.querySelector('[data-season-row="2025"]'), "Rounds lists the finished 2025 season");
  s.unmount();
}
// 205.2: once the account has opened a season, the production banner is gone (Rounds keeps it).
{
  const live = (new Date().getMonth() === 11 && new Date().getDate() === 31) || new Date().getMonth() === 0;
  const y = new Date().getMonth() === 0 ? new Date().getFullYear() - 1 : new Date().getFullYear();
  const s = renderScreen(<SeasonWrappedEntry rounds={rounds} userId="u" name="Amit" variant="dashboard" seenYears={[y]} />);
  ok(!s.el.querySelector("[data-season-entry]"), `opened season: no banner${live ? " (in the live window)" : ""}`);
  s.unmount();
}
{
  const s = renderScreen(<SeasonWrappedEntry rounds={rounds} userId="u" name="Amit" variant="rounds" />);
  ok(s.text.includes("2025 season summary"), "Rounds row wording");
  s.unmount();
}
document.documentElement.setAttribute("data-env", "staging");
{
  const s = renderScreen(<SeasonWrappedEntry rounds={rounds} userId="u" name="Amit" variant="dashboard" />);
  ok(!!s.el.querySelector("[data-season-entry]"), "staging: preview card any day");
  ok(s.text.includes("season summary is ready"), "banner wording: 'Your <year> season summary is ready'");
  s.unmount();
}
document.documentElement.removeAttribute("data-env");
report("season entry");
