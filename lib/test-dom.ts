/**
 * jsdom bootstrap for component tests.
 *
 * Why this exists: until 177.62 no component in this repo had ever been executed. `npm test`
 * compiles with tsc and runs the output under node — excellent for pure logic in lib/, and it
 * catches nothing about rendering. Every visual release therefore shipped verified only by
 * "it compiles", which is how a conditional useId() (a guaranteed crash), two buttons rendering
 * as the browser default control, and 523 sub-threshold contrast sites all reached staging.
 *
 * This follows the existing test convention deliberately: plain TS compiled to .testout and run
 * with node, printing PASS/FAIL, no new test framework. Adding vitest or jest would mean a second
 * runner, a second config, and a second way to write tests. The repo already has a working
 * pattern; this extends it to components rather than replacing it.
 *
 * Import this FIRST in any component test — React reads `document` at module load, so the globals
 * have to exist before react-dom is required.
 */
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://staging.local/",
  pretendToBeVisual: true,
});

const g = globalThis as unknown as Record<string, unknown>;

// Node 22 defines several of these as getter-only on globalThis, so a plain assignment throws.
// defineProperty works for both cases and keeps the whole setup in one place.
function setGlobal(name: string, value: unknown) {
  try {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  } catch {
    (globalThis as unknown as Record<string, unknown>)[name] = value;
  }
}

setGlobal("window", dom.window);
setGlobal("document", dom.window.document);
setGlobal("navigator", dom.window.navigator);
g.HTMLElement = dom.window.HTMLElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.KeyboardEvent = dom.window.KeyboardEvent;
g.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
g.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 0);
g.cancelAnimationFrame = (id: number) => clearTimeout(id);

// React 19 checks this before using act(); without it every state update logs a warning that
// buries real failures in noise.
g.IS_REACT_ACT_ENVIRONMENT = true;

// matchMedia is absent in jsdom and several components call it during mount.
if (!dom.window.matchMedia) {
  g.matchMedia = (query: string) => ({
    matches: false, media: query, onchange: null,
    addListener: () => {}, removeListener: () => {},
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// localStorage is real in jsdom, but tests should start from a clean slate every run.
try {
  dom.window.localStorage.clear();
} catch {
  /* jsdom without storage — the tests that need it will fail loudly, which is correct */
}

export const jsdomWindow = dom.window;
