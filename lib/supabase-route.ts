import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase client bound to the request's auth cookies, for use inside API route
// handlers. Read-only on cookies (API routes don't refresh/set the session), so
// getAll() is wired and setAll() is a no-op. Use `await supabase.auth.getUser()`
// to obtain the authenticated caller; a null user means "not signed in".
export function createRouteClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll() {
          /* API routes do not mutate the session cookie */
        },
      },
    },
  );
}
