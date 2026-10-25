/**
 * 212.37 — ONE way to print a skins count, everywhere (app, live page, recap, recap email). Skins split between tied
 * players (individual skins, ties halved) come in thirds, quarters and finer — three players tie, each gets ⅓. The old
 * printers knew only halves ("⅓" read "0", "1⅔" read "1½") or none at all ("1.6666666666666665").
 * Whole numbers print plain; halves, thirds, quarters, fifths, sixths and eighths as fractions (½ ⅓ ¾ ⅕ ⅚ ⅛…);
 * anything else (twelfths, say) to one decimal ("1.6").
 */
// halves, thirds, quarters (groups of up to 4), fifths (fields of 5+), sixths (½ + ⅓ = ⅚), eighths
const GLYPHS: [number, string][] = [[1 / 2, "½"], [1 / 3, "⅓"], [2 / 3, "⅔"], [1 / 4, "¼"], [3 / 4, "¾"],
  [1 / 5, "⅕"], [2 / 5, "⅖"], [3 / 5, "⅗"], [4 / 5, "⅘"], [1 / 6, "⅙"], [5 / 6, "⅚"], [1 / 8, "⅛"], [3 / 8, "⅜"], [5 / 8, "⅝"], [7 / 8, "⅞"]];
const EPS = 1e-6;
export function fmtSkins(n: number): string {
  if (!Number.isFinite(n)) return "0";
  const sign = n < 0 ? "-" : "";
  const v = Math.abs(n);
  const near = Math.round(v);
  if (Math.abs(v - near) < EPS) return `${sign}${near}`;
  const whole = Math.floor(v + EPS), frac = v - whole;
  const g = GLYPHS.find(([f]) => Math.abs(frac - f) < EPS);
  if (g) return `${sign}${whole === 0 ? "" : whole}${g[1]}`;
  return `${sign}${(Math.round(v * 10) / 10).toFixed(1)}`;
}
/** "⅓ skin", "1 skin", "2⅔ skins", "0 skins" — singular for more than none and up to one. */
export const skinsWord = (n: number) => `${fmtSkins(n)} skin${n > EPS && n <= 1 + EPS ? "" : "s"}`;
/** Characters a printed skins count can contain — for anything that has to recognise one in text. */
export const SKINS_NUMBER_CHARS = "\\d½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞.";
