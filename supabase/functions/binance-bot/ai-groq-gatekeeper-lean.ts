// @ts-nocheck
/** Ultra-lean Tier 3 Groq prompt: top-10 order book + Gemini structuralReasoning. */

import type { IndicatorSnapshot } from "./types.ts";
import { buildOrderBookTop10FromSnapshot } from "./ai-cascade-orderbook.ts";
import {
  assertJsonSerializablePayload,
  sanitizeStructuralReasoningForPayload,
} from "./ai-cascade-text-sanitize.ts";

export const GROQ_GATEKEEPER_LEAN_SYSTEM = [
  "Final execution guard. Return ONLY raw JSON:",
  '{ "action": "BUY" | "HOLD", "confidenceScore": number }',
  "confidenceScore is 0-100.",
  "Use order_book_snapshot (top 10 bids/asks volumes) and structuralReasoning from Gemini.",
  "Evaluate:",
  "1) Is there a massive bid-side imbalance favoring buyers right now?",
  "2) Is the immediate spread narrow enough to prevent costly slippage?",
  'Default action HOLD unless both favor entry.',
].join(" ");

export function buildGroqGatekeeperLeanPayload(params: {
  symbol: string;
  snapshot: IndicatorSnapshot;
  structuralReasoning: string;
}): Record<string, unknown> {
  const book = buildOrderBookTop10FromSnapshot(params.snapshot);
  const payload = {
    symbol: params.symbol,
    latestPrice: params.snapshot.latestPrice,
    structuralReasoning: sanitizeStructuralReasoningForPayload(
      params.structuralReasoning,
    ),
    order_book_snapshot: {
      bids: book.bids,
      asks: book.asks,
      imbalance_ratio: book.imbalance_ratio,
      spread_bps: book.spread_bps,
    },
  };
  assertJsonSerializablePayload(payload);
  return payload;
}
