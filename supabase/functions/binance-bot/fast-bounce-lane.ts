// @ts-nocheck
/** Ultra-low-latency bounce entry — math trigger → Binance futures brackets (no inline LLM). */

import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotSettingsRow, IndicatorSnapshot } from "./types.ts";
import type { BotGlobalSettingsRow } from "./bot-global-settings.ts";
import { executeFuturesBounceBrackets } from "./binance-futures-client.ts";
import { buildFastLaneAiStub } from "./fast-math-entry.ts";
import { finalizeBuyExecution } from "./buy-finalize.ts";
import { botDebug, botWarn } from "./bot-debug.ts";
import { assertExpectedEgressIpOrThrow } from "./exchange-client.ts";
import { resolveExchangeSkipped } from "./bot-shared.ts";
import { toStringValue } from "./utils.ts";
import { buildAiReasoningJson } from "./buy-helpers.ts";
import { coinIdFromSymbol } from "./utils.ts";

export async function executeFastBounceFuturesBuy(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  userId: string;
  symbol: string;
  snapshot: IndicatorSnapshot;
  global: BotGlobalSettingsRow;
  strategyNotes: string;
  currentBalance: number;
  resolvedStartingBalance: number;
  shouldInitializeStartingBalance: boolean;
  trailingStopPct: number;
  cycleId: string;
  signal?: AbortSignal;
}) {
  const started = performance.now();
  const {
    supabase,
    row,
    userId,
    symbol,
    snapshot,
    global,
    strategyNotes,
    currentBalance,
    resolvedStartingBalance,
    shouldInitializeStartingBalance,
    trailingStopPct,
    cycleId,
  } = params;

  const ai: AiAnalysis = buildFastLaneAiStub();
  const botId = toStringValue((row as { id?: string }).id);
  const ghostMode = false;
  const isPaperOnly = resolveExchangeSkipped(row) || Boolean(
    Deno.env.get("IS_PAPER_TRADING") === "1",
  );

  if (!isPaperOnly) {
    await assertExpectedEgressIpOrThrow();
  }

  const brackets = await executeFuturesBounceBrackets({
    symbol,
    global,
    referencePrice: Number(snapshot.latestPrice),
    stopPct: 0.01,
    takeProfitPct: 0.02,
  });

  const entryForDb = brackets.entryPrice;
  const filledQty = brackets.quantity;
  const valueUsd = Number((filledQty * entryForDb).toFixed(8));
  const stopLossPersist = Number((entryForDb * 0.99).toFixed(8));
  const takeProfitPersist = Number((entryForDb * 1.02).toFixed(8));
  const slDistance = entryForDb - stopLossPersist;
  const trailDistance = entryForDb * (trailingStopPct / 100);
  const initialTrailingPersist = Number((entryForDb - trailDistance).toFixed(8));

  const aiReasoningJson = buildAiReasoningJson(ai, 68, {
    raw_weighted: 68,
    weighted_pre_sentiment_vibe: 68,
    bearish_1h_cap: false,
    mtf: { fast_lane: true },
    market_regime: String(global.market_regime ?? "NEUTRAL") as import("./types.ts").MarketRegime,
    adx14: Number(snapshot.adx14 ?? 0),
    score_weight_profile: "mean_reversion",
    resolved_weights: { trend: 0.25, momentum: 0.35, volume: 0.2, order_book: 0.2 },
    war_room: undefined,
  });

  const finalized = await finalizeBuyExecution({
    supabase,
    userId,
    symbol,
    ai,
    strategyNotes: `${strategyNotes}|fast_futures_lane`,
    botId,
    cycleId,
    buyOrderId: brackets.entryOrderId,
    isTestMode: isPaperOnly,
    ghostMode,
    shouldInitializeStartingBalance,
    resolvedStartingBalance,
    currentBalance,
    snapshotPrice: Number(snapshot.latestPrice),
    requestedQty: filledQty,
    filledQty,
    entryForDb,
    valueUsd,
    stopLossPersist,
    takeProfitPersist,
    initialTrailingPersist,
    trailingStopPct,
    atr14: Number(snapshot.atr14 ?? 0),
    atrTrailEffective: trailDistance,
    vb: 1,
    slDistance,
    trailDistance,
    effectiveConfidence: 68,
    rawWeighted: 68,
    bearish1hCap: false,
    aiReasoningJson,
    coinId: coinIdFromSymbol(symbol),
    technical: "BUY",
    buyOrder: {
      exchange_order_id: brackets.entryOrderId,
      amount: filledQty,
      price: entryForDb,
      futures: true,
      stop_order_id: brackets.stopOrderId,
      tp_order_id: brackets.takeProfitOrderId,
    },
    openedAt: new Date().toISOString(),
    sizingMeta: {
      fast_lane: true,
      notional_usd: brackets.notionalUsd,
      leverage: brackets.leverage,
      global_trade_multiplier: global.global_trade_multiplier,
    },
  });

  const elapsed = Math.round(performance.now() - started);
  botDebug("fastBounceLane", "futures_buy_complete", {
    userId,
    symbol,
    elapsed_ms: elapsed,
    entry: entryForDb,
    notional: brackets.notionalUsd,
  });
  if (elapsed > 500) {
    botWarn("fastBounceLane", "slow_execution", { userId, symbol, elapsed_ms: elapsed });
  }

  return {
    action: "buy" as const,
    detail: `fast_futures_bounce ${elapsed}ms notional=$${brackets.notionalUsd.toFixed(2)}`,
    finalized,
  };
}
