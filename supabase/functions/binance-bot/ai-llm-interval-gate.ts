// @ts-nocheck
/**
 * Hard bucket for outbound Gemini/Groq HTTP — independent of math flashes mid-cycle.
 * Math may pass tier-1, but LLM cascade only runs once per interval per symbol.
 */

import { GLOBAL_BOT_CONFIG, IS_TEST_MODE } from "./config.ts";
import { getLatestAiCacheEntry } from "./ai-db.ts";

export type AiLlmOutboundGate = {
  allowOutbound: boolean;
  ageMs: number | null;
  waitMs: number;
  intervalMs: number;
};

function readEnvIntervalMs(key: string, fallback: number): number {
  const raw = String(Deno.env.get(key) ?? "").trim();
  if (!raw.length) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(3_600_000, Math.max(30_000, Math.floor(n)));
}

/** Minimum ms between outbound Gemini/Groq calls per symbol (default 15m, aligns with cache window). */
export function readAiLlmOutboundIntervalMs(): number {
  if (IS_TEST_MODE) return 0;
  const explicit = String(Deno.env.get("AI_LLM_INTERVAL_MS") ?? "").trim();
  if (explicit.length) return readEnvIntervalMs("AI_LLM_INTERVAL_MS", 900_000);
  return GLOBAL_BOT_CONFIG.AI_CACHE_WINDOW_MS;
}

export async function evaluateAiLlmOutboundGate(symbol: string): Promise<AiLlmOutboundGate> {
  const intervalMs = readAiLlmOutboundIntervalMs();
  const sym = String(symbol ?? "").trim().toUpperCase();
  if (intervalMs <= 0) {
    return { allowOutbound: true, ageMs: null, waitMs: 0, intervalMs: 0 };
  }
  const latest = await getLatestAiCacheEntry(sym);
  if (!latest) {
    return { allowOutbound: true, ageMs: null, waitMs: 0, intervalMs };
  }
  const ageMs = latest.ageMs;
  if (ageMs >= intervalMs) {
    return { allowOutbound: true, ageMs, waitMs: 0, intervalMs };
  }
  return {
    allowOutbound: false,
    ageMs,
    waitMs: Math.max(0, intervalMs - ageMs),
    intervalMs,
  };
}

export function buildAiIntervalGateLog(symbol: string, gate: AiLlmOutboundGate): string {
  const ageSec = gate.ageMs != null ? Math.round(gate.ageMs / 1000) : 0;
  const waitSec = Math.round(gate.waitMs / 1000);
  return `[AI_INTERVAL_GATE] ${symbol} outbound_blocked last_llm_age_s=${ageSec} wait_s=${waitSec} interval_s=${Math.round(gate.intervalMs / 1000)}`;
}
