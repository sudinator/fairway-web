import { recordPhoneDiagnostic, diagnosticError } from "./phone-diagnostics";
// Google sign-in, in one place (208.0). `chooseAccount` makes Google show its account picker instead of
// silently reusing the last account — the moment a returning member is most likely to pick the wrong one.
import { createClient } from "@/lib/supabase";

export async function signInWithGoogle(opts: { next?: string; chooseAccount?: boolean } = {}) {
  const supabase = createClient();
  const next = opts.next && opts.next.startsWith("/") && !opts.next.startsWith("//") ? opts.next : null;
  recordPhoneDiagnostic("auth.start");
  try {
  const result = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ""}`,
      ...(opts.chooseAccount ? { queryParams: { prompt: "select_account" } } : {}),
    },
  });
  recordPhoneDiagnostic("auth.result", { ok: !result?.error, ...diagnosticError(result?.error) });
  } catch (error) { recordPhoneDiagnostic("auth.result", { ok: false, ...diagnosticError(error) }); throw error; }
}

/** Sign out, then straight back to Google's account picker. */
export async function switchGoogleAccount(next?: string) {
  const supabase = createClient();
  await supabase.auth.signOut();
  await signInWithGoogle({ next, chooseAccount: true });
}
