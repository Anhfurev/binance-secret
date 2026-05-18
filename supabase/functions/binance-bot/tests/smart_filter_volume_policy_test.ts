import { assertEquals } from "jsr:@std/assert@1";
import {
  isHighLiquiditySymbol,
  resolveSmartFilterVolumeGatePolicy,
} from "../smart-filter-volume-policy.ts";

Deno.test("isHighLiquiditySymbol includes SOL and PEPE", () => {
  assertEquals(isHighLiquiditySymbol("SOLUSDT"), true);
  assertEquals(isHighLiquiditySymbol("PEPEUSDT"), true);
  assertEquals(isHighLiquiditySymbol("DOGEUSDT"), false);
});

Deno.test("high-liq with DB 24h gate off uses 24h primary and skips 1m gates", () => {
  const p = resolveSmartFilterVolumeGatePolicy({
    symbol: "SOLUSDT",
    baseMinVolume1mQuoteUsd: 15_000,
    minVolume24hQuoteFromDb: 0,
    snapshot: { volume24hQuote: 50_000_000 },
  });
  assertEquals(p.mode, "high_liq_24h_primary");
  assertEquals(p.skip1mUsdGate, true);
  assertEquals(p.skip1mVs24hAvgGate, true);
  assertEquals(p.minVolume1mQuoteUsd, 100);
});

Deno.test("high-liq with failing DB 24h uses relaxed 1m floor only", () => {
  const p = resolveSmartFilterVolumeGatePolicy({
    symbol: "PEPEUSDT",
    baseMinVolume1mQuoteUsd: 50_000,
    minVolume24hQuoteFromDb: 5_000_000,
    snapshot: { volume24hQuote: 1_000_000 },
  });
  assertEquals(p.mode, "high_liq_relaxed_1m");
  assertEquals(p.skip1mUsdGate, false);
  assertEquals(p.minVolume1mQuoteUsd, 100);
});
