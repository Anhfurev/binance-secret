// @ts-nocheck
import { clamp } from "./utils.ts";
import { isOversoldBounceStrategyReason } from "./strategy-oversold-bounce.ts";

const BOUNCE_MATRIX_PREFIX = "oversold_bounce_confirmed_buy";
const BOUNCE_STRATEGY_TOKEN = "strategy_oversold_bounce_entry";

function traceIncludesOversoldBounce(trace?: string | null): boolean {
  if (!trace || typeof trace !== "string") return false;
  return trace.includes(BOUNCE_STRATEGY_TOKEN) || trace.includes(BOUNCE_MATRIX_PREFIX);
}

export type OversoldBounceQualifyContext = {
  matrixBuyReason?: string | null;
  /** Raw strategy gate, e.g. `strategy_oversold_bounce_entry`. */
  strategyReason?: string | null;
  /** Full combined trace (`strategy|matrix|telemetry`). */
  combinedTrace?: string | null;
};

/** True when setup originated from oversold bounce (relaxed SOL 55% / PEPE 35% floors). */
export function qualifiesOversoldBounceRelaxedPath(ctx: OversoldBounceQualifyContext): boolean {
  if (isOversoldBounceStrategyReason(ctx.strategyReason)) return true;
  if (traceIncludesOversoldBounce(ctx.combinedTrace)) return true;
  if (traceIncludesOversoldBounce(ctx.matrixBuyReason)) return true;
  return false;
}

/** @deprecated Prefer `qualifiesOversoldBounceRelaxedPath` — kept for call-site compatibility. */
export function isOversoldBounceMatrixBuyReason(
  matrixBuyReason?: string | null,
  ctx?: Omit<OversoldBounceQualifyContext, "matrixBuyReason">,
): boolean {
  return qualifiesOversoldBounceRelaxedPath({
    matrixBuyReason,
    strategyReason: ctx?.strategyReason,
    combinedTrace: ctx?.combinedTrace,
  });
}

/** PEPE / meme bounce sizing floor (default 35%). */
export function readOversoldBounceSymbolExecutionCap(symbol: string): number {
  const sym = String(symbol ?? "").toUpperCase();
  if (sym.includes("PEPE") || sym.includes("BONK") || sym.includes("WIF") || sym.includes("FLOKI")) {
    const n = Number(Deno.env.get("OVERSOLD_BOUNCE_FLOOR_PEPE") ?? "35");
    return Number.isFinite(n) ? clamp(Math.floor(n), 30, 55) : 35;
  }
  if (sym.includes("SOL") && !sym.includes("PEPE")) {
    const n = Number(Deno.env.get("OVERSOLD_BOUNCE_FLOOR_SOL") ?? "55");
    return Number.isFinite(n) ? clamp(Math.floor(n), 40, 65) : 55;
  }
  const n = Number(Deno.env.get("OVERSOLD_BOUNCE_FLOOR_DEFAULT") ?? "55");
  return Number.isFinite(n) ? clamp(Math.floor(n), 40, 65) : 55;
}

/** War Room / quorum floor when matrix stamped `bounce_override_ai_soft_sell` on memes. */
export function readOversoldBouncePepeSoftSellFloor(): number {
  const raw = Number(Deno.env.get("OVERSOLD_BOUNCE_SOFT_SELL_FLOOR_PEPE") ?? "35");
  return Number.isFinite(raw) ? clamp(Math.floor(raw), 30, 45) : 35;
}

export function isBounceOverrideAiSoftSell(matrixBuyReason?: string | null): boolean {
  return String(matrixBuyReason ?? "").includes("bounce_override_ai_soft_sell");
}

/**
 * Relaxed execution floor for matrix oversold bounce paths — min(policy caps, live conviction).
 */
export function resolveOversoldBounceMinAiConfidenceBuy(params: {
  executionWeightedFloor: number;
  assetClassMinAi: number;
  symbol: string;
  effectiveConfidence: number;
}): number {
  const bounceCap = readOversoldBounceSymbolExecutionCap(params.symbol);
  const policyRelaxed = Math.min(
    params.executionWeightedFloor,
    params.assetClassMinAi,
    bounceCap,
  );
  const convictionAligned = Math.max(
    bounceCap,
    Math.floor(params.effectiveConfidence),
  );
  return Math.min(policyRelaxed, convictionAligned);
}
