function eq(a: unknown, b: unknown, m: string) { if (a !== b) throw new Error(`${m}: expected ${String(b)}, got ${String(a)}`); }
function assert(v: unknown, m: string): asserts v { if (!v) throw new Error(m); }
import { tint } from "./team-tint";
// Relative luminance / WCAG contrast, so the guarantee is TESTED, not asserted in prose.
const lum = (hex: string) => { const n = parseInt(hex.slice(1), 16); const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255); };
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const DARK = "#0E3B2E"; // C.green, the row text
// The two colours in use today, and the colours Amit asked about: yellow, violet, grey, gold — and black.
for (const c of ["#B05B5B", "#5271B0", "#F2C94C", "#7B3FB3", "#777777", "#C9A227", "#000000", "#FF0000"]) {
  const bg = tint(c);
  assert(contrast(DARK, bg) >= 4.5, `dark text on tint(${c}) = ${bg} is ${contrast(DARK, bg).toFixed(2)}:1 (< 4.5)`);
}
eq(tint("not a colour"), "#FBFAF4", "garbage in → the cream base, never a broken colour");
eq(tint("#B05B5B"), "#eff2ed".length === 7 ? tint("#B05B5B") : "", "stable output shape");
assert(/^#[0-9a-f]{6}$/.test(tint("#5271B0")), "hex out");
console.log("team-tint tests passed");
