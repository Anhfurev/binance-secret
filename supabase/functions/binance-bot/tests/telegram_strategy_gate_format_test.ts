// @ts-nocheck
import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  formatAiPipelineIssueBannerHtml,
  formatStrategyGateTelegramSectionHtml,
} from "../telegram-strategy-gate-format.ts";

Deno.test("formatStrategyGateTelegramSectionHtml includes dominant fail + scorecard", () => {
  const html = formatStrategyGateTelegramSectionHtml({
    symbol: "BTCUSDT",
    strategyEntry: {
      signal: "HOLD",
      strategy_reason: "strategy_no_entry_signal",
      strategy_fail_detail: "RSI_NOT_OVERSOLD",
    },
    strategySignal: "HOLD",
    strategyFailDetail: "FAIL_STRATEGY:RSI_NOT_OVERSOLD",
    combinedStrategyReason: "strategy_no_entry_signal|hold_no_strategy_buy",
    preflight: {
      scorecard: { ema200: true, rsi_ok: true, mtf_ok: false, vol_ok: true, tech_score_ok: true, strategy_buy_ok: false },
      veto_reasons: ["FAIL_MTF_ALIGNMENT", "FAIL_STRATEGY_NO_BUY"],
      passedCount: 4,
      totalGates: 6,
    },
    gateHumanLine: "Strategy: Volume too low for Tech Score 5",
    finalDecision: "HOLD",
    minAiConfidence: 72,
    currentPrice: 99_000.5,
  });
  assertStringIncludes(html, "RSI_NOT_OVERSOLD");
  assertStringIncludes(html, "mtf_ok:✗");
  assertStringIncludes(html, "FAIL_MTF_ALIGNMENT");
  assertStringIncludes(html, "4/6");
});

Deno.test("formatAiPipelineIssueBannerHtml when quota fallback", () => {
  const html = formatAiPipelineIssueBannerHtml({
    symbol: "ETHUSDT",
    aiQuotaFallback: true,
    aiVerdictErrorDetail: null,
    ai: { ai_confidence: 0, action: "HOLD", trend: "neutral", trend_alignment: false },
  });
  assertEquals(html != null, true);
  assertStringIncludes(html!, "AI PIPELINE");
  assertStringIncludes(html!, "Quota");
});

Deno.test("formatAiPipelineIssueBannerHtml when verdict threw", () => {
  const html = formatAiPipelineIssueBannerHtml({
    symbol: "SOLUSDT",
    aiQuotaFallback: false,
    aiVerdictErrorDetail: "payload too large for model",
    ai: { ai_confidence: 0, action: "HOLD", trend: "neutral", trend_alignment: false },
  });
  assertStringIncludes(html!, "payload too large");
});
