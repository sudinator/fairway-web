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

// ---------------------------------------------------------------------------
// User-facing failure text: what happened, what to do, and a code to quote.
//
// reasonFor() above returns diagnostic language — "a database security rule blocked it" is
// useful to a developer and meaningless to a golfer. What a user needs is three things:
//   1. plainly, that the thing did not happen
//   2. what to DO about it, which differs by cause: retrying a permission error is pointless,
//      retrying a dropped connection is exactly right
//   3. a short error code they can read out, so we get the diagnosis without showing them Postgres
//
// The code is the Postgres/PostgREST code where there is one, because that is already
// meaningful to us and searchable. Otherwise a BNN- prefix keeps it obviously ours.

export type FailureAdvice = { action: string; code: string };

export function adviceFor(error: SupabaseishError): FailureAdvice {
  const msg = error?.message || "";
  const code = error?.code || "";

  if (code === "42501" || /row-level security|violates row-level/i.test(msg)) {
    // Retrying will fail identically — this needs someone with different permissions.
    return { action: "You may not have permission for this. Ask a group admin.", code: "42501" };
  }
  if (code === "23505" || /duplicate key|already exists/i.test(msg)) {
    return { action: "It looks like this already exists. Refresh and check.", code: "23505" };
  }
  if (code === "23503" || /foreign key/i.test(msg)) {
    return { action: "Something it depends on has been removed. Refresh and try again.", code: "23503" };
  }
  if (code === "23502" || /not-null|null value/i.test(msg)) {
    return { action: "Something required was left blank. Check the form and try again.", code: "23502" };
  }
  if (code === "PGRST301" || /JWT|not authenticated|expired/i.test(msg)) {
    return { action: "You have been signed out. Sign in again, then retry.", code: "AUTH" };
  }
  if (code === "PGRST116") {
    return { action: "It may already have been changed by someone else. Refresh.", code: "PGRST116" };
  }
  // Every browser words a dropped connection differently, and this is the failure a golfer will
  // actually hit. Safari (so every iPhone) says "Load failed"; Chrome says "Failed to fetch";
  // Firefox says "NetworkError when attempting to fetch resource". Matching only Chrome's wording
  // meant an iPhone user got the generic "Try again" with no explanation — found within minutes
  // of shipping, in airplane mode on a real device.
  if (/failed to fetch|load failed|networkerror|network request failed|network|offline|connection|timeout|aborted|dns/i.test(msg)) {
    // The common case on a course. Retrying is the right advice and usually works.
    return { action: "Check your connection and try again.", code: "NET" };
  }
  return { action: "Try again.", code: code || "BNN-UNK" };
}

// The single string shown in a toast. Deliberately: what failed, what to do, then the code last
// so it does not lead. "error code" rather than "code" because that is the phrasing
// people already use when reporting a problem — "it says error code 42501".
export function failureMessage(whatFailed: string, error: SupabaseishError): string {
  const { action, code } = adviceFor(error);
  if (typeof console !== "undefined") console.error(`[${whatFailed}] ${code}`, error);
  return `${whatFailed}. ${action} (error code ${code})`;
}
