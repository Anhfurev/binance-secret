import { assertEquals } from "jsr:@std/assert";
import { evaluateLiveMtfStatus } from "../buy-mtf.ts";

Deno.test("live MTF rejects short 1h series", () => {
  const status = evaluateLiveMtfStatus({
    bars1h: 120,
    ema200: 100,
    last1h: 99,
  });
  assertEquals(status.mtfDataRejected, true);
  assertEquals(status.bearish1hCap, false);
});

Deno.test("live MTF marks bearish when 1h close is below EMA200", () => {
  const status = evaluateLiveMtfStatus({
    bars1h: 220,
    ema200: 100,
    last1h: 99.5,
  });
  assertEquals(status.mtfDataRejected, false);
  assertEquals(status.bearish1hCap, true);
});
