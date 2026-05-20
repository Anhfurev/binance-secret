import type { ScalpCandle } from "@/lib/trading/paper-scalp-indicators";

export type MicroAccelerationHit = {
  symbol: string;
  rocPct: number;
  volumeSpike: number;
  close: number;
  interval: "1m" | "3m";
};

function envNum(key: string, fallback: number): number {
  const n = Number(String(process.env[key] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function readMicroVolumeSpikeMult(): number {
  return envNum("MICRO_VOLUME_SPIKE_MULT", 3);
}

export function readMicroRocMinPct(): number {
  return envNum("MICRO_ROC_MIN_PCT", 0.35);
}

function norm(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

/** 1m: 2-minute vol window vs 60-bar pool (~1h MA). ROC vs 2 bars ago. */
export function detectMicroAcceleration1m(
  symbol: string,
  candles: ScalpCandle[],
): MicroAccelerationHit | null {
  if (candles.length < 62) return null;

  const spikeMult = readMicroVolumeSpikeMult();
  const rocMin = readMicroRocMinPct();
  const n = candles.length;
  const last = candles[n - 1]!;
  const prev2 = candles[n - 3];
  if (!prev2 || last.close <= 0 || prev2.close <= 0) return null;

  const vol2m = candles
    .slice(n - 2, n)
    .reduce((s, c) => s + (c.volume ?? 0), 0);
  const volMaPool =
    candles.slice(n - 61, n - 1).reduce((s, c) => s + (c.volume ?? 0), 0) /
    60;
  if (volMaPool <= 0) return null;

  const volumeSpike = vol2m / volMaPool;
  if (volumeSpike < spikeMult) return null;

  const rocPct = ((last.close - prev2.close) / prev2.close) * 100;
  if (rocPct < rocMin) return null;

  return {
    symbol: norm(symbol),
    rocPct: Number(rocPct.toFixed(4)),
    volumeSpike: Number(volumeSpike.toFixed(2)),
    close: last.close,
    interval: "1m",
  };
}

/** 3m: latest bar vol vs 20-bar pool (~1h). */
export function detectMicroAcceleration3m(
  symbol: string,
  candles: ScalpCandle[],
): MicroAccelerationHit | null {
  if (candles.length < 22) return null;

  const spikeMult = readMicroVolumeSpikeMult();
  const rocMin = readMicroRocMinPct();
  const n = candles.length;
  const last = candles[n - 1]!;
  const prev2 = candles[n - 3];
  if (!prev2 || last.close <= 0 || prev2.close <= 0) return null;

  const vol2m = last.volume ?? 0;
  const volMaPool =
    candles.slice(n - 21, n - 1).reduce((s, c) => s + (c.volume ?? 0), 0) /
    20;
  if (volMaPool <= 0) return null;

  const volumeSpike = vol2m / volMaPool;
  if (volumeSpike < spikeMult) return null;

  const rocPct = ((last.close - prev2.close) / prev2.close) * 100;
  if (rocPct < rocMin) return null;

  return {
    symbol: norm(symbol),
    rocPct: Number(rocPct.toFixed(4)),
    volumeSpike: Number(volumeSpike.toFixed(2)),
    close: last.close,
    interval: "3m",
  };
}

export function pickBestMicroAcceleration(
  watchlist: string[],
  candles1m: Map<string, ScalpCandle[]>,
  candles3m: Map<string, ScalpCandle[]>,
  heldSymbols: Set<string> = new Set(),
): MicroAccelerationHit | null {
  let best: MicroAccelerationHit | null = null;

  for (const raw of watchlist) {
    const key = norm(raw);
    if (heldSymbols.has(key)) continue;

    const c1 = candles1m.get(key);
    if (!c1?.length) continue;

    const hit1m = detectMicroAcceleration1m(key, c1);
    if (!hit1m) continue;

    const c3 = candles3m.get(key);
    if (c3?.length) {
      const hit3m = detectMicroAcceleration3m(key, c3);
      if (!hit3m) continue;
    }

    if (!best || hit1m.volumeSpike > best.volumeSpike) best = hit1m;
  }

  return best;
}
