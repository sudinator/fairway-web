// 212.27 — the score-save trace is switched in Admin → Diagnostics: off by default, per device, remembered.
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { SaveTraceToggle } from "@/components/save-trace-view";
import { saveTraceEnabled } from "@/lib/save-trace";
window.localStorage.clear();
const t = renderScreen(<SaveTraceToggle />);
const btn = () => t.el.querySelector("button") as HTMLButtonElement;
ok(!saveTraceEnabled() && btn().textContent === "Off", "off by default");
act(() => { btn().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
ok(saveTraceEnabled() && btn().textContent === "On" && window.localStorage.getItem("bnn_save_trace_on") === "1", "tapping switches it on, remembered on this device");
act(() => { btn().dispatchEvent(new MouseEvent("click", { bubbles: true })); });
ok(!saveTraceEnabled() && btn().textContent === "Off", "and off again");
t.unmount();
report("save trace toggle");
