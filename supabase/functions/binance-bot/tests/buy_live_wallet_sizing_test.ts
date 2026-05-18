import { assertEquals } from "jsr:@std/assert";
import { MIN_TRADE_USD } from "../constants.ts";
import {
  applyOversoldBounceRigidTradeUsdFloor,
  clipTradeUsdForMicroWallet,
  computeBuyBaseQtyFromNotional,
  enforceMinimumExecutableTradeUsd,
  normalizeLiveWalletSizingResult,
  OVERSOLD_BOUNCE_RIGID_FLOOR_USD,
  readOversoldBounceRigidFloorUsd,
  capBounceTradeUsdToExchangeFree,
  evaluateBounceDispatchBalanceGate,
  isLegacyDbLiveBalanceSkip,
  resolveLiveBalancePreflightSkip,
  resolveOversoldBounceExecutionBalanceSkip,
  resolveMicroClipTargetUsd,
  resolveSymbolLotStepSize,
  safeDivideNotionalByPrice,
  salvageTradeUsdBeforeExecution,
} from "../buy-live-wallet-sizing.ts";
import { applySymbolTradeUsdFloor } from "../trade-size-floor.ts";

Deno.test("clipTradeUsdForMicroWallet leaves large trades unchanged above threshold", () => {
  assertEquals(clipTradeUsdForMicroWallet(200, 80), 200);
});

Deno.test("clipTradeUsdForMicroWallet clamps micro wallet to clip band", () => {
  assertEquals(clipTradeUsdForMicroWallet(250, 27), resolveMicroClipTargetUsd(27));
  assertEquals(clipTradeUsdForMicroWallet(8, 27), resolveMicroClipTargetUsd(27));
});

Deno.test("applyOversoldBounceRigidTradeUsdFloor forces 12 when compressed", () => {
  assertEquals(readOversoldBounceRigidFloorUsd(), OVERSOLD_BOUNCE_RIGID_FLOOR_USD);
  assertEquals(applyOversoldBounceRigidTradeUsdFloor(0, 30), 12);
  assertEquals(applyOversoldBounceRigidTradeUsdFloor(8.5, 30), 12);
  assertEquals(applyOversoldBounceRigidTradeUsdFloor(15, 30), 15);
  assertEquals(applyOversoldBounceRigidTradeUsdFloor(20, 15), 15);
});

Deno.test("enforceMinimumExecutableTradeUsd bounce always applies rigid floor", () => {
  assertEquals(
    enforceMinimumExecutableTradeUsd({ tradeUsd: 3, liveFreeUsdt: 50, oversoldBounce: true }),
    12,
  );
  assertEquals(
    enforceMinimumExecutableTradeUsd({ tradeUsd: 0, liveFreeUsdt: 27, oversoldBounce: true }),
    12,
  );
});

Deno.test("enforceMinimumExecutableTradeUsd replaces zero with micro clip (non-bounce)", () => {
  const clip = resolveMicroClipTargetUsd(27);
  assertEquals(
    enforceMinimumExecutableTradeUsd({ tradeUsd: 0, liveFreeUsdt: 27 }),
    clip,
  );
});

Deno.test("resolveMicroClipTargetUsd respects affordable wallet", () => {
  assertEquals(resolveMicroClipTargetUsd(27), 15);
  assertEquals(resolveMicroClipTargetUsd(13), 11);
});

Deno.test("safeDivideNotionalByPrice handles PEPE micro price without underflow", () => {
  const pepePrice = 0.00001234;
  const qty = safeDivideNotionalByPrice(12, pepePrice);
  assertEquals(qty > 0, true);
  assertEquals(Number.isFinite(qty), true);
  assertEquals(String(qty).includes("e"), false);
});

Deno.test("computeBuyBaseQtyFromNotional PEPE uses integer lot step", () => {
  const pepePrice = 0.00001234;
  const qty = computeBuyBaseQtyFromNotional(12, pepePrice, 0, "PEPEUSDT");
  assertEquals(qty > 0, true);
  assertEquals(qty % 1, 0);
  assertEquals(qty * pepePrice <= 12 + 0.0001, true);
});

Deno.test("computeBuyBaseQtyFromNotional SOL uses fractional 0.01 step not integer clip", () => {
  const solPrice = 145.67;
  const qty = computeBuyBaseQtyFromNotional(12, solPrice, 0, "SOLUSDT");
  assertEquals(qty > 0, true);
  assertEquals(resolveSymbolLotStepSize("SOLUSDT"), 0.01);
  const remainder = Math.round((qty / 0.01) % 1 * 1e6) / 1e6;
  assertEquals(remainder, 0);
  assertEquals(qty * solPrice <= 12 + 0.02, true);
});

Deno.test("computeBuyBaseQtyFromNotional defaults to one lot step when floor is zero", () => {
  const qty = computeBuyBaseQtyFromNotional(12, 150, 0.01, "SOLUSDT");
  assertEquals(qty > 0, true);
  assertEquals(qty * 150 <= 12 + 1e-6, true);
});

Deno.test("resolveLiveBalancePreflightSkip blocks when required exceeds available", () => {
  assertEquals(resolveLiveBalancePreflightSkip(15, 12.5)?.includes("Insufficient actual live"), true);
  assertEquals(resolveLiveBalancePreflightSkip(12, 20), null);
});

Deno.test("resolveLiveBalancePreflightSkip bounce defers to dispatch (never blocks at sizing)", () => {
  assertEquals(resolveLiveBalancePreflightSkip(12, 0, { oversoldBounce: true }), null);
  assertEquals(resolveLiveBalancePreflightSkip(12, 8, { oversoldBounce: true }), null);
});

Deno.test("evaluateBounceDispatchBalanceGate success when CCXT free >= 12", () => {
  const gate = evaluateBounceDispatchBalanceGate(27, 12);
  assertEquals(gate.success, true);
  assertEquals(gate.exchangeFreeUsdt, 27);
});

Deno.test("evaluateBounceDispatchBalanceGate passes margin-derived free at rigid floor", () => {
  const gate = evaluateBounceDispatchBalanceGate(12, 12);
  assertEquals(gate.success, true);
});

Deno.test("evaluateBounceDispatchBalanceGate blocks when CCXT free below floor", () => {
  const gate = evaluateBounceDispatchBalanceGate(8, 12);
  assertEquals(gate.success, false);
  assertEquals(gate.skipDetail?.includes("CCXT free"), true);
});

Deno.test("isLegacyDbLiveBalanceSkip detects pre-dispatch DB blocks", () => {
  assertEquals(
    isLegacyDbLiveBalanceSkip("BUY blocked: Insufficient actual live balance. Required: $12.00, Available: $0.00"),
    true,
  );
  assertEquals(isLegacyDbLiveBalanceSkip("BUY blocked: footprint"), false);
});

Deno.test("capBounceTradeUsdToExchangeFree never exceeds exchange free", () => {
  assertEquals(capBounceTradeUsdToExchangeFree(12, 27), 12);
  assertEquals(capBounceTradeUsdToExchangeFree(15, 10), 10);
});

Deno.test("applyLiveWalletSizingConstraints disabled still rigid-floors bounce", async () => {
  const { applyLiveWalletSizingConstraints } = await import("../buy-live-wallet-sizing.ts");
  const out = await applyLiveWalletSizingConstraints({
    enabled: false,
    symbol: "PEPEUSDT",
    tradeUsd: 4,
    currentBalance: 40,
    oversoldBounce: true,
  });
  assertEquals(out.tradeUsd, 12);
});

Deno.test("applyLiveWalletSizingConstraints disabled passes normal tradeUsd through", async () => {
  const { applyLiveWalletSizingConstraints } = await import("../buy-live-wallet-sizing.ts");
  const out = await applyLiveWalletSizingConstraints({
    enabled: false,
    symbol: "SOLUSDT",
    tradeUsd: 180,
    currentBalance: 9000,
  });
  assertEquals(out.tradeUsd, 180);
});

Deno.test("sub-min notional never stays at zero when wallet can fund MIN_TRADE_USD", () => {
  const sized = enforceMinimumExecutableTradeUsd({ tradeUsd: 0.001, liveFreeUsdt: 40 });
  assertEquals(sized >= MIN_TRADE_USD, true);
});

Deno.test("normalizeLiveWalletSizingResult maps legacy trade_usd and live_free_usdt keys", () => {
  const normalized = normalizeLiveWalletSizingResult({
    trade_usd: 12,
    live_free_usdt: 28.5,
  });
  assertEquals(normalized.tradeUsd, 12);
  assertEquals(normalized.liveFreeUsdt, 28.5);
});

Deno.test("applySymbolTradeUsdFloor preserves notional when DB balance is zero", () => {
  assertEquals(
    applySymbolTradeUsdFloor({ symbol: "SOLUSDT", tradeUsd: 12, currentBalance: 0 }),
    12,
  );
  assertEquals(
    applySymbolTradeUsdFloor({ symbol: "PEPEUSDT", tradeUsd: 12, currentBalance: 0 }),
    25,
  );
});

Deno.test("salvageTradeUsdBeforeExecution recovers zero after stale balance cap", () => {
  assertEquals(
    salvageTradeUsdBeforeExecution({
      tradeUsd: 0,
      availableBalance: 30,
      oversoldBounce: true,
      symbol: "SOLUSDT",
    }),
    12,
  );
});

Deno.test("resolveOversoldBounceExecutionBalanceSkip clears when CCXT free >= 12", () => {
  assertEquals(resolveOversoldBounceExecutionBalanceSkip(14, 12), null);
  assertEquals(resolveOversoldBounceExecutionBalanceSkip(12, 12), null);
  assertEquals(
    resolveOversoldBounceExecutionBalanceSkip(8, 12)?.includes("CCXT free"),
    true,
  );
});

Deno.test("enforceMinimumExecutableTradeUsd bounce works when wallet unknown (zero)", () => {
  assertEquals(
    enforceMinimumExecutableTradeUsd({
      tradeUsd: 0,
      liveFreeUsdt: 0,
      oversoldBounce: true,
    }),
    12,
  );
});
