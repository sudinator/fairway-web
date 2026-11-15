/** 212.109 (owner, Nov 14): the Summary's course / tee filter — dropdowns in the app's field style (a list of every course
 *  doesn't scale), each course with its round count; Reset applies at once, Apply only when something changed, the X
 *  dismisses without applying. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { AnalyticsFilterSheet } from "@/components/analytics-filters";
import { pbSampleRounds } from "@/lib/pb-mockups";
import { analyticsNameKey } from "@/lib/analytics-quality";

const applied: [string, string][] = []; let closed = 0;
const pick = (sel: HTMLSelectElement, value: string) => { act(() => { const proto = Object.getPrototypeOf(sel); const setter = Object.getOwnPropertyDescriptor(proto, "value")!.set!; setter.call(sel, value); sel.dispatchEvent(new (sel.ownerDocument.defaultView as any).Event("change", { bubbles: true })); }); };
let t = renderScreen(<AnalyticsFilterSheet rounds={pbSampleRounds} course="" tee="" onApply={(c, te) => applied.push([c, te])} onClose={() => { closed++; }} />);
const courseSel = t.el.querySelector("[data-summary-filter-course]") as HTMLSelectElement;
ok(!!courseSel && courseSel.options.length === 3 && courseSel.options[0].text.startsWith("All courses") && [...courseSel.options].some((o) => o.text === "Oak Hollow · 3 rounds"), `a course dropdown with round counts (got ${[...courseSel.options].map((o) => o.text).join(" | ")})`);
ok(!t.el.querySelector("[data-summary-filter-tees]"), "no tee field until a course is chosen");
const apply = t.el.querySelector("[data-summary-filter-apply]") as HTMLButtonElement, reset = t.el.querySelector("[data-summary-filter-reset]") as HTMLButtonElement;
ok(apply.disabled && reset.disabled, "nothing chosen: Apply and Reset are inert");
pick(courseSel, analyticsNameKey("Oak Hollow"));
const teeSel = t.el.querySelector("[data-summary-filter-tee]") as HTMLSelectElement;
ok(!!teeSel && [...teeSel.options].some((o) => o.text === "Blue"), "choosing a course shows its tees in a dropdown");
pick(teeSel, analyticsNameKey("Blue"));
ok(!(t.el.querySelector("[data-summary-filter-apply]") as HTMLButtonElement).disabled, "a change enables Apply");
t.click("Apply");
ok(applied.length === 1 && applied[0][0] === analyticsNameKey("Oak Hollow") && applied[0][1] === analyticsNameKey("Blue"), `Apply commits the course and tee (got ${JSON.stringify(applied)})`);
(t.el.querySelector("button[aria-label='Close']") as HTMLButtonElement).click();
ok(closed === 1 && applied.length === 1, "the X dismisses without applying");
t.unmount();
t = renderScreen(<AnalyticsFilterSheet rounds={pbSampleRounds} course={analyticsNameKey("Oak Hollow")} tee="" onApply={(c, te) => applied.push([c, te])} onClose={() => { closed++; }} />);
ok(!(t.el.querySelector("[data-summary-filter-reset]") as HTMLButtonElement).disabled, "a filter in place: Reset is live");
t.click("Reset");
ok(applied.length === 2 && applied[1][0] === "" && applied[1][1] === "", "Reset applies no filter immediately");
t.unmount();
report("summary filter");
