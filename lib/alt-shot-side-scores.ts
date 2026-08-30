export type AltShotScoreSide = "a" | "b";

export type AltShotScoreRow = {
  game_id: string;
  foursome_id: string;
  side: AltShotScoreSide;
  hole_index: number;
  strokes: number | null;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type AltShotScoreDraft = {
  foursomeId: string;
  side: AltShotScoreSide;
  holeIndex: number;
  strokes: number | null;
  at: number;
};

export function canonicalAltShotGross(
  rows: AltShotScoreRow[] | null | undefined,
  foursomeId: string,
  side: AltShotScoreSide,
  holeCount: number,
  legacyGross?: (number | null)[] | null,
): (number | null)[] {
  const out = Array.from({ length: holeCount }, (_, i) => legacyGross?.[i] ?? null);
  for (const row of rows || []) {
    if (row.foursome_id !== foursomeId || row.side !== side) continue;
    if (row.hole_index < 0 || row.hole_index >= holeCount) continue;
    out[row.hole_index] = row.strokes;
  }
  return out;
}

export function upsertAltShotScoreLocal(
  rows: AltShotScoreRow[],
  gameId: string,
  foursomeId: string,
  side: AltShotScoreSide,
  holeIndex: number,
  strokes: number | null,
): AltShotScoreRow[] {
  const rest = rows.filter((r) => !(r.foursome_id === foursomeId && r.side === side && r.hole_index === holeIndex));
  // Keep a null tombstone. Historical Alternate Shot games may still have the old
  // duplicated player score underneath; deleting the canonical row would let that
  // legacy value reappear after the user explicitly cleared the side score.
  return [...rest, { game_id: gameId, foursome_id: foursomeId, side, hole_index: holeIndex, strokes }];
}

const key = (gameId: string) => `bnn:altshot-side-drafts:${gameId}`;

export function loadAltShotDrafts(gameId: string): AltShotScoreDraft[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(key(gameId)) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch { return []; }
}

export function saveAltShotDraft(gameId: string, draft: AltShotScoreDraft): void {
  if (typeof localStorage === "undefined") return;
  const rows = loadAltShotDrafts(gameId).filter((d) => !(d.foursomeId === draft.foursomeId && d.side === draft.side && d.holeIndex === draft.holeIndex));
  rows.push(draft);
  localStorage.setItem(key(gameId), JSON.stringify(rows));
}

export function clearAltShotDraft(gameId: string, foursomeId: string, side: AltShotScoreSide, holeIndex: number): void {
  if (typeof localStorage === "undefined") return;
  const rows = loadAltShotDrafts(gameId).filter((d) => !(d.foursomeId === foursomeId && d.side === side && d.holeIndex === holeIndex));
  if (rows.length) localStorage.setItem(key(gameId), JSON.stringify(rows));
  else localStorage.removeItem(key(gameId));
}

export function clearAllAltShotDrafts(gameId: string): void {
  if (typeof localStorage !== "undefined") localStorage.removeItem(key(gameId));
}
