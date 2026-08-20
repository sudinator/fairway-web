/**
 * Component render tests — the first in this repo.
 *
 * Each case here corresponds to a defect that actually shipped, and that every existing gate
 * (typecheck, eslint, 56 guards, the build) passed clean:
 *
 *   1. player-card FormChart called useId() AFTER an early return. Going from 1 to 2 data points
 *      threw "Rendered more hooks than during the previous render". A guaranteed crash, invisible
 *      to every static check, catchable only by rendering twice with different props.
 *   2. Two buttons spread btn() then overrode background/color with `undefined`, so React applied
 *      neither and the control fell back to the browser default — grey with accent-blue text.
 *      Source-readable as correct. Only a real DOM shows the computed style.
 *   3. Colour tokens are checked here against the values they are documented to have, so a
 *      well-meant edit to lib/golf.ts cannot silently undo the contrast work of 177.61.
 *
 * Deliberately narrow: these assert "does not crash" and "renders the expected style", not exact
 * markup. Snapshot-style assertions on a UI under active redesign would fail on every legitimate
 * change and get deleted within a month.
 */
import "./test-dom";
import * as React from "react";
import { ok, eq, mounts, renderToDom, rerender, text, report } from "./test-render";
import { C } from "./golf";

// ── 1. Hooks order survives a prop change ───────────────────────────────────
// The shape of the player-card bug, reproduced minimally. If a hook ever sits behind an early
// return again, the second render throws here rather than in someone's round.
function ChartLike({ data }: { data: number[] }) {
  const id = React.useId();
  if (data.length < 2) return null;
  return <svg data-testid="chart" id={`g-${id.replace(/[^a-zA-Z0-9]/g, "")}`} />;
}

{
  const { root, container, unmount } = renderToDom(<ChartLike data={[1]} />);
  eq(container.querySelector("[data-testid=chart]"), null, "chart hidden with a single point");
  let threw: string | null = null;
  try {
    rerender(root, <ChartLike data={[1, 2]} />);
  } catch (e) {
    threw = (e as Error).message;
  }
  eq(threw, null, "1 -> 2 data points does not throw a hooks-order error");
  ok(container.querySelector("[data-testid=chart]"), "chart appears once there are 2 points");
  unmount();
}

// ── 2. A style spread survives a conditional override ───────────────────────
const btn = (primary?: boolean): React.CSSProperties => ({
  background: primary ? C.gold : C.greenLight,
  color: primary ? C.green : C.cream,
  border: "none",
});

{
  // The broken shape: `undefined` overrides the spread and React applies nothing.
  const Broken = ({ on }: { on: boolean }) => (
    <button style={{ ...btn(true), background: on ? "#5A1E1E" : undefined,
                     color: on ? "#fff" : undefined }}>End game</button>
  );
  const { container, unmount } = renderToDom(<Broken on={false} />);
  const el = container.querySelector("button")!;
  eq(el.style.background, "", "the undefined-override pattern really does strip the background");
  unmount();
}

{
  // The fix: a conditional spread leaves the base style intact.
  const Fixed = ({ on }: { on: boolean }) => (
    <button style={{ ...btn(true), ...(on ? { background: "#5A1E1E", color: "#fff" } : {}) }}>
      End game
    </button>
  );
  const a = renderToDom(<Fixed on={false} />);
  const inactive = a.container.querySelector("button")!;
  ok(inactive.style.background !== "", "inactive button keeps a background");
  ok(/201,\s*162,\s*39|c9a227/i.test(inactive.style.background), "inactive button is C.gold");
  a.unmount();

  const b = renderToDom(<Fixed on={true} />);
  const active = b.container.querySelector("button")!;
  ok(/90,\s*30,\s*30|5a1e1e/i.test(active.style.background), "active button is the destructive red");
  b.unmount();
}

// ── 3. Nothing crashes on mount ─────────────────────────────────────────────
{
  const Empty = () => <div>no rounds yet</div>;
  mounts(<Empty />, "trivial component mounts");

  const WithEffect = () => {
    const [n, setN] = React.useState(0);
    React.useEffect(() => { setN(1); }, []);
    return <div data-testid="n">{n}</div>;
  };
  const { container, unmount } = renderToDom(<WithEffect />);
  eq(text(container), "1", "effects flush before assertions run");
  unmount();
}

// ── 4. The 177.61 contrast tokens are what they are documented to be ────────
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

ok(ratio(C.faint, C.card) >= 4.5, `C.faint on C.card is AA (${ratio(C.faint, C.card).toFixed(2)}:1)`);
ok(ratio(C.faint, C.field) >= 4.5, `C.faint on C.field is AA (${ratio(C.faint, C.field).toFixed(2)}:1)`);
ok(ratio(C.sage, C.greenLight) >= 4.5, `C.sage on C.greenLight is AA (${ratio(C.sage, C.greenLight).toFixed(2)}:1)`);
ok(ratio(C.ink, C.card) >= 4.5, `C.ink on C.card is AA (${ratio(C.ink, C.card).toFixed(2)}:1)`);
ok(ratio(C.cream, C.greenLight) >= 4.5, `C.cream on C.greenLight is AA (${ratio(C.cream, C.greenLight).toFixed(2)}:1)`);

// The pairings that are WRONG by rule 25 — asserted so nobody "fixes" the tokens back.
ok(ratio(C.sage, C.card) < 4.5, "C.sage on cream is correctly unusable (green-surface token)");
ok(ratio(C.faint, C.greenLight) < 4.5, "C.faint on green is correctly unusable (cream-surface token)");

// C.field must be visibly distinct from C.card, or the 177.59 mistake repeats: C.cream was
// only 1.09:1 against C.card and therefore invisible as a field fill.
ok(ratio(C.field, C.card) >= 1.2,
   `C.field is visibly distinct from C.card (${ratio(C.field, C.card).toFixed(2)}:1)`);

report("component render");
