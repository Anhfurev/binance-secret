// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import { buildGroqGatekeeperLeanPayload } from "../ai-groq-gatekeeper-lean.ts";
import type { IndicatorSnapshot } from "../types.ts";

Deno.test("buildGroqGatekeeperLeanPayload includes top10 book and structuralReasoning", () => {
  const snap = {
    symbol: "BTCUSDT",
    latestPrice: 100,
    imbalance_ratio: 1.8,
    spreadBps: 4.2,
    order_book_top10: {
      bids: [{ price: 99.9, volume: 5 }, { price: 99.8, volume: 3 }],
      asks: [{ price: 100.1, volume: 2 }],
    },
  } as IndicatorSnapshot;
  const payload = buildGroqGatekeeperLeanPayload({
    symbol: "BTCUSDT",
    snapshot: snap,
    structuralReasoning: "Healthy pullback with absorption wicks.",
  });
  assertEquals(payload.structuralReasoning, "Healthy pullback with absorption wicks.");
  const book = payload.order_book_snapshot as { bids: unknown[]; spread_bps: number };
  assertEquals(book.bids.length, 2);
  assertEquals(book.spread_bps, 4.2);
});
