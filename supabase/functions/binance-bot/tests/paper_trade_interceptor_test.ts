import { assertEquals } from "jsr:@std/assert";
import {
  buildPaperCcxtLimitReceipt,
  isPaperTradingEnvForced,
  shouldPaperInterceptExchangeDispatch,
} from "../paper-trade-interceptor.ts";
import { executeSmartLimitChaser } from "../exchange-client.ts";

Deno.test("isPaperTradingEnvForced reads IS_PAPER_TRADING", () => {
  Deno.env.set("IS_PAPER_TRADING", "true");
  try {
    assertEquals(isPaperTradingEnvForced(), true);
    assertEquals(shouldPaperInterceptExchangeDispatch(), true);
  } finally {
    Deno.env.delete("IS_PAPER_TRADING");
  }
});

Deno.test("isPaperTradingEnvForced reads IS_TEST_MODE", () => {
  Deno.env.set("IS_TEST_MODE", "true");
  try {
    assertEquals(isPaperTradingEnvForced(), true);
  } finally {
    Deno.env.delete("IS_TEST_MODE");
  }
});

Deno.test("isPaperTradingEnvForced reads any truthy ANKHUSH_PAPER_TRADING", () => {
  Deno.env.set("ANKHUSH_PAPER_TRADING", "1");
  try {
    assertEquals(isPaperTradingEnvForced(), true);
  } finally {
    Deno.env.delete("ANKHUSH_PAPER_TRADING");
  }
});

Deno.test("shouldPaperInterceptExchangeDispatch is env-only (no strategy flags)", () => {
  assertEquals(shouldPaperInterceptExchangeDispatch(), false);
});

Deno.test("buildPaperCcxtLimitReceipt matches CCXT closed limit shape", () => {
  const r = buildPaperCcxtLimitReceipt({
    symbol: "SOLUSDT",
    side: "buy",
    amount: 0.08,
    price: 145.5,
  });
  assertEquals(r.status, "closed");
  assertEquals(r.type, "limit");
  assertEquals(r.filled, 0.08);
  assertEquals(r.remaining, 0);
  assertEquals(String(r.id).startsWith("paper-"), true);
  assertEquals(r.info?.message, "Simulated paper trade execution successful");
});

Deno.test("executeSmartLimitChaser intercepts when IS_PAPER_TRADING=true", async () => {
  Deno.env.set("IS_PAPER_TRADING", "true");
  try {
    const result = await executeSmartLimitChaser({
      symbol: "SOLUSDT",
      side: "buy",
      amount: 0.08,
      signalPrice: 145.5,
      marketRegime: "NEUTRAL",
    });
    assertEquals(result.status, "closed");
    assertEquals(result.filled, 0.08);
    assertEquals(result.smart_execution_meta?.instant_paper_intercept, true);
    assertEquals(String(result.id).startsWith("paper-"), true);
  } finally {
    Deno.env.delete("IS_PAPER_TRADING");
  }
});
