/**
 * Synthetic “BTC pump” drill: real-shaped IndicatorSnapshot + injected AI verdict,
 * no exchange / LLM calls. Asserts the decider can reach BUY and risk-to-stop math.
 *
 * Run (from repo):
 *   cd supabase/functions/binance-bot && deno test --allow-env tests/synthetic_pump_test.ts
 *
 * Full paper ledger + partial-TP lifecycle needs Supabase RPCs; use deployed curl
 * `paper_scenario` + `paper_scenario_execute: true` against your project for that.
 */
// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import type { AiAnalysis, Candle, IndicatorSnapshot } from "../types.ts";
import { calculateTechnicalScore, checkEntryConditions } from "../strategy.ts";
import { decideSymbolCycleOutcome } from "../cycle-decider.ts";
import { getRequiredConfidence } from "../config/trading-policy.ts";
import { resolveTradeRegime } from "../regime-scaling.ts";
import { resolveRiskToStopNotionalUsd, readRiskPerTradePercent } from "../risk-to-stop-sizing.ts";

const USER = "00000000-0000-4000-8000-000000000001";
const BOT_ID = "bot-synthetic-pump";

/** Fluent stub: no open rows, zero head-counts, terminal `limit(>1)` → empty array. */
function createPumpStubSupabase() {
  const nullRow = { data: null, error: null };
  const headResult = { count: 0, error: null };
  const emptyArray = { data: [], error: null };

  function headCountChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const step = () => chain;
    chain.eq = step;
    chain.in = step;
    chain.gte = step;
    chain.ilike = step;
    chain.or = step;
    chain.then = (onF: (v: typeof headResult) => unknown) => Promise.resolve(headResult).then(onF);
    chain.catch = (onR: (e: unknown) => unknown) => Promise.resolve(headResult).catch(onR);
    return chain;
  }

  function rowSelectChain(): Record<string, unknown> {
    const chain: Record<string, unknown> = {};
    const step = () => chain;
    chain.eq = step;
    chain.in = step;
    chain.ilike = step;
    chain.or = step;
    chain.gte = step;
    chain.order = () => ({
      limit: (n: number) =>
        n === 1
          ? { maybeSingle: async () => nullRow }
          : Promise.resolve(emptyArray),
    });
    chain.limit = (n: number) =>
      n === 1 ? { maybeSingle: async () => nullRow } : Promise.resolve(emptyArray);
    chain.maybeSingle = async () => nullRow;
    return chain;
  }

  const tradesFrom = {
    select(_cols?: unknown, opts?: { count?: string; head?: boolean }) {
      if (opts?.count === "exact" && opts?.head) return headCountChain();
      return rowSelectChain();
    },
    insert: async () => ({ error: null }),
    update: () => ({
      eq: () => ({
        ilike: async () => ({ error: null }),
      }),
    }),
  };

  return {
    from(table: string) {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { demo_balance: 10000, starting_balance: 10000, max_drawdown_limit: 50 },
                error: null,
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      }
      if (table === "trades") return tradesFrom;
      return rowSelectChain();
    },
    rpc: async () => "reservation-stub",
  } as import("npm:@supabase/supabase-js@2").SupabaseClient;
}

function candle(ts: number, close: number, vol: number): Candle {
  const c = Number(close.toFixed(8));
  return {
    openTime: ts,
    open: c * 0.999,
    high: c * 1.001,
    low: c * 0.998,
    close: c,
    volume: vol,
  };
}

/** High-probability tape: tight spread, strong 1m quote flow, price above EMA200, TRENDING. */
/** `AiTrend` is bullish|bearish|neutral — “BULLISH_PUMP” intent = bullish + price > ema200. */
export function buildSyntheticPumpSnapshot(): IndicatorSnapshot {
  const now = Date.now();
  const px = 100_000;
  const tape = [candle(now - 180_000, px * 0.997, 120_000), candle(now - 120_000, px * 0.9985, 130_000), candle(now - 60_000, px, 150_000)];
  return {
    symbol: "BTCUSDT",
    latestPrice: px,
    imbalance_ratio: 1.12,
    candles5: tape,
    candles15: tape,
    candles15m: tape,
    candles1h: tape,
    candles4h: tape,
    trend_htf: {
      trend_1h: "bull",
      trend_4h: "bull",
      mtf_aligned: true,
      trend_15m: "bull",
      mtf_ltf_aligned: true,
      mtf_effective_ok: true,
    },
    marketRegime: "TRENDING",
    adx14: 32,
    atr14: px * 0.004,
    dayLow24h: px * 0.97,
    volume24hQuote: 5_000_000_000,
    spreadBps: 2,
    avgVolume1m: 100_000,
    rsi: 58,
    rsi15m: 56,
    bbLower: px * 0.97,
    bbMiddle: px * 0.99,
    bbUpper: px * 1.02,
    ema200: px * 0.96,
    ema50: px * 0.985,
    emaFast: px * 0.995,
    emaSlow: px * 0.992,
    macd: { macd: 2.5, signal: 1.0, histogram: 1.2 },
  };
}

function buildPumpAi(minFloor: number): AiAnalysis {
  const floor = Math.max(minFloor, 62);
  return {
    ai_confidence: 85,
    trend: "bullish",
    trend_alignment: true,
    action: "BUY",
    trend_score: 80,
    momentum_score: 75,
    volume_score: 78,
    order_book_score: 82,
    groq_verdict: "APPROVE",
    groq_reason: "synthetic_pump_fixture",
    ai_provider: "synthetic_fixture",
    ai_provider_path: "synthetic_pump_test",
    ai_cache_status: "synthetic",
    sentiment_vibe: {
      fear_greed_value: 55,
      fear_greed_label: "Neutral",
      hack_major_alert: false,
      hack_sample_title: null,
      sources: [],
      penalty_applied: false,
      penalty_factor: 1,
    },
  };
}

function pumpBotRow(): Record<string, unknown> {
  return {
    id: BOT_ID,
    user_id: USER,
    symbol: "BTCUSDT",
    is_autopilot_enabled: true,
    is_live_trading_enabled: false,
    is_aggressive_mode: true,
    is_ghost_execution: false,
    min_ai_confidence: 55,
    min_ai_confidence_trending: 52,
    min_ai_confidence_ranging: 54,
    min_tech_score: 4,
    risk_percent: 1,
    trade_size_usd: 0,
    take_profit_pct: 3,
    stop_loss_pct: 1.5,
    trailing_stop_pct: 0.5,
    max_open_trades: 5,
  };
}

Deno.test("synthetic pump snapshot: strategy BUY + tech score clears paper live-style floor", () => {
  Deno.env.set("PAPER_LIVE_STYLE_PRACTICE", "0");
  try {
    const snap = buildSyntheticPumpSnapshot();
    const entry = checkEntryConditions(snap, { paperExploration: false });
    assertEquals(entry.signal, "BUY");
    const tech = calculateTechnicalScore(snap);
    assertEquals(tech >= 8, true, `technical_score=${tech} wanted >= 8 for paper live-style floor`);
  } finally {
    Deno.env.delete("PAPER_LIVE_STYLE_PRACTICE");
  }
});

Deno.test("synthetic pump: decider reaches BUY with prefetched AI (no LLM)", async () => {
  Deno.env.set("PAPER_LIVE_STYLE_PRACTICE", "0");
  const stub = createPumpStubSupabase();
  const snap = buildSyntheticPumpSnapshot();
  const row = pumpBotRow();
  const tradeRegime = resolveTradeRegime("BTCUSDT", snap.latestPrice, snap.atr14);
  const policy = getRequiredConfidence(10_000, tradeRegime);
  const minFloor = Math.max(Number(row.min_ai_confidence), policy.minAiConfidence);
  const prefetchedAi = buildPumpAi(minFloor);

  try {
    const outcome = await decideSymbolCycleOutcome({
      row,
      supabase: stub,
      signal: new AbortController().signal,
      symbol: "BTCUSDT",
      userId: USER,
      cycleId: "synthetic-pump-cycle",
      snapshot: snap,
      lastAiPriceBySymbol: new Map([["BTCUSDT", snap.latestPrice]]),
      paperScenario: null,
      btcOverbought: false,
      prefetchedAiVerdict: { ai: prefetchedAi, aiQuotaFallback: false },
    });

    console.log("[synthetic_pump_test] decision=", outcome.decision, "reason=", outcome.reason);
    console.log("[synthetic_pump_test] strategy_signal=", outcome.strategySignal, "technical_score=", outcome.technicalScore);

    if (outcome.decision !== "BUY") {
      const vd = outcome.vetoDetailsPayload as Record<string, unknown> | undefined;
      console.log("[synthetic_pump_test] veto_details=", JSON.stringify(vd, null, 2));
      const audit = vd?.trading_policy_audit as Record<string, unknown> | undefined;
      console.log("[synthetic_pump_test] policy_rule_refs=", JSON.stringify(audit?.policy_rule_refs ?? []));
      console.log("[synthetic_pump_test] blocked_trading_policy_rules=", JSON.stringify(vd?.blocked_trading_policy_rules ?? []));
      console.log("[synthetic_pump_test] hold_reason=", outcome.reason);
    }

    assertEquals(outcome.decision, "BUY");
  } finally {
    Deno.env.delete("PAPER_LIVE_STYLE_PRACTICE");
  }
});

Deno.test("synthetic pump: risk-to-stop uses 1% wallet risk default", () => {
  assertEquals(readRiskPerTradePercent(), 1);
  const sized = resolveRiskToStopNotionalUsd({
    totalEquity: 10_000,
    entryPrice: 100_000,
    stopLossPrice: 99_000,
  });
  assertEquals(sized.riskUsd, 100);
  assertEquals(sized.riskPerTradePct, 1);
  assertEquals(sized.cappedByNotional, true);
});

/*
Manual run (same as header):
  cd supabase/functions/binance-bot && deno test --allow-env tests/synthetic_pump_test.ts
*/
