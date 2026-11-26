/** 212.132 — an in-app notice that arrives before Home's Toaster exists is held and shown when it mounts, never dropped
 *  and never a native alert (the "phone nearly full" notice from the service worker usually arrives while the page's own
 *  files are still loading). From the independent review of 212.130. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { Toaster, notifyInfoInApp, toasterMounted } from "@/components/toast";

async function main() {
  let alerts = 0;
  (globalThis as { alert?: (m: string) => void }).alert = () => { alerts++; };
  ok(!toasterMounted(), "no Toaster yet");
  notifyInfoInApp("Your phone is nearly out of storage");
  notifyInfoInApp("Your phone is nearly out of storage");   // the same notice twice is held once
  ok(alerts === 0, "a held notice never becomes a native alert");
  const t = renderScreen(<Toaster />);
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  const shown = t.el.textContent || "";
  ok(shown.includes("Your phone is nearly out of storage"), "the held notice shows once the Toaster mounts");
  ok(shown.split("nearly out of storage").length === 2, "held once, not twice");
  notifyInfoInApp("Second notice");
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  ok((t.el.textContent || "").includes("Second notice") && alerts === 0, "with the Toaster mounted a notice shows at once");
  t.unmount();
  report("held notice");
}
main().catch((e) => { console.error(e); process.exit(1); });
