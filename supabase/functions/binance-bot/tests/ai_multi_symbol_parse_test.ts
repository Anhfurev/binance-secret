import { assertEquals } from "jsr:@std/assert";
import { parseMultiSymbolLlmContentToMap } from "../ai-multi-symbol-parse.ts";

Deno.test("parseMultiSymbolLlmContentToMap unwraps results wrapper", () => {
  const items = [
    { symbol: "BTCUSDT", data: { x: 1 } },
    { symbol: "SOLUSDT", data: { x: 2 } },
  ];
  const raw = JSON.stringify({
    results: {
      BTCUSDT: {
        trend_score: 55,
        momentum_score: 55,
        volume_score: 55,
        order_book_score: 55,
        trend_alignment: true,
        action: "HOLD",
        pro_tip: "wait",
      },
      SOLUSDT: {
        trend_score: 60,
        momentum_score: 60,
        volume_score: 60,
        order_book_score: 60,
        trend_alignment: true,
        action: "BUY",
        pro_tip: "go",
        risk_review_verdict: "REJECT",
        risk_review_reason: "trap",
      },
    },
  });
  const map = parseMultiSymbolLlmContentToMap(raw, items);
  assertEquals(map.size, 2);
  assertEquals(map.get("BTCUSDT")?.action, "HOLD");
  assertEquals(map.get("SOLUSDT")?.action, "BUY");
  assertEquals(map.get("SOLUSDT")?.groq_verdict, "REJECT");
});
