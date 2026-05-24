import { assertEquals } from "jsr:@std/assert";
import { evaluateStalePositionRotation } from "../stale-position-rotation.ts";
import type { OpenTradeRow } from "../types.ts";

Deno.test("stale flat rotation exits after 24h when pnl within band", () => {
  const prev = Deno.env.get("LIVE_STALE_POSITION_HOURS");
  try {
    Deno.env.set("LIVE_STALE_POSITION_HOURS", "24");
  const openTrade = {
    entryPrice: 100,
    opened_at: new Date(Date.now() - 30 * 60 * 60 * 1000).toISOString(),
    extra: { highest_price_seen: 100.5 },
  } as OpenTradeRow;
  const hit = evaluateStalePositionRotation({ openTrade, price: 100.2 });
  assertEquals(hit.forceExit, true);
  assertEquals(hit.reason, "stale_flat_rotation");
  } finally {
    if (prev === undefined) Deno.env.delete("LIVE_STALE_POSITION_HOURS");
    else Deno.env.set("LIVE_STALE_POSITION_HOURS", prev);
  }
});

Deno.test("stale rotation does not exit young positions", () => {
  const openTrade = {
    entryPrice: 100,
    opened_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    extra: {},
  } as OpenTradeRow;
  const hit = evaluateStalePositionRotation({ openTrade, price: 100.1 });
  assertEquals(hit.forceExit, false);
});
