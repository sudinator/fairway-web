// GolfCourseAPI course identifiers are provider-owned opaque tokens.
// Historically BNN saw numeric ids (e.g. "23554"); the provider migrated
// existing courses to alphanumeric ids in 2026 (e.g. "vqbyfsjx").
// Keep validation strict enough to block path/query injection while never
// inferring that a provider id is numeric.

export const MAX_COURSE_PROVIDER_ID_LENGTH = 64;

export function normalizeCourseProviderId(value: unknown): string | null {
  if (value == null) return null;
  const id = String(value).trim();
  return isSafeCourseProviderId(id) ? id : null;
}

export function isSafeCourseProviderId(id: string): boolean {
  return id.length > 0
    && id.length <= MAX_COURSE_PROVIDER_ID_LENGTH
    && /^[A-Za-z0-9_-]+$/.test(id);
}
