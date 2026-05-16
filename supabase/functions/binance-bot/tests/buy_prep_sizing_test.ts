import { assertEquals } from "jsr:@std/assert";
import {
  capRiskToStopNotionalUsd,
  resolveBuySizingEquityUsd,
} from "../buy-prep.ts";

Deno.test("live sizing equity ignores profile demo balance", () => {
  assertEquals(
    resolveBuySizingEquityUsd({
      exchangeSkipped: false,
      profileDemoBalance: 25_000,
      walletUsdt: 1_200,
    }),
    1_200,
  );
});

Deno.test("paper sizing equity prefers profile demo balance", () => {
  assertEquals(
    resolveBuySizingEquityUsd({
      exchangeSkipped: true,
      profileDemoBalance: 9_500,
      walletUsdt: 10_000,
    }),
    9_500,
  );
});

Deno.test("risk-to-stop notional respects confidence cap and wallet", () => {
  assertEquals(
    capRiskToStopNotionalUsd({
      riskNotionalUsd: 1_500,
      confidenceCapUsd: 900,
      walletUsdt: 1_000,
      totalEquityUsd: 2_000,
    }),
    900,
  );
});

Deno.test("risk-to-stop notional clamps to wallet and total equity", () => {
  assertEquals(
    capRiskToStopNotionalUsd({
      riskNotionalUsd: 1_500,
      confidenceCapUsd: 1_200,
      walletUsdt: 800,
      totalEquityUsd: 2_000,
    }),
    800,
  );
});
