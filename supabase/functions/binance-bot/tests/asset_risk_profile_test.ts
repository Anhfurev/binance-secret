import { assertEquals } from "jsr:@std/assert";
import {
  classifyAssetRiskBucket,
  isHardCapitalExitReason,
  resolveAssetMaxNotionalUsd,
  resolveAssetRiskProfile,
  resolveAssetTrailingStopPct,
} from "../asset-risk-profile.ts";
import { canFireSoftSignalExit } from "../strategy-stop-hold.ts";

Deno.test("BTC major profile: 500 cap, 1.5% trail, 15m soft hold", () => {
  const p = resolveAssetRiskProfile("BTCUSDT");
  assertEquals(p.bucket, "major");
  assertEquals(p.maxNotionalUsd, 500);
  assertEquals(p.trailingStopPct, 0.015);
  assertEquals(p.minSoftExitHoldMs, 15 * 60 * 1000);
});

Deno.test("PEPE meme profile: 200 cap, 6% trail, 5m soft hold", () => {
  const p = resolveAssetRiskProfile("PEPEUSDT");
  assertEquals(classifyAssetRiskBucket("PEPEUSDT"), "meme");
  assertEquals(resolveAssetMaxNotionalUsd("PEPEUSDT"), 200);
  assertEquals(resolveAssetTrailingStopPct("PEPEUSDT", null), 0.06);
  assertEquals(p.minSoftExitHoldMs, 5 * 60 * 1000);
});

Deno.test("canFireSoftSignalExit blocks PEPE exit before 5 minutes", () => {
  const now = Date.now();
  const openTrade = { opened_at: new Date(now - 60_000).toISOString() };
  assertEquals(canFireSoftSignalExit(openTrade as any, "PEPEUSDT", now), false);
  assertEquals(
    canFireSoftSignalExit(
      { opened_at: new Date(now - 6 * 60_000).toISOString() } as any,
      "PEPEUSDT",
      now,
    ),
    true,
  );
});

Deno.test("isHardCapitalExitReason identifies stop/TP only", () => {
  assertEquals(isHardCapitalExitReason("stoploss_hit"), true);
  assertEquals(isHardCapitalExitReason("signal_exit"), false);
  assertEquals(isHardCapitalExitReason("rsi_overbought"), false);
});
