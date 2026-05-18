import { assertEquals } from "jsr:@std/assert";
import { isTransientExchangeError } from "../exchange-order-retry.ts";

Deno.test("isTransientExchangeError detects network and timeout failures", () => {
  assertEquals(isTransientExchangeError(new Error("fetch failed: network timeout")), true);
  assertEquals(isTransientExchangeError(new Error("HTTP 503 Service Unavailable")), true);
  assertEquals(isTransientExchangeError(new Error("invalid api-key")), false);
});
