// Server-side metadata for the line-up link (201.5): chat apps read <title>/og:* from the HTML, which
// a client component cannot set. Reads the same token-gated RPC the page uses, with the anon key.
import type { Metadata } from "next";
import { lineupTitle, lineupDescription } from "@/lib/lineup-meta";

export const dynamic = "force-dynamic";

async function readLineup(token: string): Promise<any | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key || !token) return null;
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/rest/v1/rpc/get_live_lineup`, {
      method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ p_token: token }), cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  const d = await readLineup(token);
  const title = lineupTitle(d);
  const description = lineupDescription(d);
  return {
    title,
    description,
    openGraph: { title, description, siteName: "Birdie Num Num", type: "website" },
    twitter: { card: "summary", title, description },
    robots: { index: false, follow: false },
  };
}

export default function LineupLayout({ children }: { children: React.ReactNode }) {
  return children;
}
