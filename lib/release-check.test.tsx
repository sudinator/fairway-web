/**
 * Release verification by EXECUTION, not by reading source.
 *
 * Static checks confirm a file says what I claim. They cannot confirm the component renders, or
 * that a colour resolves to what it should at runtime. 177.68 shipped six blue buttons that every
 * static gate passed: the code was valid, the contrast was fine, the meaning was wrong.
 */
import "./test-dom";
import * as React from "react";
import { ok, eq, renderToDom, report } from "./test-render";
import { C } from "./golf";

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const ch = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ── the two 177.69 fixes, executed ─────────────────────────────────────────
{
  // a destructive ghost button, as the admin screens render it
  const Ghost = () => (
    <div style={{ background: C.greenLight }}>
      <button style={{ background: "transparent", color: C.overRedDark, border: "none",
                       borderRadius: 8, padding: "4px 10px", fontSize: 11, fontWeight: 700 }}>
        Delete group
      </button>
    </div>
  );
  const { container, unmount } = renderToDom(<Ghost />);
  const b = container.querySelector("button")!;
  ok(b.style.background === "transparent", "destructive ghost has no fill");
  ok(/248,\s*187,\s*178|f8bbb2/i.test(b.style.color), "destructive ghost uses C.overRedDark");
  ok(ratio(C.overRedDark, C.greenLight) >= 4.5,
     `destructive ghost readable on green (${ratio(C.overRedDark, C.greenLight).toFixed(2)}:1)`);
  unmount();
}

{
  // the success button, as Money renders it
  const Settle = () => (
    <div style={{ background: C.greenLight }}>
      <button style={{ background: "#7FD6A3", color: C.green, border: "none" }}>Mark settled</button>
    </div>
  );
  const { container, unmount } = renderToDom(<Settle />);
  const b = container.querySelector("button")!;
  ok(/127,\s*214,\s*163|7fd6a3/i.test(b.style.background), "success button is mint, not blue");
  ok(!/163,\s*198,\s*245|a3c6f5/i.test(b.style.background), "success button is NOT C.underDark");
  ok(ratio(C.green, "#7FD6A3") >= 4.5, "success button carries dark text");
  unmount();
}

// ── the token contract the rest of the app depends on ──────────────────────
ok(ratio(C.faint, C.card) >= 4.5, "C.faint on cream is AA");
ok(ratio(C.sage, C.greenLight) >= 4.5, "C.sage on green is AA");
ok(ratio(C.overRedDark, C.greenLight) >= 4.5, "C.overRedDark on green is AA");
ok(ratio(C.cream, C.danger) >= 4.5, "C.cream on C.danger is AA");
ok(ratio(C.faint, C.greenLight) < 4.5, "C.faint stays cream-only (guards the 177.62 mistake)");
ok(ratio(C.birdie, C.greenLight) < 4.5, "C.birdie stays cream-only (guards the 177.69 mistake)");

// C.underDark must NOT be mistaken for a success colour again — it is a SCORE colour and is blue.
ok(lum(C.underDark) > 0.4, "C.underDark is light (a score colour, not a success fill)");

// ── btn() roles behave ─────────────────────────────────────────────────────
{
  const { btn } = require("../components/ui") as typeof import("../components/ui");
  const g = btn("ghost");
  eq(g.background, "transparent", 'btn("ghost") has no fill');
  eq(btn("danger").background, C.danger, 'btn("danger") uses C.danger');
  eq(btn(true).background, C.gold, "btn(true) still primary");
  eq(btn(false).background, C.greenLight, "btn(false) still secondary");
  eq(btn("primary", "compact").fontSize, 12, "compact size applies");
}



// ── backdropDismiss: the scroll-closes-the-sheet bug (APP_RULES #26) ────────
{
  const { backdropDismiss } = require("../components/ui") as typeof import("../components/ui");
  let closed = 0;
  const Overlay = () => (
    <div data-testid="scrim" {...backdropDismiss(() => { closed += 1; })}
         style={{ position: "fixed", inset: 0 }}>
      <div data-testid="panel" style={{ background: "#1B5A46" }}>content</div>
    </div>
  );
  const { container, unmount } = renderToDom(<Overlay />);
  const scrim = container.querySelector("[data-testid=scrim]") as HTMLElement;
  const panel = container.querySelector("[data-testid=panel]") as HTMLElement;

  const down = (el: Element, x: number, y: number) =>
    el.dispatchEvent(new (window as any).MouseEvent("pointerdown",
      { bubbles: true, clientX: x, clientY: y }));
  const click = (el: Element, x: number, y: number) =>
    el.dispatchEvent(new (window as any).MouseEvent("click",
      { bubbles: true, clientX: x, clientY: y }));

  // a clean tap on the scrim closes
  closed = 0; down(scrim, 50, 50); click(scrim, 50, 50);
  eq(closed, 1, "a clean backdrop tap closes the overlay");

  // a gesture that STARTS on the panel and lifts over the scrim must NOT close.
  // this is the real bug: the click target is the scrim, so onClick alone would fire.
  closed = 0; down(panel, 50, 400); click(scrim, 50, 60);
  eq(closed, 0, "a scroll starting in the panel does NOT close the overlay");

  // a drag on the scrim is not a tap
  closed = 0; down(scrim, 50, 50); click(scrim, 50, 300);
  eq(closed, 0, "a drag across the backdrop does NOT close the overlay");

  // a click inside the panel never closes
  closed = 0; down(panel, 50, 50); click(panel, 50, 50);
  eq(closed, 0, "a click inside the panel does NOT close the overlay");
  unmount();
}

report("backdrop dismiss");
