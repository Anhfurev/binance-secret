// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { DEFAULT_SYMBOL } from "./constants.ts";
import {
  isPaperScenarioName,
  PAPER_SCENARIO_NAMES,
  type PaperScenarioName,
} from "./paper-scenario-snapshot.ts";
import { runSymbolBatch } from "./run-symbol-batch.ts";
import { normalizeSymbol, toStringValue } from "./utils.ts";

export type PaperScenarioRequest = {
  scenario: PaperScenarioName;
  symbol: string;
  execute: boolean;
};

export function parsePaperScenarioRequest(body: Record<string, unknown> | null): {
  ok: true;
  value: PaperScenarioRequest;
} | {
  ok: false;
  error: string;
} {
  const rawScenario = toStringValue(body?.paper_scenario)?.toLowerCase() ?? "";
  if (!isPaperScenarioName(rawScenario)) {
    return {
      ok: false,
      error: `paper_scenario must be one of: ${PAPER_SCENARIO_NAMES.join(", ")}`,
    };
  }
  const symbol = normalizeSymbol(
    toStringValue(body?.symbol) ?? DEFAULT_SYMBOL,
    DEFAULT_SYMBOL,
  );
  const execute = body?.paper_scenario_execute !== false;
  return { ok: true, value: { scenario: rawScenario, symbol, execute } };
}

export async function runPaperScenario(params: {
  supabase: ReturnType<typeof createClient>;
  request: PaperScenarioRequest;
  lastAiPriceBySymbol: Map<string, number>;
}): Promise<Record<string, unknown>> {
  const { supabase, request, lastAiPriceBySymbol } = params;
  const liveRows = await supabase
    .from("bot_settings")
    .select("id,symbol,is_live_trading_enabled")
    .eq("is_autopilot_enabled", true)
    .eq("symbol", request.symbol)
    .eq("is_live_trading_enabled", true)
    .limit(1);
  if (Array.isArray(liveRows.data) && liveRows.data.length > 0) {
    return {
      ok: false,
      error: "paper_scenario_blocked_live_trading_enabled",
      symbol: request.symbol,
    };
  }

  const batch = await runSymbolBatch({
    supabase,
    symbolFilter: request.symbol,
    lastAiPriceBySymbol,
    paperScenario: {
      name: request.scenario,
      execute: request.execute,
    },
  });

  return {
    ok: true,
    mode: "paper_scenario",
    scenario: request.scenario,
    symbol: request.symbol,
    execute: request.execute,
    scanned: batch.scanned,
    actions: batch.actions,
    cycle_id: batch.cycleId,
  };
}
