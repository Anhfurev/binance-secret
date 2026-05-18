export type CandleSeed = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

const RVOL_LOOKBACK = 96;

export function parseKlineRow(k: Record<string, unknown>): CandleSeed | null {
  const open = Number(k.o);
  const high = Number(k.h);
  const low = Number(k.l);
  const close = Number(k.c);
  const volume = Number(k.v);
  if (![open, high, low, close, volume].every((n) => Number.isFinite(n) && n > 0)) {
    return null;
  }
  return { open, high, low, close, volume };
}

export function computeRvol24h(volumes: number[]): number {
  if (volumes.length < 2) return 1;
  const last = volumes[volumes.length - 1] ?? 0;
  const history = volumes.slice(
    Math.max(0, volumes.length - RVOL_LOOKBACK - 1),
    -1,
  );
  const avg =
    history.length > 0
      ? history.reduce((s, v) => s + v, 0) / history.length
      : last;
  if (avg <= 0) return 1;
  return Number((last / avg).toFixed(3));
}

export function computeRsi14(closes: number[]): number {
  if (closes.length < 15) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - 14; i < closes.length; i += 1) {
    const diff = closes[i]! - closes[i - 1]!;
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return Number((100 - 100 / (1 + rs)).toFixed(2));
}

export function candleGainPct(candle: CandleSeed): number {
  if (candle.open <= 0) return 0;
  return ((candle.close - candle.open) / candle.open) * 100;
}
