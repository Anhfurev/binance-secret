// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  extractJsonFromGeminiText,
  parseMacroSettingsJson,
} from "../macro-settings-schema.ts";

Deno.test("parseMacroSettingsJson accepts valid regime object", () => {
  const row = parseMacroSettingsJson(JSON.stringify({
    market_regime: "HIGH_RISK_CRASH",
    allowed_leverage: 5,
    global_trade_multiplier: 0.4,
  }));
  assertEquals(row?.market_regime, "HIGH_RISK_CRASH");
  assertEquals(row?.allowed_leverage, 5);
  assertEquals(row?.global_trade_multiplier, 0.4);
});

Deno.test("parseMacroSettingsJson rejects invalid regime", () => {
  assertEquals(
    parseMacroSettingsJson('{"market_regime":"NEUTRAL","allowed_leverage":10,"global_trade_multiplier":1}'),
    null,
  );
});

Deno.test("extractJsonFromGeminiText strips prose wrapper", () => {
  const inner = '{"market_regime":"RANGE_BOUND","allowed_leverage":10,"global_trade_multiplier":1}';
  const wrapped = `Here is JSON:\n${inner}\nThanks`;
  assertEquals(parseMacroSettingsJson(extractJsonFromGeminiText(wrapped))?.market_regime, "RANGE_BOUND");
});

Deno.test("parseMacroSettingsJson clamps multiplier to 1.2 max", () => {
  const row = parseMacroSettingsJson(JSON.stringify({
    market_regime: "TRENDING_BULL",
    allowed_leverage: 10,
    global_trade_multiplier: 9,
  }));
  assertEquals(row?.global_trade_multiplier, 1.2);
});
