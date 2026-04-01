import { NextResponse } from "next/server";
import { mockPredictions } from "@/lib/signals-data";
import type { PricePrediction } from "@/lib/types";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COIN_IDS = ["bitcoin", "ethereum", "solana", "ripple"];

interface CoinWithSparkline {
  id: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number;
  high_24h: number;
  low_24h: number;
  sparkline_in_7d: { price: number[] };
}

interface PredictionsResponse {
  predictions: PricePrediction[];
  source: "live" | "fallback";
  lastUpdated: string;
  computed: boolean;
}

// --- Helpers ---

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const slice = prices.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let i = 1; i < slice.length; i++) {
    const d = slice[i] - slice[i - 1];
    if (d > 0) gains += d;
    else losses += Math.abs(d);
  }
  if (losses === 0) return 99;
  return 100 - 100 / (1 + gains / losses);
}

function calcATR(sparkline: number[]): number {
  const ranges: number[] = [];
  for (let i = 24; i <= sparkline.length; i += 24) {
    const day = sparkline.slice(i - 24, i);
    ranges.push(Math.max(...day) - Math.min(...day));
  }
  return ranges.length > 0
    ? ranges.reduce((a, b) => a + b, 0) / ranges.length
    : 0;
}

function pct(predicted: number, base: number): number {
  return +((predicted / base - 1) * 100).toFixed(2);
}

function dir(predicted: number, base: number): "up" | "down" | "sideways" {
  const p = pct(predicted, base);
  if (Math.abs(p) < 0.5) return "sideways";
  return p > 0 ? "up" : "down";
}

// --- Core prediction computation ---

function computePrediction(coin: CoinWithSparkline): PricePrediction {
  const prices = coin.sparkline_in_7d?.price ?? [];
  const price = coin.current_price;
  const change24h = (coin.price_change_percentage_24h ?? 0) / 100;

  // 24h momentum from sparkline (recent 24 vs prior 24)
  const recent24 = prices.slice(-24);
  const prior24 = prices.slice(-48, -24);
  const momentum24h =
    prior24.length > 0 && prior24[0] > 0
      ? (recent24[recent24.length - 1] - prior24[0]) / prior24[0]
      : change24h;

  // 7d overall trend
  const trend7d =
    prices.length > 1 && prices[0] > 0
      ? (prices[prices.length - 1] - prices[0]) / prices[0]
      : 0;

  const rsi = calcRSI(prices);
  const rawATR = calcATR(prices) || price * 0.03;

  // Mean-reversion factor: overbought → lean bearish, oversold → lean bullish
  const reversionFactor = rsi > 70 ? -0.25 : rsi < 30 ? 0.25 : 0;

  // Projected price levels
  const p1h = price * (1 + momentum24h * 0.04);
  const p24h =
    price * (1 + momentum24h * 0.7 + trend7d * 0.15 + reversionFactor * 0.08);
  const p7d = price * (1 + trend7d * 0.55 + reversionFactor * 0.25);
  const p30d = price * (1 + trend7d * 0.35 + reversionFactor * 0.4);

  const round = (v: number) => Math.round(v * 10000) / 10000;

  // Confidence degrades with time; boost if trend and momentum agree
  const trendAgrees = trend7d * momentum24h > 0 ? 1.0 : 0.82;
  const c1h = Math.round(Math.min(82, 73 * trendAgrees));
  const c24h = Math.round(Math.min(74, 65 * trendAgrees));
  const c7d = Math.round(Math.min(65, 57 * trendAgrees));
  const c30d = Math.round(Math.min(55, 47 * trendAgrees));

  // Support / Resistance from sparkline quantile distribution
  const sorted = [...prices].sort((a, b) => a - b);
  const q = (p: number) =>
    sorted[Math.max(0, Math.floor(sorted.length * p))] ?? price;

  const supportLevels = [q(0.08), q(0.18), q(0.28)].map(
    (v) => Math.round(v * 100) / 100,
  );
  const resistanceLevels = [q(0.72), q(0.82), q(0.92)].map(
    (v) => Math.round(v * 100) / 100,
  );

  // AI analysis narrative based on computed indicators
  const rsiLabel =
    rsi > 70
      ? "overbought"
      : rsi < 30
        ? "oversold"
        : `neutral (${rsi.toFixed(0)})`;

  const trendDesc =
    trend7d > 0.07
      ? "strong 7-day uptrend"
      : trend7d > 0.02
        ? "mild 7-day uptrend"
        : trend7d < -0.07
          ? "strong 7-day downtrend"
          : trend7d < -0.02
            ? "mild 7-day downtrend"
            : "sideways consolidation";

  const momentumDesc =
    momentum24h > 0.03
      ? "bullish short-term momentum"
      : momentum24h < -0.03
        ? "bearish short-term pressure"
        : "neutral momentum";

  const cautionNote =
    rsi > 68
      ? "Caution: overbought RSI may trigger near-term pullback."
      : rsi < 32
        ? "Oversold: key support zone — potential bounce if holds."
        : "Monitoring for directional breakout from current range.";

  const aiAnalysis =
    `${coin.symbol.toUpperCase()} showing ${trendDesc} with ${momentumDesc}. ` +
    `RSI ${rsiLabel}. 24h ATR: $${rawATR.toFixed(2)}. ` +
    `Support cluster: $${supportLevels[0].toLocaleString()} – $${supportLevels[1].toLocaleString()}. ` +
    `Resistance: $${resistanceLevels[1].toLocaleString()} – $${resistanceLevels[2].toLocaleString()}. ` +
    cautionNote;

  return {
    coinId: coin.id,
    symbol: coin.symbol.toUpperCase(),
    currentPrice: price,
    predictions: [
      {
        timeframe: "1h",
        predictedPrice: round(p1h),
        confidence: c1h,
        direction: dir(p1h, price),
        percentChange: pct(p1h, price),
      },
      {
        timeframe: "24h",
        predictedPrice: round(p24h),
        confidence: c24h,
        direction: dir(p24h, price),
        percentChange: pct(p24h, price),
      },
      {
        timeframe: "7d",
        predictedPrice: round(p7d),
        confidence: c7d,
        direction: dir(p7d, price),
        percentChange: pct(p7d, price),
      },
      {
        timeframe: "30d",
        predictedPrice: round(p30d),
        confidence: c30d,
        direction: dir(p30d, price),
        percentChange: pct(p30d, price),
      },
    ],
    supportLevels,
    resistanceLevels,
    aiAnalysis,
  };
}

export async function GET(): Promise<NextResponse<PredictionsResponse>> {
  try {
    const url = `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${COIN_IDS.join(",")}&order=market_cap_desc&sparkline=true&price_change_percentage=24h`;

    const res = await fetch(url, {
      next: { revalidate: 300 },
      headers: {
        Accept: "application/json",
        "User-Agent": "NexTrade-AI/1.0",
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`CoinGecko ${res.status}: ${text.slice(0, 200)}`);
    }

    const coins: CoinWithSparkline[] = await res.json();

    if (!Array.isArray(coins) || coins.length === 0) {
      throw new Error("CoinGecko returned empty array");
    }

    const predictions = coins
      .filter((c) => (c.sparkline_in_7d?.price?.length ?? 0) > 50)
      .map(computePrediction);

    if (predictions.length === 0) {
      throw new Error("No coins had sufficient sparkline data");
    }

    return NextResponse.json({
      predictions,
      source: "live",
      lastUpdated: new Date().toISOString(),
      computed: true,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
    console.error(
      "[/api/predictions] CoinGecko failed, using fallback:",
      errorMsg,
    );
    return NextResponse.json({
      predictions: mockPredictions,
      source: "fallback",
      lastUpdated: new Date().toISOString(),
      computed: false,
      error: errorMsg,
    });
  }
}
