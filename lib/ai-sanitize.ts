// Neutralize prompt-injection in user-supplied stats before they're embedded in an AI prompt.
// The AI coach receives the golfer's own numeric stats (+ short labels like course/tee names). Free-text
// is the injection vector, so we deep-clone keeping only safe primitives, truncate strings hard, and cap
// array length / object keys / depth. Numbers (the actual signal) pass through untouched. This is
// output-integrity hardening — Gemini has no tools here — not a secret-exfiltration fix.
export type SanitizeOpts = { maxString?: number; maxArray?: number; maxKeys?: number; maxDepth?: number };
const DEF: Required<SanitizeOpts> = { maxString: 80, maxArray: 60, maxKeys: 80, maxDepth: 6 };

export function sanitizeForPrompt(value: unknown, opts: SanitizeOpts = {}, _depth = 0): unknown {
  const o = { ...DEF, ...opts };
  if (value == null) return value;
  const t = typeof value;
  if (t === "number") return Number.isFinite(value as number) ? value : null;
  if (t === "boolean") return value;
  if (t === "string") {
    // collapse newlines (defuse "\n\nIgnore previous instructions") and hard-truncate.
    const s = (value as string).replace(/[\r\n]+/g, " ").slice(0, o.maxString);
    return s;
  }
  if (t !== "object") return null; // functions, symbols, bigint -> drop
  if (_depth >= o.maxDepth) return null;
  if (Array.isArray(value)) {
    return value.slice(0, o.maxArray).map((v) => sanitizeForPrompt(v, o, _depth + 1));
  }
  const out: Record<string, unknown> = {};
  let n = 0;
  for (const k of Object.keys(value as Record<string, unknown>)) {
    if (n >= o.maxKeys) break;
    const key = String(k).replace(/[\r\n]+/g, " ").slice(0, 60);
    out[key] = sanitizeForPrompt((value as Record<string, unknown>)[k], o, _depth + 1);
    n++;
  }
  return out;
}
