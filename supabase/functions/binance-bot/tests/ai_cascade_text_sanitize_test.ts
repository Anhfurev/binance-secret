// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  assertJsonSerializablePayload,
  sanitizeStructuralReasoningForPayload,
} from "../ai-cascade-text-sanitize.ts";
import { buildGroqGatekeeperLeanPayload } from "../ai-groq-gatekeeper-lean.ts";
import type { IndicatorSnapshot } from "../types.ts";

Deno.test("sanitizeStructuralReasoning strips control chars and survives JSON round-trip", () => {
  const messy = 'Pullback at S1.\nBid wall "strong" below\u0000 pivot.\r\nWicks absorb.';
  const clean = sanitizeStructuralReasoningForPayload(messy);
  assertEquals(clean.includes("\u0000"), false);
  const roundTrip = JSON.parse(JSON.stringify({ structuralReasoning: clean }));
  assertEquals(roundTrip.structuralReasoning.includes("strong"), true);
  assertEquals(roundTrip.structuralReasoning.includes("\n"), true);
});

Deno.test("buildGroqGatekeeperLeanPayload serializes quotes and newlines for Groq", () => {
  const snap = {
    symbol: "ETHUSDT",
    latestPrice: 3000,
    imbalance_ratio: 1.5,
    spreadBps: 3,
    order_book_top10: {
      bids: [{ price: 2999, volume: 10 }],
      asks: [{ price: 3001, volume: 8 }],
    },
  } as IndicatorSnapshot;
  const payload = buildGroqGatekeeperLeanPayload({
    symbol: "ETHUSDT",
    snapshot: snap,
    structuralReasoning: 'Line1\nLine2 "quoted" \\ backslash',
  });
  assertJsonSerializablePayload(payload);
  const userJson = JSON.stringify(payload);
  const parsed = JSON.parse(userJson);
  assertEquals(parsed.structuralReasoning.includes('"quoted"'), true);
  assertEquals(parsed.structuralReasoning.includes("\n"), true);
});
