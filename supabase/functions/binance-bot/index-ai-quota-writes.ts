// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { BotSettingsRow } from "./types.ts";
import { getGeminiCooldownMsRemaining } from "./ai-core.ts";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";
import { toStringValue } from "./utils.ts";

export const MAX_CONSECUTIVE_GEMINI_FAILURES = 3;
export const EMERGENCY_ABORT_MESSAGE = "Emergency Abort: Quota Limit Hit";

export class EmergencyAbortQuotaError extends Error {
  constructor() {
    super("EMERGENCY_ABORT_QUOTA_LIMIT_HIT");
    this.name = "EmergencyAbortQuotaError";
  }
}

export function isEmergencyAbortQuotaError(error: unknown): boolean {
  return error instanceof EmergencyAbortQuotaError ||
    (error instanceof Error && error.message === "EMERGENCY_ABORT_QUOTA_LIMIT_HIT");
}

export async function markAiQuotaFallback(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  detail: string;
}) {
  const { supabase, row, symbol, detail } = params;
  const botId = toStringValue((row as any)?.id);
  const userId = toStringValue((row as any)?.user_id);
  const cooldownMs = await getGeminiCooldownMsRemaining();
  const cooldownUntil = new Date(Date.now() + cooldownMs).toISOString();
  const nowIso = new Date().toISOString();
  const logResult = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "warn",
    source: "ai",
    message: "rate_limit_hit",
    meta: {
      event: "rate_limit_hit",
      provider: "gemini",
      use_fallback: true,
      bot_id: botId ?? null,
      cooldown_ms: cooldownMs,
      cooldown_until: cooldownUntil,
      detail,
    },
  }]);
  if (logResult.error) {
    console.error(`[binance-bot] failed to log rate_limit_hit: ${logResult.error.message}`);
  }
  const statusResult = await supabase.from("bot_settings").update({
    model_status: "OpenAI-Only",
    model_status_until: cooldownUntil,
    updated_at: nowIso,
    ai_cache_invalidate_until: cooldownUntil,
  } as any).eq("id", botId ?? "");
  if (statusResult.error) {
    console.warn(`[binance-bot] bot_settings model_status update skipped: ${statusResult.error.message}`);
  }
}

async function logEmergencyAbort(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  detail: string;
}) {
  const { supabase, row, symbol, detail } = params;
  const userId = toStringValue((row as any)?.user_id);
  const botId = toStringValue((row as any)?.id);
  const logResult = await supabase.from("logs").insert([{
    user_id: userId ?? null,
    symbol,
    level: "error",
    source: "ai",
    message: EMERGENCY_ABORT_MESSAGE,
    meta: {
      event: "emergency_abort_quota_limit_hit",
      provider: "gemini",
      bot_id: botId ?? null,
      consecutive_failures: (await getAiQuotaState())?.consecutive_gemini_failures ?? 0,
      detail,
    },
  }]);
  if (logResult.error) {
    console.error(`[binance-bot] failed to log emergency quota abort: ${logResult.error.message}`);
  }
}

export async function registerGeminiFailureAndAbortIfNeeded(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  symbol: string;
  detail: string;
}) {
  const quota = await getAiQuotaState();
  const nextFailures = Number(quota?.consecutive_gemini_failures ?? 0) + 1;
  await patchAiQuotaState({
    consecutive_gemini_failures: nextFailures,
    last_failure_at: new Date().toISOString(),
  });
  if (nextFailures < MAX_CONSECUTIVE_GEMINI_FAILURES) return;
  await logEmergencyAbort(params);
  throw new EmergencyAbortQuotaError();
}
