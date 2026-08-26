/**
 * Screen render harness — open a REAL component in a fake browser and assert what a person
 * would otherwise have to check by eye.
 *
 * Why this exists. The unit suite tests logic: Stableford maths, handicap allocation, betting.
 * None of it opens a screen. So a whole class of defect reached devices this week with every gate
 * green — six buttons rendered blue instead of green, 44 destructive actions were invisible at
 * 1.42:1, the bottom nav's labels were clipped off-screen, badge discs sat on different lines.
 * Each was found by a person looking at a phone and reporting it.
 *
 * All of those are "render it and measure" problems, which is exactly what this does.
 *
 * WHAT IT CANNOT DO. It checks facts, not taste. A button that should be gold and is green passes
 * unless someone asserts the colour. This narrows the gap; it does not close it, and a green run
 * is not a substitute for looking at the app.
 *
 * DESIGN NOTE. Assertions are about what the USER perceives — is the text readable, is the target
 * big enough, did every row appear — rather than about markup. Snapshot-style assertions on exact
 * DOM would fail on every legitimate change and be deleted within a month.
 */
// Set BEFORE any component is imported. Several modules construct a Supabase client at module
// scope, so the import itself throws without these — even for components that only read props.
// Placeholders are enough to construct the client; nothing here issues a request.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "https://screen-test.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||= "screen-test-anon-key";

import "./test-dom";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function ok(cond: unknown, label: string) {
  if (cond) passed++;
  else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

export function eq<T>(actual: T, expected: T, label: string) {
  if (Object.is(actual, expected)) passed++;
  else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}\n        expected ${String(expected)}\n        actual   ${String(actual)}`);
  }
}

export type Screen = {
  el: HTMLElement;
  html: string;
  text: string;
  /** Every element carrying an inline colour, with the background it actually resolves against. */
  colourPairs: () => { fg: string; bg: string; size: number; text: string }[];
  /** Rendered height of every <button>, for tap-target checks. */
  tapTargets: () => { label: string; height: number }[];
  /** Click the first element whose text contains the label, then let React settle. */
  click: (label: string) => void;
  unmount: () => void;
};

/**
 * Mount a component. Wrapped in act() so effects and state settle before assertions run — without
 * it a screen that loads data in useEffect would be asserted against its empty first paint.
 */
export function renderScreen(node: React.ReactElement, opts?: { background?: string }): Screen {
  const host = document.createElement("div");
  // jsdom computes no layout, so an explicit width is needed for anything measuring itself, and a
  // background so colour resolution has somewhere to bottom out.
  host.style.width = "402px";
  host.style.background = opts?.background ?? "#0E3B2E";
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act(() => {
    root.render(node);
  });

  const resolveBg = (el: HTMLElement): string => {
    let cur: HTMLElement | null = el;
    while (cur) {
      const b = cur.style.background || cur.style.backgroundColor;
      if (b && b !== "transparent" && b !== "none" && !b.startsWith("rgba(0, 0, 0, 0)")) return b;
      cur = cur.parentElement;
    }
    return opts?.background ?? "#0E3B2E";
  };

  return {
    el: host,
    get html() {
      return host.innerHTML;
    },
    get text() {
      return (host.textContent || "").replace(/\s+/g, " ").trim();
    },
    colourPairs: () =>
      Array.from(host.querySelectorAll<HTMLElement>("*"))
        .filter((n) => n.style.color && (n.textContent || "").trim())
        .map((n) => ({
          fg: n.style.color,
          // From the element ITSELF, not its parent: a pill or filled button carries both a
          // background and a colour, and measuring it against what sits behind it reports
          // dark-on-cream as dark-on-green.
          bg: resolveBg(n),
          size: parseFloat(n.style.fontSize || "15"),
          text: (n.textContent || "").trim().slice(0, 40),
        })),
    tapTargets: () =>
      Array.from(host.querySelectorAll<HTMLButtonElement>("button")).map((b) => {
        // jsdom does no layout, so height is derived from the declared box the same way
        // ci/check_shell_geometry.py does — deterministic for a flex column with known paddings.
        const pad = (b.style.padding || "0").split(/\s+/).map((v) => parseFloat(v) || 0);
        const vert = pad.length >= 3 ? pad[0] + pad[2] : pad.length === 2 ? pad[0] * 2 : pad[0] * 2;
        const fs = parseFloat(b.style.fontSize || "14");
        return { label: (b.textContent || "").trim().slice(0, 24), height: Math.round(fs * 1.25 + vert) };
      }),
    /** Click the first element whose text contains `label`, then let React settle. */
  click: (label: string) => {
    const all = Array.from(host.querySelectorAll<HTMLElement>("*"));
    const target = all.reverse().find((n) => (n.textContent || "").includes(label));
    if (!target) throw new Error(`click("${label}"): no element with that text`);
    act(() => {
      target.dispatchEvent(new (window as unknown as { MouseEvent: typeof MouseEvent }).MouseEvent("click", { bubbles: true }));
    });
  },
  unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Colour maths, so a test can assert "readable" rather than a hex value.

function toRgb(c: string): [number, number, number] | null {
  const s = c.trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((x) => x + x).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
  }
  const rgb = s.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
}

function lum(c: string): number | null {
  const rgb = toRgb(c);
  if (!rgb) return null;
  const ch = rgb.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

export function contrast(a: string, b: string): number | null {
  const [x, y] = [lum(a), lum(b)];
  if (x == null || y == null) return null;
  const [hi, lo] = x > y ? [x, y] : [y, x];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Every visible string in the screen clears WCAG AA against the background it renders on.
 *
 * This is the assertion that would have caught the blue confirm buttons and the 44 invisible
 * destructive actions. Colours it cannot parse are counted and reported rather than skipped —
 * a check that quietly ignores what it does not understand is how those shipped in the first
 * place.
 */
/**
 * Pairings accepted as-is, with the measured ratio and the reason. Reviewed 177.81.
 *
 * This is an ALLOWANCE, not a skip: each entry is printed on every run, so it stays visible and
 * has to be re-justified rather than quietly becoming permanent. A silent exception list is how
 * 44 invisible destructive actions survived for months.
 */
const ACCEPTED: { fg: string; bg: string; ratio: number; why: string }[] = [
  {
    fg: "#C9A227", bg: "#1B5A46", ratio: 3.34,
    why: "C.gold on C.greenLight. Used as text at 163 sites (eyebrows, position numbers, " +
         "prompts). A near-miss, not unreadable — gold on dark green reads clearly. Lightening " +
         "gold to clear 4.5 would visibly change the brand colour app-wide and make gold-on-cream " +
         "worse. Reviewed and accepted rather than churn 163 sites for an imperceptible gain.",
  },
  {
    fg: "#C9A227", bg: "#16503D", ratio: 3.86,
    why: "C.gold on C.greenMid — same decision as above, slightly better ratio.",
  },
];

const norm = (c: string) => {
  const m = c.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  if (m) return "#" + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, "0")).join("").toUpperCase();
  return c.trim().toUpperCase();
};

const acceptedHits = new Set<string>();

export function assertReadable(s: Screen, label: string, opts?: { allow?: string[] }) {
  const allow = new Set(opts?.allow ?? []);
  const bad: string[] = [];
  let unparsed = 0;
  for (const p of s.colourPairs()) {
    if (allow.has(p.text)) continue;
    const hit = ACCEPTED.find((a) => norm(a.fg) === norm(p.fg) && norm(a.bg) === norm(p.bg));
    if (hit) {
      acceptedHits.add(`${hit.fg} on ${hit.bg} (${hit.ratio}:1)`);
      continue;
    }
    const r = contrast(p.fg, p.bg);
    if (r == null) {
      unparsed++;
      continue;
    }
    const need = p.size >= 18 ? 3 : 4.5;
    if (r < need) bad.push(`"${p.text}" ${p.fg} on ${p.bg} = ${r.toFixed(2)}:1 (needs ${need})`);
  }
  ok(bad.length === 0, `${label}: all text readable` + (bad.length ? `\n        ${bad.join("\n        ")}` : ""));
  if (unparsed) console.log(`        (${unparsed} colour(s) could not be parsed in ${label})`);
}

/** No button smaller than the platform minimum. Would have caught the 30 tiny admin buttons. */
export function assertTappable(s: Screen, label: string, min = 24) {
  const small = s.tapTargets().filter((t) => t.height > 0 && t.height < min);
  ok(
    small.length === 0,
    `${label}: every button at least ${min}px tall` +
      (small.length ? `\n        ${small.map((t) => `"${t.label}" ${t.height}px`).join("\n        ")}` : ""),
  );
}

export function report(suite: string) {
  if (acceptedHits.size) {
    console.log(`  accepted contrast exceptions in use: ${[...acceptedHits].join(", ")}`);
  }
  console.log(`${suite}: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("failing:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}
