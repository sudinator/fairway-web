// Surfacing helper for Supabase errors.
//
// Logic in this app spans React, RLS policies, RPCs, and tables, so a failure can
// originate in any of those layers. When something fails, we want the message to
// name WHICH step failed (and the underlying reason) instead of a generic
// "couldn't do that," which forces inspecting every layer to debug.
//
// Usage:
//   const { data, error } = await supabase.from("holes").insert(rows);
//   if (error) throw stepError("save your scores", error);
//
// or to get a user-facing string without throwing:
//   setMessage(describeError("join the group", error));

export type SupabaseishError = { message?: string; code?: string; details?: string; hint?: string } | null | undefined;

// A short, human-readable reason. Recognises the most common RLS/permission case,
// which is the usual culprit when a write "silently" fails.
export function reasonFor(error: SupabaseishError): string {
  if (!error) return "Unknown error";
  const msg = error.message || "";
  const code = error.code || "";
  if (code === "42501" || /row-level security|violates row-level/i.test(msg)) {
    return "permission denied (a database security rule blocked it)";
  }
  if (code === "23505" || /duplicate key|already exists/i.test(msg)) {
    return "that record already exists";
  }
  if (code === "23503" || /foreign key/i.test(msg)) {
    return "a referenced record is missing";
  }
  if (/JWT|not authenticated|auth/i.test(msg)) {
    return "you appear to be signed out";
  }
  return msg || "unknown error";
}

// Build an Error whose message names the step and the reason.
export function stepError(step: string, error: SupabaseishError): Error {
  const e = new Error(`Couldn't ${step}: ${reasonFor(error)}.`);
  // Keep the raw error attached for console debugging.
  (e as any).cause = error;
  if (typeof console !== "undefined") console.error(`[${step}]`, error);
  return e;
}

// User-facing string version (doesn't throw).
export function describeError(step: string, error: SupabaseishError): string {
  if (typeof console !== "undefined") console.error(`[${step}]`, error);
  return `Couldn't ${step}: ${reasonFor(error)}.`;
}
