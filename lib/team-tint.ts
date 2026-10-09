// The ONE way a team colour becomes a background for dark text (202.4): mix it ~85% into the cream
// card. A tint that light is pale whatever the hue — pale red, pale blue, pale violet, pale grey —
// so the dark text never has to change colour by team. Team colours are fixed today (first team red,
// second blue); if they ever become a setting, every stored colour flows through here and the
// contrast guard checks the result against the dark text.
export function tint(hex: string, amount = 0.85, base = "#FBFAF4"): string {
  const h = (x: string) => { const m = /^#?([0-9a-f]{6})$/i.exec(x.trim()); if (!m) return null; const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const c = h(hex), b = h(base);
  if (!c || !b) return base;
  const mix = c.map((v, i) => Math.round(v * (1 - amount) + b[i] * amount));
  return "#" + mix.map((v) => v.toString(16).padStart(2, "0")).join("");
}
