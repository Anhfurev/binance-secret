import { assertEquals } from "jsr:@std/assert";
import { resolveCompoundTradeSizeUsd, readCompoundPositionPct } from "../compound-position-sizing.ts";
import { resolveTradeSizeUsd } from "../trade-store.ts";

Deno.test("resolveCompoundTradeSizeUsd uses 40% of wallet by default", () => {
  const prev = Deno.env.get("COMPOUND_POSITION_PCT");
  try {
    Deno.env.delete("COMPOUND_POSITION_PCT");
    assertEquals(readCompoundPositionPct(), 40);
    assertEquals(Number(resolveCompoundTradeSizeUsd(28)?.toFixed(2)), 11.2);
    assertEquals(Number(resolveTradeSizeUsd({ trade_size_usd: 11, risk_percent: 5 } as any, 28).toFixed(2)), 11.2);
  } finally {
    if (prev === undefined) Deno.env.delete("COMPOUND_POSITION_PCT");
    else Deno.env.set("COMPOUND_POSITION_PCT", prev);
  }
});

Deno.test("resolveTradeSizeUsd ignores fixed trade_size when compounding disabled", () => {
  const prev = Deno.env.get("COMPOUND_POSITION_PCT");
  try {
    Deno.env.set("COMPOUND_POSITION_PCT", "0");
    assertEquals(resolveTradeSizeUsd({ trade_size_usd: 11, risk_percent: 5 } as any, 28), 11);
  } finally {
    if (prev === undefined) Deno.env.delete("COMPOUND_POSITION_PCT");
    else Deno.env.set("COMPOUND_POSITION_PCT", prev);
  }
});
