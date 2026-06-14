import { NextResponse } from "next/server";

// Runs on the server so the Gemini API key stays secret. Takes a compact summary
// of the current round plus prior rounds and returns a short coaching analysis.
//
// COST PROTECTION (layered):
//  1. Per-user cap (2/day) is enforced in the client before calling this.
//  2. A GLOBAL daily cap is enforced here as a master valve — once the app has
//     made GEMINI_DAILY_LIMIT analyses today, further calls are refused without
//     ever hitting Gemini.
//  3. The ultimate guarantee that no bill is ever owed is on Google's side: keep
//     the key on the FREE TIER with NO billing account attached, so exceeding
//     quota returns errors instead of charges.

// In-memory counter; resets on server restart (frequent on serverless). Coarse
// safety valve, not exact accounting — real bill-proofing is the no-billing setting.
let dayKey = "";
let dayCount = 0;
const GLOBAL_DAILY_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT || "200", 10);
const todayStr = () => new Date().toISOString().slice(0, 10);

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: "AI analysis isn't set up yet. Add a GEMINI_API_KEY in the Vercel project settings to enable it." },
      { status: 503 },
    );
  }

  const t = todayStr();
  if (dayKey !== t) { dayKey = t; dayCount = 0; }
  if (dayCount >= GLOBAL_DAILY_LIMIT) {
    return NextResponse.json(
      { error: "AI analysis has reached today's limit. It'll be available again tomorrow." },
      { status: 429 },
    );
  }

  let body: any;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const { current, history } = body || {};
  if (!current) return NextResponse.json({ error: "No round data provided." }, { status: 400 });

  const prompt = `You are a friendly, encouraging golf coach analyzing an amateur golfer's round. Be specific, positive, and practical. Keep it concise.

CURRENT ROUND:
${JSON.stringify(current)}

PRIOR ROUNDS (most recent first, may be empty):
${JSON.stringify(history || [])}

Write a short analysis with exactly these three parts, using these labels on their own:
"What went well:" - 1-2 specific positives from this round, comparing to prior rounds where possible (fewer 3-putts, better GIR, lower score, etc.).
"Focus areas:" - 1-2 specific, actionable things to work on, grounded in the stats.
"Next time:" - one concrete, achievable goal for the next round.

Rules: Base everything ONLY on the numbers given. If there are no prior rounds, treat this as a baseline and focus on this round's patterns. Do not invent stats. Keep the whole thing under 130 words. Warm but honest.`;

  try {
    // Try current free-tier models in order; if one is unavailable/over-quota
    // (429/404), fall through to the next before giving up.
    const models = ["gemini-1.5-flash", "gemini-2.0-flash", "gemini-1.5-flash-8b"];
    let lastDetail = "";
    let lastStatus = 502;
    for (const model of models) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = (data?.candidates?.[0]?.content?.parts || [])
          .map((p: any) => p.text || "")
          .join("\n")
          .trim();
        if (!text) return NextResponse.json({ error: "No analysis available." }, { status: 502 });
        dayCount++;
        return NextResponse.json({ analysis: text });
      }
      lastDetail = (await resp.text()).slice(0, 400);
      lastStatus = resp.status;
      // Only fall through on model-availability / quota issues; otherwise stop.
      if (resp.status !== 429 && resp.status !== 404) break;
    }
    // All models failed — surface Google's actual reason so it can be diagnosed.
    return NextResponse.json(
      { error: `AI service error (${lastStatus}). ${lastDetail || "No detail returned."}` },
      { status: lastStatus === 429 ? 429 : 502 },
    );
  } catch (e: any) {
    return NextResponse.json({ error: "Couldn't reach the AI service.", detail: e?.message }, { status: 502 });
  }
}
