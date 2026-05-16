import { assertEquals } from "jsr:@std/assert";
import { readPublicMarketDataTimeoutMs } from "../market-data-timeout.ts";

Deno.test("readPublicMarketDataTimeoutMs caps aborted cycles tighter", () => {
  Deno.env.delete("PUBLIC_MARKET_DATA_TIMEOUT_MS");
  assertEquals(readPublicMarketDataTimeoutMs(), 10_000);
  assertEquals(readPublicMarketDataTimeoutMs(new AbortController().signal), 8_000);
});
