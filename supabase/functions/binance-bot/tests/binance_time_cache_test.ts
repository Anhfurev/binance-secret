import { assertEquals } from "jsr:@std/assert";
import {
  getBinanceServerTimeMs,
  getCachedTimeOffset,
  isBinanceTimeCacheWarm,
  requiresSignedBinanceRequests,
} from "../binance-time-cache.ts";

Deno.test("requiresSignedBinanceRequests false when paper forced", () => {
  const prevPaper = Deno.env.get("PAPER_TRADING");
  const prevKey = Deno.env.get("BINANCE_API_KEY");
  try {
    Deno.env.set("PAPER_TRADING", "1");
    Deno.env.delete("BINANCE_API_KEY");
    assertEquals(requiresSignedBinanceRequests(), false);
  } finally {
    if (prevPaper === undefined) Deno.env.delete("PAPER_TRADING");
    else Deno.env.set("PAPER_TRADING", prevPaper);
    if (prevKey === undefined) Deno.env.delete("BINANCE_API_KEY");
    else Deno.env.set("BINANCE_API_KEY", prevKey);
  }
});

Deno.test("getBinanceServerTimeMs applies cached offset", () => {
  const before = Date.now();
  const server = getBinanceServerTimeMs();
  const after = Date.now();
  const offset = getCachedTimeOffset();
  assertEquals(server >= before + offset, true);
  assertEquals(server <= after + offset, true);
});

Deno.test("isBinanceTimeCacheWarm false before any sync", () => {
  assertEquals(isBinanceTimeCacheWarm(), false);
});
