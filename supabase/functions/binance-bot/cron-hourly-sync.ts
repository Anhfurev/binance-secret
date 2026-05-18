// @ts-nocheck
/**
 * Hourly macro strategist — pg_cron / external scheduler → `hourly_sync_only` on binance-bot.
 * Updates `bot_global_settings` for the millisecond fast lane (no per-tick LLM).
 */

import type { createClient } from "npm:@supabase/supabase-js@2";
import { botDebug, botError } from "./bot-debug.ts";
import {
  persistBotGlobalSettings,
  SAFE_MACRO_DEFAULTS,
  type BotGlobalSettingsRow,
} from "./bot-global-settings.ts";
import { fetchMacro15mOhlcvBundle } from "./macro-ohlcv-bundle.ts";
import { safeAnalyzeMacroSettings } from "./macro-llm-pro.ts";
import { safeExecute } from "./safe-execute.ts";
import { formatUnknownError, jsonResponse } from "./utils.ts";

export type HourlyMacroSyncResult = {
  ok: boolean;
  batch_id: string;
  elapsed_ms: number;
  source: "llm" | "fallback";
  settings: BotGlobalSettingsRow;
  llm_model?: string;
  llm_error?: string;
  persist_error?: string;
};

async function logHourlySyncEvent(
  supabase: ReturnType<typeof createClient>,
  meta: Record<string, unknown>,
) {
  await safeExecute("hourly_macro_sync_log", () =>
    supabase.from("logs").insert([{
      level: meta.ok === false ? "error" : "info",
      source: "hourly-macro-sync",
      message: String(meta.event ?? "hourly_macro_sync"),
      meta,
      created_at: new Date().toISOString(),
    }]), undefined);
}

export async function runHourlyMacroSync(params: {
  supabase: ReturnType<typeof createClient>;
  batchId?: string;
}): Promise<HourlyMacroSyncResult> {
  const started = Date.now();
  const batchId = params.batchId ?? `hourly-${crypto.randomUUID().slice(0, 8)}`;
  botDebug("hourlySync", "start", { batch_id: batchId });

  let settings: BotGlobalSettingsRow = { ...SAFE_MACRO_DEFAULTS };
  let source: "llm" | "fallback" = "fallback";
  let llmModel = "";
  let llmError: string | undefined;

  try {
    const bundle = await fetchMacro15mOhlcvBundle();
    botDebug("hourlySync", "ohlcv_ready", {
      batch_id: batchId,
      symbols: bundle.symbols.map((s) => s.symbol),
      bars: bundle.symbols.map((s) => s.candles.length),
    });

    const llm = await safeAnalyzeMacroSettings(bundle, batchId);
    llmModel = llm.model;
    if (llm.settings) {
      settings = llm.settings;
      source = "llm";
    } else {
      llmError = llm.error ?? "invalid_or_empty_llm_json";
      console.warn(`[hourly_sync] LLM fallback: ${llmError}`);
    }
  } catch (error) {
    llmError = formatUnknownError(error);
    botError("hourlySync", "pipeline_error", { batch_id: batchId, detail: llmError });
  }

  const persist = await persistBotGlobalSettings(params.supabase, settings);
  if (!persist.ok) {
    const persistError = persist.error ?? "persist_failed";
    await logHourlySyncEvent(params.supabase, {
      event: "hourly_macro_persist_failed",
      ok: false,
      batch_id: batchId,
      detail: persistError,
      settings,
    });
    return {
      ok: false,
      batch_id: batchId,
      elapsed_ms: Date.now() - started,
      source,
      settings,
      llm_model: llmModel,
      llm_error: llmError,
      persist_error: persistError,
    };
  }

  const result: HourlyMacroSyncResult = {
    ok: true,
    batch_id: batchId,
    elapsed_ms: Date.now() - started,
    source,
    settings,
    llm_model: llmModel,
    llm_error: llmError,
  };

  await logHourlySyncEvent(params.supabase, {
    event: "hourly_macro_sync_complete",
    ok: true,
    ...result,
  });

  console.log("[hourly_sync] complete", {
    batch_id: batchId,
    source,
    regime: settings.market_regime,
    leverage: settings.allowed_leverage,
    mult: settings.global_trade_multiplier,
    elapsed_ms: result.elapsed_ms,
  });

  return result;
}

export async function handleHourlyMacroSync(
  supabase: ReturnType<typeof createClient>,
): Promise<Response> {
  const result = await runHourlyMacroSync({ supabase });
  return jsonResponse(
    { ok: result.ok, mode: "hourly_sync_only", ...result },
    result.ok ? 200 : 503,
  );
}
