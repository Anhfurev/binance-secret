import { assertEquals } from "jsr:@std/assert@1";
import { parseStreamTickResponse } from "../stream-tick-snapshot.ts";

Deno.test("parseStreamTickResponse accepts fresh websocket tick", () => {
  const parsed = parseStreamTickResponse({
    ok: true,
    symbol: "PEPEUSDT",
    last: 0.00001234,
    bid: 0.00001233,
    ask: 0.00001235,
    age_ms: 120,
  }, "PEPEUSDT");
  assertEquals(parsed?.last, 0.00001234);
  assertEquals(parsed?.source, "websocket");
});

Deno.test("parseStreamTickResponse rejects unavailable tick", () => {
  assertEquals(parseStreamTickResponse({ ok: false }, "BTCUSDT"), null);
});
