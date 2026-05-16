import { assertEquals } from "jsr:@std/assert";
import { resolveTradeSizeUsd } from "../trade-store.ts";

Deno.test("resolveTradeSizeUsd prefers fixed trade size", () => {
  const sized = resolveTradeSizeUsd(
    { trade_size_usd: 250, risk_percent: 5 } as any,
    1_000,
  );
  assertEquals(sized, 250);
});

Deno.test("resolveTradeSizeUsd falls back to risk percent", () => {
  const sized = resolveTradeSizeUsd(
    { risk_percent: 10 } as any,
    1_000,
  );
  assertEquals(sized, 100);
});
