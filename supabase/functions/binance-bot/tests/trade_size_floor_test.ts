import { assertEquals } from "jsr:@std/assert";
import {
  applySymbolTradeUsdFloor,
  readSymbolMinTradeUsd,
} from "../trade-size-floor.ts";

Deno.test("btc min trade floor defaults to 50 usd", () => {
  Deno.env.delete("MIN_TRADE_USD_BTC");
  assertEquals(readSymbolMinTradeUsd("BTCUSDT"), 50);
});

Deno.test("applySymbolTradeUsdFloor does not zero when balance unknown", () => {
  const sized = applySymbolTradeUsdFloor({
    symbol: "SOLUSDT",
    tradeUsd: 12,
    currentBalance: 0,
  });
  assertEquals(sized, 12);
});

Deno.test("applySymbolTradeUsdFloor bumps undersized btc buys", () => {
  Deno.env.delete("MIN_TRADE_USD_BTC");
  assertEquals(
    applySymbolTradeUsdFloor({
      symbol: "BTCUSDT",
      tradeUsd: 12,
      currentBalance: 10_000,
    }),
    50,
  );
});
