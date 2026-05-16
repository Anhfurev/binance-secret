import { assertEquals } from "jsr:@std/assert";
import {
  baseAssetFromUsdtSymbol,
  computeEmaLastFromCloses,
  readMinNotionalUsdt,
  toCcxtSymbol,
} from "../exchange-client.ts";

Deno.test("toCcxtSymbol normalizes USDT spot pairs", () => {
  assertEquals(toCcxtSymbol("BTCUSDT"), "BTC/USDT");
  assertEquals(toCcxtSymbol("BTC/USDT"), "BTC/USDT");
});

Deno.test("baseAssetFromUsdtSymbol extracts base asset", () => {
  assertEquals(baseAssetFromUsdtSymbol("pepeusdt"), "PEPE");
  assertEquals(baseAssetFromUsdtSymbol("ETH/USDT"), "ETH");
});

Deno.test("readMinNotionalUsdt prefers Binance MIN_NOTIONAL filter", () => {
  const market = {
    info: {
      filters: [{ filterType: "MIN_NOTIONAL", minNotional: "12.5" }],
    },
    limits: { cost: { min: 5 } },
  };
  assertEquals(readMinNotionalUsdt(market), 12.5);
});

Deno.test("computeEmaLastFromCloses returns null on short series", () => {
  assertEquals(computeEmaLastFromCloses([1, 2, 3], 5), null);
});

Deno.test("computeEmaLastFromCloses seeds with SMA then recurses", () => {
  const closes = [1, 2, 3, 4, 5, 6];
  const ema = computeEmaLastFromCloses(closes, 3);
  assertEquals(ema != null && ema > 4.5 && ema < 6, true);
});
