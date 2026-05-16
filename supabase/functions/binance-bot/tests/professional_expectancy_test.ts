import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isNearMissConviction,
  readProfessionalExpectancyEnabled,
  resolveGrinderMinWeightedEntry,
  resolveNearMissTag,
  spreadBoostFromFrictionTaxPct,
  tradeNetUsdFromRow,
} from "../professional-expectancy.ts";

Deno.test("professional expectancy enabled by default", () => {
  Deno.env.delete("PROFESSIONAL_EXPECTANCY_MODE");
  assertEquals(readProfessionalExpectancyEnabled(), true);
});

Deno.test("resolveGrinderMinWeightedEntry caps sideways floor at 68", () => {
  Deno.env.set("PROFESSIONAL_EXPECTANCY_MODE", "1");
  Deno.env.set("GRINDER_MIN_WEIGHTED_CONFIDENCE", "72");
  assertEquals(resolveGrinderMinWeightedEntry("RANGING"), 68);
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
});

Deno.test("resolveGrinderMinWeightedEntry respects lower configured floor", () => {
  Deno.env.set("PROFESSIONAL_EXPECTANCY_MODE", "1");
  Deno.env.set("GRINDER_MIN_WEIGHTED_CONFIDENCE", "60");
  assertEquals(resolveGrinderMinWeightedEntry("NEUTRAL"), 60);
  Deno.env.delete("GRINDER_MIN_WEIGHTED_CONFIDENCE");
});

Deno.test("near miss conviction band", () => {
  assertEquals(isNearMissConviction(64.9), false);
  assertEquals(isNearMissConviction(66), true);
  assertEquals(isNearMissConviction(71.9), true);
  assertEquals(isNearMissConviction(72), false);
});

Deno.test("resolveNearMissTag labels sub-floor holds", () => {
  const tag = resolveNearMissTag({ aiConfidence: 69, grinderFloor: 72 });
  assertEquals(tag, "near_miss_conviction_69.0_below_72");
});

Deno.test("spreadBoostFromFrictionTaxPct steps above 30% friction", () => {
  assertEquals(spreadBoostFromFrictionTaxPct(25), 0);
  assertEquals(spreadBoostFromFrictionTaxPct(35), 2);
  assertEquals(spreadBoostFromFrictionTaxPct(55), 6);
});

Deno.test("tradeNetUsdFromRow subtracts fees", () => {
  assertEquals(
    tradeNetUsdFromRow({ pnl: 10, extra: { fee_usd_buy: 1, fee_usd_sell: 0.5 } }),
    8.5,
  );
});
