export type AiMode = "round" | "dashboard";

export type RoundAiSummary = {
  date?: string | null;
  course?: string | null;
  handicapIndex?: number | null;
  score?: number | null;
  toPar?: string | number | null;
  putts?: number | null;
  onePutts?: number | null;
  threePuttsPlus?: number | null;
  gir?: string | number | null;
  fairways?: string | number | null;
  eagles?: number | null;
  birdies?: number | null;
  pars?: number | null;
  bogeys?: number | null;
  doublesOrWorse?: number | null;
};

export type DashboardAiSummary = {
  handicapIndex?: number | null;
  roundsLogged?: number | null;
  avgScoreVsPar?: number | null;
  bestVsPar?: number | null;
  avgDifferential?: number | null;
  avgPuttsPerHole?: number | null;
  threePuttsPerRound?: number | null;
  girPct?: number | null;
  fairwayPct?: number | null;
  scramblingPct?: number | null;
  sandSavePct?: number | null;
  avgByPar?: Record<string, unknown> | null;
  scoringMix?: Record<string, unknown> | null;
  penaltiesTotal?: number | null;
};

export type AiRequest =
  | { mode: "round"; current: RoundAiSummary; history: RoundAiSummary[] }
  | { mode: "dashboard"; aggregate: DashboardAiSummary; history: [] };

const ROUND_KEYS = new Set([
  "date", "course", "handicapIndex", "score", "toPar", "putts", "onePutts",
  "threePuttsPlus", "gir", "fairways", "eagles", "birdies", "pars", "bogeys",
  "doublesOrWorse",
]);
const DASHBOARD_KEYS = new Set([
  "handicapIndex", "roundsLogged", "avgScoreVsPar", "bestVsPar", "avgDifferential",
  "avgPuttsPerHole", "threePuttsPerRound", "girPct", "fairwayPct", "scramblingPct",
  "sandSavePct", "avgByPar", "scoringMix", "penaltiesTotal",
]);

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function finiteNumberOrNull(v: unknown): boolean {
  return v == null || (typeof v === "number" && Number.isFinite(v));
}

function shortScalar(v: unknown): boolean {
  return v == null || finiteNumberOrNull(v) || (typeof v === "string" && v.length <= 120);
}

function boundedNumericObject(v: unknown, depth = 0): boolean {
  if (v == null) return true;
  if (!isPlainObject(v) || depth > 2 || Object.keys(v).length > 20) return false;
  return Object.entries(v).every(([k, value]) => {
    if (k.length > 40) return false;
    if (isPlainObject(value)) return boundedNumericObject(value, depth + 1);
    return shortScalar(value);
  });
}

function validateRound(value: unknown): value is RoundAiSummary {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > ROUND_KEYS.size || keys.some((k) => !ROUND_KEYS.has(k))) return false;
  return Object.values(value).every(shortScalar);
}

function validateDashboard(value: unknown): value is DashboardAiSummary {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > DASHBOARD_KEYS.size || keys.some((k) => !DASHBOARD_KEYS.has(k))) return false;
  for (const [key, v] of Object.entries(value)) {
    if (key === "avgByPar" || key === "scoringMix") {
      if (!boundedNumericObject(v)) return false;
    } else if (!finiteNumberOrNull(v)) {
      return false;
    }
  }
  return true;
}

export function parseAiRequest(input: unknown, maxHistory = 40): AiRequest | null {
  if (!isPlainObject(input)) return null;
  const mode: AiMode = input.mode === "dashboard" ? "dashboard" : "round";
  if (mode === "dashboard") {
    if (!validateDashboard(input.aggregate)) return null;
    return { mode, aggregate: input.aggregate, history: [] };
  }
  if (!validateRound(input.current)) return null;
  const historyRaw = input.history == null ? [] : input.history;
  if (!Array.isArray(historyRaw)) return null;
  const history = historyRaw.slice(0, maxHistory);
  if (!history.every(validateRound)) return null;
  return { mode, current: input.current, history };
}

export type RoundAnalysis = {
  whatWentWell: string;
  vsYourLevel: string;
  focusAreas: string;
  nextTime: string;
};
export type DashboardAnalysis = {
  yourGameRightNow: string;
  strengths: string;
  biggestOpportunities: string;
  whatToWorkOn: string;
};

function cleanText(v: unknown, max = 1200): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : null;
}

export function parseModelJson(mode: AiMode, text: string): RoundAnalysis | DashboardAnalysis | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  if (!isPlainObject(raw)) return null;
  if (mode === "dashboard") {
    const yourGameRightNow = cleanText(raw.yourGameRightNow);
    const strengths = cleanText(raw.strengths);
    const biggestOpportunities = cleanText(raw.biggestOpportunities);
    const whatToWorkOn = cleanText(raw.whatToWorkOn);
    if (!yourGameRightNow || !strengths || !biggestOpportunities || !whatToWorkOn) return null;
    return { yourGameRightNow, strengths, biggestOpportunities, whatToWorkOn };
  }
  const whatWentWell = cleanText(raw.whatWentWell);
  const focusAreas = cleanText(raw.focusAreas);
  const nextTime = cleanText(raw.nextTime);
  const vsYourLevel = raw.vsYourLevel == null ? "" : cleanText(raw.vsYourLevel);
  if (!whatWentWell || vsYourLevel == null || !focusAreas || !nextTime) return null;
  return { whatWentWell, vsYourLevel, focusAreas, nextTime };
}

export function formatModelAnalysis(mode: AiMode, analysis: RoundAnalysis | DashboardAnalysis): string {
  if (mode === "dashboard") {
    const a = analysis as DashboardAnalysis;
    return [
      `Your game right now: ${a.yourGameRightNow}`,
      `Strengths: ${a.strengths}`,
      `Biggest opportunities: ${a.biggestOpportunities}`,
      `What to work on to shoot lower: ${a.whatToWorkOn}`,
    ].join("\n");
  }
  const a = analysis as RoundAnalysis;
  const lines = [`What went well: ${a.whatWentWell}`];
  if (a.vsYourLevel) lines.push(`Vs. your level: ${a.vsYourLevel}`);
  lines.push(`Focus areas: ${a.focusAreas}`, `Next time: ${a.nextTime}`);
  return lines.join("\n");
}

export function responseSchema(mode: AiMode) {
  const properties = mode === "dashboard"
    ? {
        yourGameRightNow: { type: "STRING" },
        strengths: { type: "STRING" },
        biggestOpportunities: { type: "STRING" },
        whatToWorkOn: { type: "STRING" },
      }
    : {
        whatWentWell: { type: "STRING" },
        vsYourLevel: { type: "STRING" },
        focusAreas: { type: "STRING" },
        nextTime: { type: "STRING" },
      };
  return { type: "OBJECT", properties, required: Object.keys(properties) };
}
