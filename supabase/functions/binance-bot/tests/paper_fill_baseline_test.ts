import { assertEquals } from "jsr:@std/assert";
import { resolveBookBaseline } from "../paper-fill-baseline.ts";

Deno.test("buy uses ask when present", () => {
  const r = resolveBookBaseline({
    side: "buy",
    signalPrice: 100,
    bid: 99,
    ask: 101,
    last: 100,
  });
  assertEquals(r.source, "ask");
  assertEquals(r.baseline, 101);
});

Deno.test("buy falls back to bid when ask missing", () => {
  const r = resolveBookBaseline({
    side: "buy",
    signalPrice: 100,
    bid: 99,
    last: 100,
  });
  assertEquals(r.source, "bid_fallback_buy");
  assertEquals(r.baseline, 99);
});

Deno.test("sell uses bid when present", () => {
  const r = resolveBookBaseline({
    side: "sell",
    signalPrice: 100,
    bid: 99,
    ask: 101,
    last: 100,
  });
  assertEquals(r.source, "bid");
  assertEquals(r.baseline, 99);
});

Deno.test("sell falls back to ask when bid missing", () => {
  const r = resolveBookBaseline({
    side: "sell",
    signalPrice: 100,
    ask: 101,
    last: 100,
  });
  assertEquals(r.source, "ask_fallback_sell");
  assertEquals(r.baseline, 101);
});
