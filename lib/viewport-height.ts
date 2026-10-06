// The ONE decision of what height the app shell is sized to (--app-h). Pure, so it is tested with
// the real numbers from the phone (199.4).
//
// Two contexts, two correct answers:
//   * Safari TAB: the visible height follows the toolbar as it shows and hides; only the VISUAL
//     viewport tracks that, so --app-h = visualViewport.height (177.79, still right).
//   * INSTALLED app (Home Screen): there is no toolbar. The layout viewport (innerHeight) is the
//     visible height, and iOS is known to leave visualViewport.height STALE there — measured on
//     2026-10-05: innerHeight 894 (correct: 956 glass − 62 status bar), visualViewport.height 611,
//     no keyboard. Sizing the shell to 611 put the nav mid-screen with 283px of dead app beneath
//     it (and, before 199.3, tripped the keyboard heuristic and hid the nav entirely). Installed
//     mode therefore uses innerHeight and ignores the visual viewport.
// A keyboard is handled separately (data-kb, gated on a focused editable element): while open the
// stylesheet pins the shell to 100lvh and hides the nav, in both contexts.
export function appShellHeight(m: { standalone: boolean; innerHeight: number; visualHeight: number | null | undefined }): number {
  const inner = Math.round(m.innerHeight || 0);
  const vv = Math.round(m.visualHeight ?? 0);
  if (m.standalone) return inner > 0 ? inner : vv;
  return vv > 0 ? vv : inner;
}

export function isStandalone(): boolean {
  try {
    return (typeof window !== "undefined" && window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
      || (typeof navigator !== "undefined" && (navigator as any).standalone === true);
  } catch { return false; }
}
