import { assertEquals } from "jsr:@std/assert";
import {
  baseAssetFromUsdtSymbol,
  computeEmaLastFromCloses,
  parseUsdtFreeFromCcxtBalance,
  readMinNotionalUsdt,
  readUsdtMarginFallbackBaselineUsd,
  sliceUsdtFromCcxtBalance,
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

Deno.test("parseUsdtFreeFromCcxtBalance reads nested free USDT", () => {
  assertEquals(
    parseUsdtFreeFromCcxtBalance({ USDT: { free: 27.42, used: 0, total: 27.42 } }),
    27.42,
  );
  assertEquals(parseUsdtFreeFromCcxtBalance({ free: { USDT: 15.5 } }), 15.5);
});

Deno.test("sliceUsdtFromCcxtBalance reads used_margin on USDT block", () => {
  const slice = sliceUsdtFromCcxtBalance({
    USDT: { free: 0, used: 40, total: 1200, used_margin: 1188 },
  });
  assertEquals(slice.free, 0);
  assertEquals(slice.total, 1200);
  assertEquals(slice.usedMargin, 1188);
});

Deno.test("parseUsdtFreeFromCcxtBalance margin fallback when free is 0 but total funded", () => {
  assertEquals(
    parseUsdtFreeFromCcxtBalance({ USDT: { free: 0, used: 0, total: 27.5 } }),
    27.5,
  );
  assertEquals(
    parseUsdtFreeFromCcxtBalance({
      USDT: { free: 0, used: 1188, total: 1200, used_margin: 1188 },
    }),
    12,
  );
  assertEquals(
    parseUsdtFreeFromCcxtBalance({ USDT: { free: 0, used: 500, total: 1500 } }),
    1000,
  );
  assertEquals(
    parseUsdtFreeFromCcxtBalance({ USDT: { free: 0, used: 0, total: 8 } }),
    0,
  );
});

Deno.test("parseUsdtFreeFromCcxtBalance baseline clears bounce preflight floor", () => {
  const baseline = readUsdtMarginFallbackBaselineUsd();
  const parsed = parseUsdtFreeFromCcxtBalance({
    USDT: { free: 0, used: 9999, total: 5000, used_margin: 5000 },
  });
  assertEquals(parsed >= baseline, true);
});

Deno.test("computeEmaLastFromCloses returns null on short series", () => {
  assertEquals(computeEmaLastFromCloses([1, 2, 3], 5), null);
});

Deno.test("computeEmaLastFromCloses seeds with SMA then recurses", () => {
  const closes = [1, 2, 3, 4, 5, 6];
  const ema = computeEmaLastFromCloses(closes, 3);
  assertEquals(ema != null && ema > 4.5 && ema < 6, true);
});
