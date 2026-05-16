// @ts-nocheck

function readPctEnv(keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = String(Deno.env.get(key) ?? "").trim();
    if (!raw) continue;
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return Math.min(5, Math.max(0.05, n));
    }
  }
  return fallback;
}

export function readSmartLimitMaxChasePct(symbol: string): number {
  const sym = String(symbol ?? "").toUpperCase();
  if (sym.includes("PEPE")) {
    return readPctEnv(
      ["SMART_LIMIT_MAX_CHASE_PCT_PEPEUSDT", "SMART_LIMIT_MAX_CHASE_PCT"],
      0.5,
    );
  }
  if (sym.includes("SOL")) {
    return readPctEnv(
      ["SMART_LIMIT_MAX_CHASE_PCT_SOLUSDT", "SMART_LIMIT_MAX_CHASE_PCT"],
      0.25,
    );
  }
  return readPctEnv(
    ["SMART_LIMIT_MAX_CHASE_PCT_BTCUSDT", "SMART_LIMIT_MAX_CHASE_PCT"],
    0.2,
  );
}

export function readSmartLimitMaxSlippagePct(symbol: string): number {
  const chase = readSmartLimitMaxChasePct(symbol);
  const sym = String(symbol ?? "").toUpperCase();
  const keys = sym.includes("PEPE")
    ? ["SMART_LIMIT_MAX_SLIPPAGE_PCT_PEPEUSDT", "SMART_LIMIT_MAX_SLIPPAGE_PCT"]
    : sym.includes("SOL")
    ? ["SMART_LIMIT_MAX_SLIPPAGE_PCT_SOLUSDT", "SMART_LIMIT_MAX_SLIPPAGE_PCT"]
    : ["SMART_LIMIT_MAX_SLIPPAGE_PCT_BTCUSDT", "SMART_LIMIT_MAX_SLIPPAGE_PCT"];
  const configured = readPctEnv(keys, chase);
  return Math.max(configured, chase);
}

export function computeAdverseSlippageFrac(params: {
  side: "buy" | "sell";
  signalPrice: number;
  referencePrice: number;
}): number {
  const signalPrice = Number(params.signalPrice);
  const referencePrice = Number(params.referencePrice);
  if (!Number.isFinite(signalPrice) || signalPrice <= 0) return 0;
  if (!Number.isFinite(referencePrice) || referencePrice <= 0) return 0;
  if (params.side === "buy") {
    return Math.max(0, (referencePrice - signalPrice) / signalPrice);
  }
  return Math.max(0, (signalPrice - referencePrice) / signalPrice);
}
