/** 212.109 (owner, Nov 14): the Summary's course / tee filter — the app's own option rows and pills (no OS dropdown),
 *  Reset applies at once, Apply only when something changed, the X dismisses without applying. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { AnalyticsFilterSheet } from "@/components/analytics-filters";
import { pbSampleRounds } from "@/lib/pb-mockups";
import { analyticsNameKey } from "@/lib/analytics-quality";

const applied: [string, string][] = []; let closed = 0;
let t = renderScreen(<AnalyticsFilterSheet rounds={pbSampleRounds} course="" tee="" onApply={(c, te) => applied.push([c, te])} onClose={() => { closed++; }} />);
ok(!t.el.querySelector("select"), "no native dropdowns");
const rows = [...t.el.querySelectorAll("[data-summary-filter-courses] button")];
ok(rows.length === 3 && rows[0].textContent?.includes("All courses") && rows[0].getAttribute("aria-pressed") === "true", `course rows with All courses selected first (got ${rows.length})`);
const apply = t.el.querySelector("[data-summary-filter-apply]") as HTMLButtonElement, reset = t.el.querySelector("[data-summary-filter-reset]") as HTMLButtonElement;
ok(apply.disabled && reset.disabled, "nothing chosen: Apply and Reset are inert");
t.click("Oak Hollow");
ok(!!t.el.querySelector("[data-summary-filter-tees]") && [...t.el.querySelectorAll("[data-summary-filter-tees] button")].some((b) => b.textContent === "Blue"), "choosing a course shows its tees as pills");
t.click("Blue");
ok(!(t.el.querySelector("[data-summary-filter-apply]") as HTMLButtonElement).disabled, "a change enables Apply");
t.click("Apply");
ok(applied.length === 1 && applied[0][0] === analyticsNameKey("Oak Hollow") && applied[0][1] === analyticsNameKey("Blue"), `Apply commits the course and tee (got ${JSON.stringify(applied)})`);
(t.el.querySelector("button[aria-label='Close']") as HTMLButtonElement).click();
ok(closed === 1 && applied.length === 1, "the X dismisses without applying");
t.unmount();
// with a filter in place: Reset applies "no filter" at once
t = renderScreen(<AnalyticsFilterSheet rounds={pbSampleRounds} course={analyticsNameKey("Oak Hollow")} tee="" onApply={(c, te) => applied.push([c, te])} onClose={() => { closed++; }} />);
ok(!(t.el.querySelector("[data-summary-filter-reset]") as HTMLButtonElement).disabled, "a filter in place: Reset is live");
t.click("Reset");
ok(applied.length === 2 && applied[1][0] === "" && applied[1][1] === "", "Reset applies no filter immediately");
t.unmount();
report("summary filter");
