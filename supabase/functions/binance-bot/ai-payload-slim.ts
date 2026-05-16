// @ts-nocheck
import type { Candle } from "./types.ts";

/** OHLCV as dense tuples: [openTimeMs, o, h, l, c, v] oldest→newest (saves JSON keys vs Candle objects). */
export type LlmOhlcvTuple = [number, number, number, number, number, number];

function readIntEnv(key: string, fallback: number, lo: number, hi: number): number {
  const n = Number(Deno.env.get(key) ?? "");
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.floor(n)));
}

/** Groq scan payloads: defaults favor ~5-bar 1m tape (override with GROQ_AI_BARS_*). */
export function readAiLlmBarLimits() {
  return {
    m1: readIntEnv("GROQ_AI_BARS_1M", 5, 3, 40),
    m15tf: readIntEnv("GROQ_AI_BARS_15M_TF", 3, 2, 12),
    h1: readIntEnv("GROQ_AI_BARS_1H", 4, 2, 24),
    h4: readIntEnv("GROQ_AI_BARS_4H", 3, 2, 20),
  };
}

/** Include heavy `ai_scoring_rubric` in user JSON (omit unless `AI_LLM_INCLUDE_SCORING_RUBRIC=1`). */
export function readAiLlmIncludeScoringRubric(): boolean {
  const raw = String(Deno.env.get("AI_LLM_INCLUDE_SCORING_RUBRIC") ?? "")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function tailCandles(
  candles: Candle[] | undefined | null,
  max: number,
): Candle[] {
  if (!Array.isArray(candles) || !candles.length || max <= 0) return [];
  if (candles.length <= max) return candles;
  return candles.slice(-max);
}

export function candlesToLlmTuples(candles: Candle[]): LlmOhlcvTuple[] {
  const out: LlmOhlcvTuple[] = [];
  for (const c of candles) {
    out.push([
      Math.floor(Number(c.openTime) || 0),
      Number(c.open),
      Number(c.high),
      Number(c.low),
      Number(c.close),
      Number(c.volume),
    ]);
  }
  return out;
}

/** Prefer the longer 1m-derived tape (snapshot exposes both last-5 and last-15 1m bars). */
export function pickOneMinuteTape(snapshot: {
  candles5: Candle[];
  candles15: Candle[];
}): Candle[] {
  const a = snapshot.candles15 ?? [];
  const b = snapshot.candles5 ?? [];
  if (a.length >= b.length) return a;
  return b;
}
