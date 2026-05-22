// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { fireAndForgetTableUpsert } from "./async-supabase-writes.ts";
import type { DebugRawAiResponse } from "./types.ts";
import { toFixedNoExponents } from "./utils.ts";

function buildDebugRawAiResponse(params: {
  discriminator: "cache" | "live" | "timeout";
  reason: string | null;
  debugNote?: string;
  latestPrice?: number;
  perfMetadata?: Record<string, unknown>;
  ai: {
    ai_confidence?: number;
    ai_provider?: string;
    ai_cache_status?: string;
    ai_provider_path?: string;
    raw_ai_response?: unknown;
    raw_groq_veto_response?: unknown;
    groq_verdict?: string;
    groq_reason?: string;
  };
}): DebugRawAiResponse {
  const { discriminator, reason, debugNote, latestPrice, perfMetadata, ai } = params;
  const provider = String(ai.ai_provider ?? "unknown").toLowerCase();
  const confidence = Number(ai.ai_confidence);
  const normalizedConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : null;
  const isGroqPrimary = provider === "groq";
  return {
    schema_version: 1,
    discriminator,
    provider: ai.ai_provider ?? "unknown",
    provider_path: ai.ai_provider_path ?? "n/a",
    cache_status: ai.ai_cache_status ?? "unknown",
    confidence: ai.ai_confidence ?? null,
    gemini_conf: normalizedConfidence,
    groq_conf: isGroqPrimary ? normalizedConfidence : null,
    reason: reason ?? debugNote ?? null,
    force_buy_reason: debugNote ?? null,
    raw_price: Number.isFinite(Number(latestPrice)) ? Number(latestPrice) : null,
    formatted_price: Number.isFinite(Number(latestPrice))
      ? toFixedNoExponents(Number(latestPrice))
      : null,
    perf_metadata: perfMetadata ?? null,
    model_response: ai.raw_ai_response ?? null,
    groq_veto: ai.raw_groq_veto_response ?? {
      verdict: ai.groq_verdict ?? null,
      reason: ai.groq_reason ?? null,
    },
  };
}

export async function persistDebugTrace(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  botId: string | null;
  cycleId: string;
  symbol: string;
  decision: "BUY" | "SELL" | "HOLD";
  techScore?: number;
  rsi?: number;
  bbPosition?: number;
  latestPrice?: number;
  debugNote?: string;
  reason?: string | null;
  perfMetadata?: Record<string, unknown>;
  ai: {
    ai_confidence?: number;
    ai_provider?: string;
    ai_cache_status?: string;
    ai_provider_path?: string;
    raw_ai_response?: unknown;
    raw_groq_veto_response?: unknown;
    groq_verdict?: string;
    groq_reason?: string;
  };
}) {
  const {
    supabase,
    userId,
    botId,
    cycleId,
    symbol,
    decision,
    techScore,
    rsi,
    bbPosition,
    latestPrice,
    debugNote,
    reason,
    perfMetadata,
    ai,
  } = params;
  const rawPayload: DebugRawAiResponse = buildDebugRawAiResponse({
    discriminator: ai.ai_cache_status === "hit" ? "cache" : "live",
    reason: reason ?? null,
    debugNote,
    latestPrice,
    perfMetadata,
    ai,
  });
  const confidence = Number(ai.ai_confidence);
  const normalizedConfidence = Number.isFinite(confidence)
    ? Math.max(0, Math.min(100, Math.round(confidence)))
    : null;
  const provider = String(ai.ai_provider ?? "").toLowerCase();
  const isGroqPrimary = provider === "groq";
  const payload = {
    user_id: userId,
    bot_id: botId,
    cycle_id: cycleId,
    symbol,
    tech_score: Number.isFinite(Number(techScore)) ? Math.round(Number(techScore)) : null,
    rsi: Number.isFinite(Number(rsi)) ? Number(rsi) : null,
    bb_position: Number.isFinite(Number(bbPosition)) ? Number(bbPosition) : null,
    gemini_conf: normalizedConfidence,
    groq_conf: isGroqPrimary ? normalizedConfidence : null,
    final_decision: decision,
    raw_ai_response: rawPayload,
  };
  fireAndForgetTableUpsert(
    supabase,
    "bot_debug_traces",
    payload,
    { onConflict: "cycle_id,symbol,user_id" },
    `debug_trace_${symbol}`,
  );
}

export function enqueueTraceReasonOnly(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  botId: string | null;
  cycleId: string;
  symbol: string;
  decision: "BUY" | "SELL" | "HOLD";
  reason: string;
  perfMetadata?: Record<string, unknown>;
}): void {
  void captureTraceReasonOnly(params);
}

export async function captureTraceReasonOnly(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string | null;
  botId: string | null;
  cycleId: string;
  symbol: string;
  decision: "BUY" | "SELL" | "HOLD";
  reason: string;
  perfMetadata?: Record<string, unknown>;
}) {
  const { supabase, userId, botId, cycleId, symbol, decision, reason, perfMetadata } = params;
  fireAndForgetTableUpsert(
    supabase,
    "bot_debug_traces",
    {
      user_id: userId,
      bot_id: botId,
      cycle_id: cycleId,
      symbol,
      final_decision: decision,
      raw_ai_response: buildDebugRawAiResponse({
        discriminator: "timeout",
        reason,
        perfMetadata,
        ai: { ai_provider: "runtime" },
      }),
    },
    { onConflict: "cycle_id,symbol,user_id" },
    `trace_reason_${symbol}`,
  );
}
