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

// Hardcoded fallback if the live model list can't be fetched. Ordered newest-first.
const FALLBACK_MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-flash-latest"];

// Cache the discovered model list briefly so we don't list on every request.
let cachedModels: string[] = [];
let cachedAt = 0;
const MODEL_CACHE_MS = 1000 * 60 * 60; // 1 hour

// Future-proofing: ask Google which models THIS key can actually use, and pick
// suitable lightweight "flash" models (free-tier friendly) that support content
// generation. Falls back to a known list if discovery fails. An env override
// (GEMINI_MODEL) always wins if set.
async function pickModels(key: string): Promise<string[]> {
  const override = (process.env.GEMINI_MODEL || "").trim();
  if (override) return [override, ...FALLBACK_MODELS];

  if (cachedModels.length && Date.now() - cachedAt < MODEL_CACHE_MS) {
    return [...cachedModels, ...FALLBACK_MODELS];
  }
  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (!resp.ok) return FALLBACK_MODELS;
    const data = await resp.json();
    const all: any[] = data?.models || [];
    const usable = all
      .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
      .map((m) => String(m.name || "").replace(/^models\//, ""))
      .filter((n) => n.includes("flash")); // lightweight, free-tier friendly
    // Prefer non-experimental, higher version numbers; keep it simple: sort desc.
    const ranked = usable
      .filter((n) => !/exp|preview|thinking/i.test(n)) // avoid experimental/preview
      .sort()
      .reverse();
    const chosen = (ranked.length ? ranked : usable).slice(0, 4);
    if (chosen.length) { cachedModels = chosen; cachedAt = Date.now(); return [...chosen, ...FALLBACK_MODELS]; }
    return FALLBACK_MODELS;
  } catch {
    return FALLBACK_MODELS;
  }
}

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

  const prompt = `You are a friendly, encouraging golf coach analyzing an amateur golfer's round. Be specific, positive, practical, and concise.

CURRENT ROUND (includes the golfer's handicap index if known):
${JSON.stringify(current)}

PRIOR ROUNDS (most recent first, may be empty):
${JSON.stringify(history || [])}

Write a short analysis with exactly these labels, each on its own line:
"What went well:" - 1-2 specific positives from this round. Compare to the golfer's own prior rounds where possible (e.g. fewer 3-putts, better GIR, lower score).
"Vs. your level:" - Compare this round's key stats to what a TYPICAL golfer with this handicap index would normally produce, and say where they're ahead of or behind that benchmark. Use realistic, well-known rules of thumb for amateur golf, e.g.: a ~10 handicap typically hits roughly 6-8 greens in regulation and ~6-8 fairways per round and averages close to 2 putts per green (around 32-34 putts), with very few doubles; a ~20 handicap typically hits ~3-5 GIR, more bogeys and several doubles, and 34-36 putts; scratch-ish players hit 10+ GIR. Scale sensibly to the golfer's actual handicap. If no handicap is given, skip this section.
"Focus areas:" - 1-2 specific, actionable things to work on, grounded in the stats and the comparison above.
"Next time:" - one concrete, achievable goal for the next round.

Rules: Base everything ONLY on the numbers given plus standard golf benchmarks for the stated handicap. Do not invent the golfer's own stats. Keep the whole thing under 150 words. Warm but honest.`;

  try {
    const candidates = await pickModels(key);
    let lastDetail = "";
    let lastStatus = 502;
    for (const model of candidates) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 1200, temperature: 0.7 },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        const cand = data?.candidates?.[0];
        const text = (cand?.content?.parts || [])
          .map((p: any) => p.text || "")
          .join("\n")
          .trim();
        // If the model produced no visible text (e.g. spent the whole budget on
        // internal reasoning and hit MAX_TOKENS before writing), treat it as a
        // failure for this model and try the next candidate rather than returning
        // a blank or half-sentence.
        if (!text) {
          lastDetail = `Empty response (finishReason: ${cand?.finishReason || "unknown"}).`;
          lastStatus = 502;
          continue;
        }
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
