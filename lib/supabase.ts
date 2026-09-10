"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The browser Supabase client, constructed LAZILY on first use.
 *
 * Thirty-odd modules do `const supabase = createClient()` at module scope. Building eagerly meant
 * merely IMPORTING one of them called createBrowserClient, which throws when the env vars are
 * absent — so `next build` could not prerender a page that never actually talks to Supabase at
 * build time. That made the production build depend on live credentials being present, and any
 * job that does not receive them fails: Dependabot pull requests, for instance, are deliberately
 * denied Actions secrets, so every one of them failed with "Your project's URL and API key are
 * required" during static generation of "/".
 *
 * Deferring construction to the first property access changes nothing at runtime — every real use
 * happens in an effect or a handler, in the browser, where the values are present — but module
 * import no longer needs them. A missing value still throws, just at the point of use, where the
 * message is about the actual call rather than about a page being prerendered.
 */
export function createClient() {
  type Client = ReturnType<typeof createBrowserClient>;
  let real: Client | null = null;
  const client = (): Client =>
    (real ??= createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    ));
  return new Proxy({} as Client, {
    get(_target, prop, receiver) {
      const c = client();
      const value = Reflect.get(c as object, prop, receiver);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(c) : value;
    },
    has(_target, prop) {
      return prop in (client() as object);
    },
  });
}
