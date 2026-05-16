import { assertEquals } from "jsr:@std/assert";
import { computeExpectedPaperDemoBalance } from "../paper-wallet-reconcile.ts";

Deno.test("expected paper cash = starting + realized − open notionals", () => {
  const expected = computeExpectedPaperDemoBalance(10_000, [
    {
      status: "closed",
      pnl: -2,
      value: 500,
      extra: { trade_mode: "paper", is_ghost: false },
    },
    {
      status: "open",
      pnl: 0,
      value: 400,
      extra: { trade_mode: "paper", is_ghost: false },
    },
    {
      status: "stopped",
      pnl: -1,
      value: 300,
      extra: { is_paper: true, is_ghost: false },
    },
  ]);
  assertEquals(expected, 9597);
});

Deno.test("ghost legs are ignored for paper reconcile", () => {
  const expected = computeExpectedPaperDemoBalance(10_000, [
    {
      status: "closed",
      pnl: 50,
      value: 100,
      extra: { trade_mode: "ghost", is_ghost: true },
    },
  ]);
  assertEquals(expected, 10_000);
});

Deno.test("open partial realized pnl counts toward expected paper cash", () => {
  const expected = computeExpectedPaperDemoBalance(10_000, [
    {
      status: "open",
      pnl: 0,
      value: 500,
      extra: {
        trade_mode: "paper",
        is_ghost: false,
        realized_pnl_usd: 12.5,
      },
    },
  ]);
  assertEquals(expected, 9512.5);
});
