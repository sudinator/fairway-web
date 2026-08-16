export type AllowanceEdit = { text: string; pct: number };

/**
 * Resolve an in-progress custom handicap allowance edit.
 * Blank is intentionally allowed in the editor and means "no custom override",
 * so the domain value immediately falls back to the 100% default.
 */
export function editAllowance(raw: string): AllowanceEdit {
  if (raw === "") return { text: "", pct: 100 };
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return { text: "", pct: 100 };
  const pct = Math.max(0, Math.min(100, parsed));
  return { text: String(pct), pct };
}

/** Commit the editor on blur/navigation. A blank editor visibly returns to 100%. */
export function commitAllowance(text: string): AllowanceEdit {
  if (text.trim() === "") return { text: "100", pct: 100 };
  return editAllowance(text);
}
