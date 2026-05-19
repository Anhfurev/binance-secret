import type { DemoTrade } from "@/lib/types";

export type PaperLegSide = "LONG" | "SHORT";

export function resolvePaperLegSide(trade: DemoTrade): PaperLegSide {
  if (trade.direction === "SHORT" || trade.direction === "LONG") {
    return trade.direction;
  }
  return trade.type === "sell" ? "SHORT" : "LONG";
}

export function isPaperShortLeg(trade: DemoTrade): boolean {
  return resolvePaperLegSide(trade) === "SHORT";
}
