/** Profile → YOUR DATA (212.133): the card shows the account address, the button, the once-a-day wait, the last send,
 *  and the staging note; a tap posts and reports. Rendered against a modelled /api/my-data. */
import { renderScreen, ok, report } from "./screen-harness";
import * as React from "react";
import { act } from "react";
import { YourData } from "@/components/your-data";

let state = { email: "amit@example.test", nextAllowedAt: "1970-01-02T00:00:00Z", canRequest: true, configured: true, last: null as null | { requested_at: string; sent_to: string; rounds: number; games: number } };
const posts: string[] = [];
(globalThis as any).fetch = async (input: any, init?: RequestInit) => {
  if (init?.method === "POST") { posts.push(String(input)); state = { ...state, canRequest: false, nextAllowedAt: new Date(Date.now() + 86400e3).toISOString(), last: { requested_at: new Date().toISOString(), sent_to: "amit@example.test", rounds: 50, games: 31 } }; return new Response(JSON.stringify({ ok: true, sentTo: "amit@example.test", counts: { rounds: 50, holes: 900, games: 31 } }), { status: 200, headers: { "content-type": "application/json" } }); }
  return new Response(JSON.stringify(state), { status: 200, headers: { "content-type": "application/json" } });
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });
(async () => {
  const t = renderScreen(<YourData />);
  await settle();
  const txt = () => t.el.textContent || "";
  ok(txt().includes("YOUR DATA") && txt().includes("amit@example.test") && txt().includes("nothing from Money"), "the card names the account address and the Money exclusion");
  const btn = t.el.querySelector("[data-email-my-data]") as HTMLButtonElement;
  ok(!!btn && !btn.disabled && btn.textContent === "Email me my data", "the button is enabled when allowed");
  await act(async () => { btn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
  await settle();
  ok(posts.length === 1, "a tap posts once");
  ok(!!t.el.querySelector("[data-your-data-last]") && txt().includes("50 rounds, 31 games"), "after the send the card shows the last send");
  ok(!!t.el.querySelector("[data-your-data-wait]") && (t.el.querySelector("[data-email-my-data]") as HTMLButtonElement).disabled, "then the once-a-day wait is shown and the button disabled");
  t.unmount();
  state = { ...state, configured: false, canRequest: true, last: null };
  const s = renderScreen(<YourData />);
  await settle();
  ok((s.el.querySelector("[data-email-my-data]") as HTMLButtonElement).disabled && (s.el.textContent || "").includes("staging"), "without mail keys the button is disabled and says why");
  s.unmount();
  report("your data card");
})().catch((e) => { console.error(e); process.exit(1); });
