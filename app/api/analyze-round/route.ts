import { NextResponse } from "next/server";
import { sanitizeForPrompt } from "@/lib/ai-sanitize";
import { createRouteClient } from "@/lib/supabase-route";
import { formatModelAnalysis, parseAiRequest, parseModelJson, responseSchema } from "@/lib/ai-contract";

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

// Daily caps are enforced in the database (bump_ai_usage, migration 0123) against the
// AUTHENTICATED caller — atomic per-user and global counters that survive serverless cold
// starts and can't be bypassed by hitting a fresh instance. The free-tier/no-billing Gemini
// key remains the ultimate bill-proof backstop.
const USER_DAILY_LIMIT = parseInt(process.env.GEMINI_USER_DAILY_LIMIT || "2", 10);
const GLOBAL_DAILY_LIMIT = parseInt(process.env.GEMINI_DAILY_LIMIT || "200", 10);

// Payload caps — reject oversized/abusive bodies before they reach the model.
const MAX_BODY_BYTES = 24 * 1024; // 24 KB is ample for a round + recent history summary
const MAX_HISTORY = 40;           // only the most recent N prior rounds are ever needed

// Timeouts for upstream calls so a slow provider can't tie up the function.
const MODEL_DISCOVERY_TIMEOUT_MS = 5000;
const GEMINI_TIMEOUT_MS = 25000;

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
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`, { signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS) });
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

  // Require an authenticated caller — this is a rate-limited, cost-bearing resource, not public.
  const supabase = await createRouteClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Please sign in to use AI analysis." }, { status: 401 });

  // Reject oversized bodies before parsing anything.
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Request too large." }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw || "{}"); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const parsed = parseAiRequest(body, MAX_HISTORY);
  if (!parsed) return NextResponse.json({ error: "Invalid analysis data." }, { status: 400 });
  const mode = parsed.mode;
  const current = mode === "round" ? parsed.current : undefined;
  const history = mode === "round" ? parsed.history : [];
  const aggregate = mode === "dashboard" ? parsed.aggregate : undefined;

  // DB-backed daily limit against THIS user (atomic; per-user + global). Soft cost-guard on top
  // of the free-tier/no-billing backstop; replaces the old bypassable in-memory counter.
  const op = mode === "dashboard" ? "dashboard" : "round";
  const { data: gate, error: gateErr } = await supabase.rpc("bump_ai_usage", {
    p_op: op, p_user_limit: USER_DAILY_LIMIT, p_global_limit: GLOBAL_DAILY_LIMIT,
  });
  if (gateErr) return NextResponse.json({ error: "Couldn't verify your usage limit — try again in a moment." }, { status: 503 });
  if (gate && (gate as any).allowed === false) {
    const msg = (gate as any).reason === "user"
      ? "You've reached today's AI analysis limit. It resets tomorrow."
      : "AI analysis has reached today's overall limit. It'll be available again tomorrow.";
    return NextResponse.json({ error: msg }, { status: 429 });
  }

  // Sanitize user-supplied stats before embedding: numbers pass, free-text is truncated/flattened
  // so it can't act as prompt instructions. (Security review #8.)
  const sCurrent = sanitizeForPrompt(current);
  const sHistory = sanitizeForPrompt(history || []);
  const sAggregate = sanitizeForPrompt(aggregate);

  const roundPrompt = `You are a friendly, encouraging golf coach analyzing an amateur golfer's round. Be specific, positive, practical, and concise.

CURRENT ROUND (includes the golfer's handicap index if known):
${JSON.stringify(sCurrent)}

PRIOR ROUNDS (most recent first, may be empty):
${JSON.stringify(sHistory)}

Return JSON with exactly these string fields:
whatWentWell - 1-2 specific positives from this round. Compare to prior rounds where possible.
vsYourLevel - compare key stats to a typical golfer with this handicap. If no handicap is given, return an empty string.
focusAreas - 1-2 specific actionable things to work on.
nextTime - one concrete achievable goal for the next round.

Rules: Base everything ONLY on the numbers given plus standard golf benchmarks for the stated handicap. Do not invent the golfer's own stats. Keep the whole thing under 150 words. Warm but honest.`;

  const dashboardPrompt = `You are a friendly, expert golf coach reviewing an amateur golfer's CAREER stats accumulated across many rounds. Zoom out and find the big patterns. Be specific, encouraging, and practical.

ACCUMULATED STATS (across all the golfer's logged rounds):
${JSON.stringify(sAggregate)}

Return JSON with exactly these string fields:
yourGameRightNow - 1-2 sentences on the overall picture.
strengths - 2-3 specific strengths grounded in the stats and benchmarked appropriately.
biggestOpportunities - 2-3 weaknesses costing the most strokes, with why.
whatToWorkOn - a short prioritized practice plan.

Use realistic amateur-golf benchmarks for the stated handicap (e.g. a ~10 handicap hits ~6-8 GIR and ~32-34 putts; a ~20 handicap hits ~3-5 GIR, more doubles, 34-36 putts; scratch hits 10+ GIR). Base everything ONLY on the numbers given plus these benchmarks; do not invent stats. Keep it under 200 words. Warm, honest, motivating.`;

  const prompt = mode === "dashboard" ? dashboardPrompt : roundPrompt;

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
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.7,
            responseMimeType: "application/json",
            responseSchema: responseSchema(mode),
          },
        }),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
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
        const structured = parseModelJson(mode, text);
        if (!structured) {
          lastDetail = "Model returned invalid structured output.";
          lastStatus = 502;
          continue;
        }
        return NextResponse.json({ analysis: formatModelAnalysis(mode, structured) });
      }
      lastDetail = (await resp.text()).slice(0, 400);
      console.error(`analyze-round provider error ${resp.status}:`, lastDetail);
      lastStatus = resp.status;
      // Only fall through on model-availability / quota issues; otherwise stop.
      if (resp.status !== 429 && resp.status !== 404) break;
    }
    // All models failed — surface Google's actual reason so it can be diagnosed.
    return NextResponse.json(
      // Provider internals stay in server logs; clients get a stable, generic message.
      { error: "The AI service is unavailable right now. Please try again shortly." },
      { status: lastStatus === 429 ? 429 : 502 },
    );
  } catch (e: any) {
    console.error("analyze-round upstream failure:", e?.message);
    return NextResponse.json({ error: "Couldn't reach the AI service." }, { status: 502 });
  }
}
