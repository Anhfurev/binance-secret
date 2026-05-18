// @ts-nocheck
/** 1m vs 24h volume gate policy — relaxes micro-liquidity floors on liquid alts. */
import type { IndicatorSnapshot } from "./types.ts";
import { toNumber } from "./utils.ts";

const DEFAULT_HIGH_LIQ_SYMBOLS = ["SOLUSDT", "PEPEUSDT", "BTCUSDT"] as const;

function readEnvNum(key: string, fallback: number, min: number, max: number): number {
  const raw = String(Deno.env.get(key) ?? "").trim();
  if (!raw.length) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function readHighLiquiditySymbolSet(): Set<string> {
  const raw = String(Deno.env.get("SMART_FILTER_HIGH_LIQ_SYMBOLS") ?? "").trim();
  const list = raw.length
    ? raw.split(/[,\s]+/).map((s) => s.toUpperCase()).filter(Boolean)
    : [...DEFAULT_HIGH_LIQ_SYMBOLS];
  return new Set(list);
}

export function isHighLiquiditySymbol(symbol: string): boolean {
  return readHighLiquiditySymbolSet().has(String(symbol ?? "").toUpperCase());
}

/** Absolute 1m quote-volume floor for high-liq pairs (default $100). */
export function readHighLiquidity1mFloorUsd(): number {
  return readEnvNum("SMART_FILTER_HIGH_LIQ_1M_FLOOR_USD", 100, 0, 10_000);
}

export type SmartFilterVolumeGateMode =
  | "standard"
  | "high_liq_relaxed_1m"
  | "high_liq_24h_primary";

export type SmartFilterVolumeGatePolicy = {
  mode: SmartFilterVolumeGateMode;
  minVolume1mQuoteUsd: number;
  /** When true, skip `FAIL_LOW_VOLUME_VS_24H_AVG` (AI sleep). */
  skip1mVs24hAvgGate: boolean;
  /** When true, skip `FAIL_LOW_1M_VOLUME_USD` entirely. */
  skip1mUsdGate: boolean;
  minVolume24hQuoteDb: number;
  volume24hQuote: number;
};

/**
 * High-liq symbols (SOL/PEPE/BTC): cap 1m USD floor (~$100) and prefer DB 24h gate.
 * When `min_volume_24h_quote` is disabled (≤0) or tape passes it, skip strict 1m burst checks.
 */
export function resolveSmartFilterVolumeGatePolicy(params: {
  symbol: string;
  baseMinVolume1mQuoteUsd: number;
  minVolume24hQuoteFromDb?: number;
  snapshot?: Pick<IndicatorSnapshot, "volume24hQuote">;
}): SmartFilterVolumeGatePolicy {
  const sym = String(params.symbol ?? "").toUpperCase();
  const min24hDb = Math.max(0, toNumber(params.minVolume24hQuoteFromDb, 0));
  const vol24h = Math.max(0, toNumber(params.snapshot?.volume24hQuote, 0));
  const baseFloor = Math.max(0, toNumber(params.baseMinVolume1mQuoteUsd, 0));

  if (!isHighLiquiditySymbol(sym)) {
    return {
      mode: "standard",
      minVolume1mQuoteUsd: baseFloor,
      skip1mVs24hAvgGate: false,
      skip1mUsdGate: false,
      minVolume24hQuoteDb: min24hDb,
      volume24hQuote: vol24h,
    };
  }

  const highLiqFloor = readHighLiquidity1mFloorUsd();
  const relaxed1m = highLiqFloor <= 0 ? 0 : Math.min(baseFloor, highLiqFloor);
  const dbGateOff = min24hDb <= 0;
  const passesDb24h = min24hDb > 0 && vol24h >= min24hDb;
  const use24hPrimary = dbGateOff || passesDb24h;

  if (use24hPrimary) {
    return {
      mode: "high_liq_24h_primary",
      minVolume1mQuoteUsd: relaxed1m,
      skip1mVs24hAvgGate: true,
      skip1mUsdGate: true,
      minVolume24hQuoteDb: min24hDb,
      volume24hQuote: vol24h,
    };
  }

  return {
    mode: "high_liq_relaxed_1m",
    minVolume1mQuoteUsd: relaxed1m,
    skip1mVs24hAvgGate: true,
    skip1mUsdGate: false,
    minVolume24hQuoteDb: min24hDb,
    volume24hQuote: vol24h,
  };
}
