// @ts-nocheck
/** Per-symbol risk: notional cap, trailing %, soft-exit min hold (signal / RSI / matrix). */

export type AssetRiskBucket = "major" | "meme" | "default";

export type AssetRiskProfile = {
  bucket: AssetRiskBucket;
  maxNotionalUsd: number;
  trailingStopPct: number;
  minSoftExitHoldMs: number;
};

const MAJOR_MARKERS = ["BTC", "ETH"];
const MEME_MARKERS = ["PEPE", "BONK", "WIF", "FLOKI", "MEME", "SHIB", "DOGE"];

const MAJOR_PROFILE: AssetRiskProfile = {
  bucket: "major",
  maxNotionalUsd: 500,
  trailingStopPct: 0.015,
  minSoftExitHoldMs: 15 * 60 * 1000,
};

const MEME_PROFILE: AssetRiskProfile = {
  bucket: "meme",
  maxNotionalUsd: 200,
  trailingStopPct: 0.06,
  minSoftExitHoldMs: 5 * 60 * 1000,
};

const DEFAULT_PROFILE: AssetRiskProfile = {
  bucket: "default",
  maxNotionalUsd: 500,
  trailingStopPct: 0.015,
  minSoftExitHoldMs: 10 * 60 * 1000,
};

export function classifyAssetRiskBucket(symbol: string): AssetRiskBucket {
  const sym = String(symbol ?? "").toUpperCase();
  if (MEME_MARKERS.some((m) => sym.includes(m))) return "meme";
  if (MAJOR_MARKERS.some((m) => sym.includes(m))) return "major";
  return "default";
}

export function resolveAssetRiskProfile(symbol: string): AssetRiskProfile {
  const bucket = classifyAssetRiskBucket(symbol);
  if (bucket === "meme") return MEME_PROFILE;
  if (bucket === "major") return MAJOR_PROFILE;
  return DEFAULT_PROFILE;
}

export function resolveAssetMaxNotionalUsd(symbol: string): number {
  return resolveAssetRiskProfile(symbol).maxNotionalUsd;
}

export function resolveAssetTrailingStopPct(
  symbol: string,
  rowTrailingPct?: unknown,
): number {
  const profile = resolveAssetRiskProfile(symbol);
  const raw = Number(rowTrailingPct);
  if (Number.isFinite(raw) && raw > 0) {
    const normalized = raw > 1 ? raw / 100 : raw;
    return Math.max(profile.trailingStopPct, normalized);
  }
  return profile.trailingStopPct;
}

export function resolveAssetMinSoftExitHoldMs(symbol: string): number {
  return resolveAssetRiskProfile(symbol).minSoftExitHoldMs;
}

export function isHardCapitalExitReason(reason: string | null | undefined): boolean {
  const r = String(reason ?? "").toLowerCase();
  return r === "stoploss_hit" ||
    r === "be_stop_hit" ||
    r === "money_machine_hard_stop" ||
    r === "roi_target_hit";
}
