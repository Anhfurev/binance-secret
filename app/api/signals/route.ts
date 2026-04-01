import { NextResponse } from "next/server";
import { mockSignals } from "@/lib/signals-data";
import type {
  AITradeSignal,
  SignalType,
  TimeHorizon,
  PriceTarget,
} from "@/lib/types";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COIN_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "ripple",
  "binancecoin",
  "dogecoin",
  "cardano",
  "avalanche-2",
];

interface CoinWithSparkline {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  price_change_percentage_24h: number;
  total_volume: number;
  market_cap: number;
  high_24h: number;
  low_24h: number;
  sparkline_in_7d: { price: number[] };
}

interface SignalsResponse {
  signals: AITradeSignal[];
  source: "live" | "fallback";
  lastUpdated: string;
  computed: boolean;
}

// --- Technical computation helpers ---

function calcEMA(prices: number[], period: number): number {
  const k = 2 / (period + 1);
  let val = prices[0];
  for (let i = 1; i < prices.length; i++) {
    val = prices[i] * k + val * (1 - k);
  }
  return val;
}

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

function calcMACD(prices: number[]): "bullish" | "bearish" | "neutral" {
  if (prices.length < 27) return "neutral";
  const macd = calcEMA(prices.slice(-26), 12) - calcEMA(prices.slice(-26), 26);
  const prevMacd =
    calcEMA(prices.slice(-27, -1), 12) - calcEMA(prices.slice(-27, -1), 26);
  if (macd > 0 && macd > prevMacd) return "bullish";
  if (macd < 0 && macd < prevMacd) return "bearish";
  return "neutral";
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

// --- Core signal computation ---

function computeSignal(coin: CoinWithSparkline): AITradeSignal {
  const prices = coin.sparkline_in_7d?.price ?? [];
  const price = coin.current_price;
  const change24h = coin.price_change_percentage_24h ?? 0;

  const rsi = calcRSI(prices);
  const macd = calcMACD(prices);
  const rawATR = calcATR(prices) || price * 0.03;

  const ma20 = prices.length >= 20 ? calcEMA(prices.slice(-20), 20) : price;
  const ma50 = prices.length >= 50 ? calcEMA(prices.slice(-50), 50) : price;
  const maSignal: "above" | "below" | "crossing" =
    price > ma20 && price > ma50
      ? "above"
      : price < ma20 && price < ma50
        ? "below"
        : "crossing";

  const volumeRatio = coin.total_volume / (coin.market_cap || 1);
  const volumeSignal: "high" | "normal" | "low" =
    volumeRatio > 0.12 ? "high" : volumeRatio > 0.04 ? "normal" : "low";

  // Composite score: weighted sum of normalized indicators [-1, +1]
  const rsiNorm = (rsi - 50) / 50;
  const macdNorm = macd === "bullish" ? 1 : macd === "bearish" ? -1 : 0;
  const trendNorm = Math.max(-1, Math.min(1, change24h / 10));
  const maNorm = maSignal === "above" ? 1 : maSignal === "below" ? -1 : 0;
  const volBonus = volumeSignal === "high" ? 0.1 : 0;
  const composite =
    rsiNorm * 0.25 +
    macdNorm * 0.3 +
    trendNorm * 0.25 +
    maNorm * 0.2 +
    volBonus;

  let signalType: SignalType;
  let confidence: number;

  if (composite >= 0.45) {
    signalType = "STRONG_BUY";
    confidence = Math.round(70 + composite * 20);
  } else if (composite >= 0.18) {
    signalType = "BUY";
    confidence = Math.round(58 + composite * 30);
  } else if (composite <= -0.45) {
    signalType = "STRONG_SELL";
    confidence = Math.round(70 + Math.abs(composite) * 20);
  } else if (composite <= -0.18) {
    signalType = "SELL";
    confidence = Math.round(58 + Math.abs(composite) * 30);
  } else {
    signalType = "HOLD";
    confidence = Math.round(45 + (1 - Math.abs(composite)) * 15);
  }
  confidence = Math.min(92, Math.max(46, confidence));

  const timeHorizon: TimeHorizon =
    confidence > 75 ? "short" : confidence > 62 ? "medium" : "long";

  // Entry, stop-loss, take-profits using ATR
  const dir = signalType.includes("BUY")
    ? "buy"
    : signalType.includes("SELL")
      ? "sell"
      : "hold";
  const slDist = rawATR * 2;
  const tp1 = rawATR * 2.5;
  const tp2 = rawATR * 4.5;
  const tp3 = rawATR * 7;

  let stopLoss: number;
  let takeProfits: PriceTarget[];

  if (dir === "buy") {
    stopLoss = +(price - slDist).toFixed(4);
    takeProfits = [
      {
        price: +(price + tp1).toFixed(4),
        probability: 72,
        timeframe: "1-2 days",
      },
      {
        price: +(price + tp2).toFixed(4),
        probability: 52,
        timeframe: "3-7 days",
      },
      {
        price: +(price + tp3).toFixed(4),
        probability: 32,
        timeframe: "2-4 weeks",
      },
    ];
  } else if (dir === "sell") {
    stopLoss = +(price + slDist).toFixed(4);
    takeProfits = [
      {
        price: +(price - tp1).toFixed(4),
        probability: 68,
        timeframe: "1-2 days",
      },
      {
        price: +(price - tp2).toFixed(4),
        probability: 48,
        timeframe: "3-7 days",
      },
    ];
  } else {
    stopLoss = +(price - slDist).toFixed(4);
    takeProfits = [
      {
        price: +(price + tp1).toFixed(4),
        probability: 50,
        timeframe: "3-7 days",
      },
    ];
  }

  const rrRatio = +(tp1 / slDist).toFixed(1);
  const stopDistancePct = Math.max(0.5, (slDist / price) * 100);
  const volatilityPct = Math.max(0.1, (rawATR / price) * 100);
  const volatilityLevel: "low" | "medium" | "high" =
    volatilityPct < 2.2 ? "low" : volatilityPct < 4.8 ? "medium" : "high";

  const confidencePenalty = Math.max(0, 100 - confidence);
  const directionPenalty = signalType === "HOLD" ? 8 : 0;
  const volatilityPenalty =
    volatilityLevel === "high" ? 20 : volatilityLevel === "medium" ? 11 : 5;
  const riskScore = Math.round(
    Math.min(
      95,
      Math.max(
        5,
        stopDistancePct * 4.5 +
          volatilityPenalty +
          confidencePenalty * 0.45 +
          directionPenalty,
      ),
    ),
  );

  const expectedDrawdown = +Math.max(
    0.5,
    stopDistancePct *
      (volatilityLevel === "high"
        ? 1.2
        : volatilityLevel === "medium"
          ? 1.05
          : 0.9),
  ).toFixed(2);

  const probabilityOfSuccess = Math.round(
    Math.min(
      95,
      Math.max(
        25,
        confidence * 0.75 +
          rrRatio * 6 -
          (volatilityLevel === "high"
            ? 8
            : volatilityLevel === "medium"
              ? 4
              : 0),
      ),
    ),
  );

  // Human-readable reasoning
  const reasoning: string[] = [];
  if (rsi < 35)
    reasoning.push(
      `RSI at ${rsi.toFixed(0)} — deeply oversold, bounce zone active`,
    );
  else if (rsi > 65)
    reasoning.push(`RSI at ${rsi.toFixed(0)} — bullish momentum building`);
  else
    reasoning.push(
      `RSI at ${rsi.toFixed(0)} — neutral zone, monitoring for breakout`,
    );

  if (macd === "bullish")
    reasoning.push("MACD turning positive — upside momentum accelerating");
  else if (macd === "bearish")
    reasoning.push("MACD histogram negative — selling pressure dominant");
  else reasoning.push("MACD neutral — waiting for directional catalyst");

  if (change24h > 3)
    reasoning.push(
      `Strong 24h move: +${change24h.toFixed(1)}% with volume confirmation`,
    );
  else if (change24h < -3)
    reasoning.push(
      `Selling pressure: ${change24h.toFixed(1)}% decline — watch key support`,
    );
  else
    reasoning.push(
      `24h change: ${change24h.toFixed(1)}% — consolidating near current levels`,
    );

  if (maSignal === "above")
    reasoning.push("Price above key moving averages — trend is your friend");
  else if (maSignal === "below")
    reasoning.push("Price below MAs — wait for reclaim before adding exposure");

  if (volumeSignal === "high")
    reasoning.push("Above-average volume confirms institutional conviction");

  const conditions: string[] = [];
  if (volumeSignal === "high") conditions.push("High volume");
  if (Math.abs(change24h) > 5) conditions.push("High volatility");
  if (rsi < 40) conditions.push("Oversold territory");
  if (rsi > 60) conditions.push("Bullish momentum");
  if (maSignal === "above") conditions.push("Uptrend");
  if (maSignal === "below") conditions.push("Downtrend");
  if (conditions.length === 0) conditions.push("Neutral market");

  const now = new Date();
  const expiryH =
    timeHorizon === "short" ? 24 : timeHorizon === "medium" ? 72 : 168;

  return {
    id: `live-${coin.id}-${Date.now()}`,
    coinId: coin.id,
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    image: coin.image,
    signalType,
    confidence,
    currentPrice: price,
    entryPrice: price,
    stopLoss,
    takeProfits,
    riskRewardRatio: rrRatio,
    riskScore,
    volatilityLevel,
    expectedDrawdown,
    probabilityOfSuccess,
    timeHorizon,
    reasoning,
    technicalIndicators: {
      rsi: Math.round(rsi),
      macd,
      movingAverages: maSignal,
      volume: volumeSignal,
    },
    marketConditions: conditions,
    createdAt: now,
    expiresAt: new Date(now.getTime() + expiryH * 3_600_000),
    isActive: true,
  };
}

export async function GET(): Promise<NextResponse<SignalsResponse>> {
  try {
    const res = await fetch(
      `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${COIN_IDS.join(",")}&order=market_cap_desc&sparkline=true`,
      {
        next: { revalidate: 120 }, // 2-minute server cache
        headers: { Accept: "application/json" },
      },
    );

    if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);

    const coins: CoinWithSparkline[] = await res.json();
    const signals = coins
      .filter((c) => (c.sparkline_in_7d?.price?.length ?? 0) > 50)
      .map(computeSignal)
      .sort((a, b) => b.confidence - a.confidence);

    return NextResponse.json({
      signals,
      source: "live",
      lastUpdated: new Date().toISOString(),
      computed: true,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : JSON.stringify(err);
    console.error("[/api/signals] CoinGecko failed, using fallback:", errorMsg);
    return NextResponse.json({
      signals: mockSignals,
      source: "fallback",
      lastUpdated: new Date().toISOString(),
      computed: false,
      error: errorMsg,
    });
  }
}
