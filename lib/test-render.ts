/**
 * Component-test helpers, in the style the repo already uses: count passes and failures, print a
 * summary, exit non-zero on failure. No new framework.
 *
 * `renderToDom` mounts a real React tree into jsdom via createRoot, wrapped in act() so effects
 * and state updates flush before assertions run. That is the whole point — a component that
 * crashes on mount, violates the rules of hooks, or never renders its children now fails here
 * instead of on someone's phone.
 */
import "./test-dom";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";

let passed = 0;
let failed = 0;
const failures: string[] = [];

export function ok(cond: unknown, label: string) {
  if (cond) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}`);
  }
}

export function eq<T>(actual: T, expected: T, label: string) {
  const good = Object.is(actual, expected);
  if (!good) {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}\n        expected ${String(expected)}\n        actual   ${String(actual)}`);
  } else {
    passed++;
  }
}

/** Assert that mounting does not throw. The single highest-value component assertion there is. */
export function mounts(el: React.ReactElement, label: string) {
  try {
    const { unmount } = renderToDom(el);
    unmount();
    passed++;
  } catch (e) {
    failed++;
    failures.push(label);
    console.log(`  FAIL  ${label}\n        threw: ${(e as Error).message.split("\n")[0]}`);
  }
}

export function renderToDom(el: React.ReactElement): {
  container: HTMLElement;
  root: Root;
  unmount: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(el);
  });
  return {
    container,
    root,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** Re-render with new props, flushing effects — this is what exposes hook-order violations. */
export function rerender(root: Root, el: React.ReactElement) {
  act(() => {
    root.render(el);
  });
}

export function text(container: HTMLElement): string {
  return (container.textContent || "").replace(/\s+/g, " ").trim();
}

/** Every element carrying an inline background, innermost first — used by the contrast tests. */
export function backgroundsOf(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLElement>("*"))
    .map((n) => n.style.background || n.style.backgroundColor)
    .filter(Boolean);
}

export function report(suite: string): void {
  console.log(`${suite}: ${passed} passed, ${failed} failed`);
  if (failed) {
    console.log("failing:");
    for (const f of failures) console.log("  - " + f);
    process.exit(1);
  }
}
