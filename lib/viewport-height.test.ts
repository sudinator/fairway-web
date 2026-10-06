function assertEqual(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
import { appShellHeight } from "./viewport-height";
// THE 2026-10-05 READOUT, verbatim: installed, innerHeight 894, visualVP_h 611 (stale), no keyboard.
// The shell must be 894 — the nav at the bottom of the screen, not 283px above it.
assertEqual(appShellHeight({ standalone: true, innerHeight: 894, visualHeight: 611 }), 894, "installed: stale visual viewport is ignored");
// Installed, at rest, both agree (the 177.79 measurement): 894 either way.
assertEqual(appShellHeight({ standalone: true, innerHeight: 894, visualHeight: 894 }), 894, "installed at rest");
// Safari tab: the toolbar is showing, visual viewport is shorter than layout; follow the toolbar.
assertEqual(appShellHeight({ standalone: false, innerHeight: 894, visualHeight: 844 }), 844, "browser: follows the toolbar");
// Browser without visualViewport: fall back to innerHeight.
assertEqual(appShellHeight({ standalone: false, innerHeight: 760, visualHeight: null }), 760, "browser: no visualViewport API");
// Installed with a zero innerHeight (should not happen, but never produce 0): fall back to visual.
assertEqual(appShellHeight({ standalone: true, innerHeight: 0, visualHeight: 611 }), 611, "installed: innerHeight unavailable");
console.log("viewport-height tests passed");
