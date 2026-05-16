import { assertEquals } from "jsr:@std/assert";
import { resolveTapeMacdTraceLines } from "../telegram-super-detailed-trace.ts";

Deno.test("resolveTapeMacdTraceLines flat bot indicators compute hist from macd - signal", () => {
  const px = 0.00000374;
  const lines = resolveTapeMacdTraceLines({
    rsi: 50,
    macd: 0.00000012,
    macdSignal: 0.00000005,
    emaFast: px,
    emaSlow: px * 0.99,
    ema200: px * 0.98,
  }, px);
  assertEquals(lines.hist, (0.00000012 - 0.00000005).toFixed(8));
  assertEquals(lines.macd, (0.00000012).toFixed(8));
});

Deno.test("resolveTapeMacdTraceLines prefers explicit macdHistogram", () => {
  const px = 0.00001;
  const lines = resolveTapeMacdTraceLines({
    rsi: 50,
    macd: 1e-7,
    macdSignal: 2e-7,
    macdHistogram: -1e-8,
    emaFast: px,
    emaSlow: px,
  }, px);
  assertEquals(lines.hist, (-1e-8).toFixed(8));
});

Deno.test("resolveTapeMacdTraceLines nested snapshot macd object", () => {
  const px = 0.00000374;
  const lines = resolveTapeMacdTraceLines({
    rsi: 50,
    macd: { macd: 1.2e-8, signal: 0.4e-8, histogram: 0.8e-8 } as unknown as number,
    macdSignal: 0,
    emaFast: px,
    emaSlow: px,
  }, px);
  assertEquals(lines.hist, (0.8e-8).toFixed(8));
});
