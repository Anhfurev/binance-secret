import { assertEquals } from "jsr:@std/assert@1";
import { calculateAdx } from "../strategy-regime.ts";
import type { Candle } from "../types.ts";

function trendingCandles(n: number): Candle[] {
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i += 1) {
    const drift = i % 3 === 0 ? -0.4 : 0.8;
    close += drift;
    const high = close + 1.2;
    const low = close - 0.8;
    out.push({
      open: close - drift * 0.5,
      high,
      low,
      close,
      volume: 1000 + i,
      openTime: i,
    });
  }
  return out;
}

Deno.test("calculateAdx uses Wilder smoothing not plain DX mean", () => {
  const candles = trendingCandles(80);
  const wilder = calculateAdx(candles, 14);
  const dxValues: number[] = [];
  const period = 14;
  const trs: number[] = [];
  const plusDMs: number[] = [];
  const minusDMs: number[] = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const prev = candles[i - 1];
    const upMove = current.high - prev.high;
    const downMove = prev.low - current.low;
    const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
    const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;
    const tr = Math.max(
      current.high - current.low,
      Math.abs(current.high - prev.close),
      Math.abs(current.low - prev.close),
    );
    trs.push(tr);
    plusDMs.push(plusDM);
    minusDMs.push(minusDM);
  }
  let atr = trs.slice(0, period).reduce((s, v) => s + v, 0);
  let plusDM = plusDMs.slice(0, period).reduce((s, v) => s + v, 0);
  let minusDM = minusDMs.slice(0, period).reduce((s, v) => s + v, 0);
  for (let i = period; i < trs.length; i += 1) {
    if (i > period) {
      atr = atr - atr / period + trs[i];
      plusDM = plusDM - plusDM / period + plusDMs[i];
      minusDM = minusDM - minusDM / period + minusDMs[i];
    }
    const plusDI = (100 * plusDM) / atr;
    const minusDI = (100 * minusDM) / atr;
    const denom = plusDI + minusDI;
    dxValues.push(denom > 0 ? (100 * Math.abs(plusDI - minusDI)) / denom : 0);
  }
  const plainMean = dxValues.reduce((s, v) => s + v, 0) / dxValues.length;
  assertEquals(wilder > 0, true);
  assertEquals(Math.abs(wilder - plainMean) > 0.01, true);
});
