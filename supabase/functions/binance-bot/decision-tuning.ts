// @ts-nocheck
import { clamp, toNumber } from "./utils.ts";

const HIGH_CAP_SYMBOLS = [/^BTC/i, /^ETH/i, /^SOL/i, /^BNB/i];
const MEME_SYMBOLS = [/PEPE/i, /BONK/i, /WIF/i, /FLOKI/i, /MEME/i];

const HIGH_CAP_VOLUME_SPIKE_MULTIPLIER = 1.5;
const MEME_VOLUME_SPIKE_MULTIPLIER = 2.3;
const DEFAULT_VOLUME_SPIKE_MULTIPLIER = 1.8;

type SessionLiquidityBand = "high" | "neutral" | "low";

function classifySymbolBucket(symbol: string): "high_cap" | "meme" | "default" {
  if (HIGH_CAP_SYMBOLS.some((re) => re.test(symbol))) return "high_cap";
  if (MEME_SYMBOLS.some((re) => re.test(symbol))) return "meme";
  return "default";
}

export function resolveVolumeSpikeMultiplier(symbol: string): number {
  const bucket = classifySymbolBucket(symbol);
  if (bucket === "high_cap") return HIGH_CAP_VOLUME_SPIKE_MULTIPLIER;
  if (bucket === "meme") return MEME_VOLUME_SPIKE_MULTIPLIER;
  return DEFAULT_VOLUME_SPIKE_MULTIPLIER;
}

function resolveSessionBand(utcHour: number): SessionLiquidityBand {
  if (utcHour >= 12 && utcHour <= 21) return "high";
  if (utcHour >= 2 && utcHour <= 6) return "low";
  return "neutral";
}

export function resolveSessionAwareMinAiConfidence(params: {
  baseMinAiConfidence: number;
  avgVolume1m: number;
  lastCandleVolume: number;
  now?: Date;
}): {
  adjustedMinAiConfidence: number;
  sessionBand: SessionLiquidityBand;
  volumeRatio: number;
  confidenceDelta: number;
} {
  const base = clamp(toNumber(params.baseMinAiConfidence, 0), 1, 100);
  const avgVol = toNumber(params.avgVolume1m, 0);
  const lastVol = toNumber(params.lastCandleVolume, 0);
  const volumeRatio = avgVol > 0 ? lastVol / avgVol : 1;
  const now = params.now ?? new Date();
  const sessionBand = resolveSessionBand(now.getUTCHours());

  let confidenceDelta = 0;
  if (sessionBand === "high") confidenceDelta -= 2;
  if (sessionBand === "low") confidenceDelta += 3;

  if (volumeRatio >= 2) confidenceDelta -= 5;
  else if (volumeRatio >= 1.4) confidenceDelta -= 2;
  else if (volumeRatio <= 0.7) confidenceDelta += 4;
  else if (volumeRatio <= 0.9) confidenceDelta += 2;

  const adjustedMinAiConfidence = clamp(base + confidenceDelta, 30, 95);
  return {
    adjustedMinAiConfidence,
    sessionBand,
    volumeRatio: Number(volumeRatio.toFixed(4)),
    confidenceDelta,
  };
}
