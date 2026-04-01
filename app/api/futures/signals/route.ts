import { NextResponse } from "next/server";
import { binanceFuturesPublicGet } from "@/lib/binance";

const FUTURES_SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "AVAXUSDT"];

type Direction = "up" | "down" | "sideways";
type FuturesSignalType = "LONG" | "SHORT" | "WAIT";

interface FuturesSignal {
  symbol: string;
  signal: FuturesSignalType;
  confidence: number;
  markPrice: number;
  change24h: number;
  fundingRate: number;
  openInterestDeltaPct: number;
  rsi: number;
  direction: Direction;
  reason: string;
  generatedAt: string;
}

interface FuturesSignalsResponse {
  source: "live" | "fallback";
  generatedAt: string;
  signals: FuturesSignal[];
}

type Kline = [
  number,
  string,
  string,
  string,
  string,
  string,
  number,
  string,
  number,
  string,
  string,
  string,
];

interface PremiumIndex {
  markPrice: string;
  lastFundingRate: string;
}

interface Ticker24h {
  priceChangePercent: string;
}

interface OpenInterestPoint {
  sumOpenInterest: string;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  const slice = closes.slice(-(period + 1));
  let gains = 0;
  let losses = 0;

  for (let i = 1; i < slice.length; i++) {
    const diff = slice[i] - slice[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  if (losses === 0) return 99;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function getDirection(changePct: number): Direction {
  if (Math.abs(changePct) < 0.4) return "sideways";
  return changePct > 0 ? "up" : "down";
}

function buildSignal(params: {
  symbol: string;
  markPrice: number;
  change24h: number;
  fundingRate: number;
  openInterestDeltaPct: number;
  rsi: number;
}): FuturesSignal {
  const {
    symbol,
    markPrice,
    change24h,
    fundingRate,
    openInterestDeltaPct,
    rsi,
  } = params;

  // Composite score: trend + momentum + OI + funding
  const trendScore = Math.max(-1, Math.min(1, change24h / 5)) * 0.35;
  const rsiScore = ((rsi - 50) / 50) * 0.25;
  const oiScore = Math.max(-1, Math.min(1, openInterestDeltaPct / 8)) * 0.25;
  const fundingScore = Math.max(-1, Math.min(1, fundingRate / 0.0008)) * 0.15;
  const composite = trendScore + rsiScore + oiScore + fundingScore;

  let signal: FuturesSignalType = "WAIT";
  if (composite >= 0.32) signal = "LONG";
  else if (composite <= -0.32) signal = "SHORT";

  const confidence = Math.round(50 + Math.min(42, Math.abs(composite) * 48));

  const reason = [
    `24h ${change24h >= 0 ? "+" : ""}${change24h.toFixed(2)}%`,
    `RSI ${rsi.toFixed(0)}`,
    `OI ${openInterestDeltaPct >= 0 ? "+" : ""}${openInterestDeltaPct.toFixed(2)}%`,
    `Funding ${(fundingRate * 100).toFixed(4)}%`,
  ].join(" | ");

  return {
    symbol,
    signal,
    confidence,
    markPrice,
    change24h,
    fundingRate,
    openInterestDeltaPct,
    rsi,
    direction: getDirection(change24h),
    reason,
    generatedAt: new Date().toISOString(),
  };
}

async function fetchSymbolSignal(symbol: string): Promise<FuturesSignal> {
  const [premium, ticker, klines, openInterest] = await Promise.all([
    binanceFuturesPublicGet<PremiumIndex>("/fapi/v1/premiumIndex", { symbol }),
    binanceFuturesPublicGet<Ticker24h>("/fapi/v1/ticker/24hr", { symbol }),
    binanceFuturesPublicGet<Kline[]>("/fapi/v1/klines", {
      symbol,
      interval: "5m",
      limit: 120,
    }),
    binanceFuturesPublicGet<OpenInterestPoint[]>(
      "/futures/data/openInterestHist",
      {
        symbol,
        period: "5m",
        limit: 30,
      },
    ),
  ]);

  const closes = klines
    .map((k) => Number(k[4]))
    .filter((v) => Number.isFinite(v));
  const rsi = calcRSI(closes);

  const oiValues = openInterest
    .map((x) => Number(x.sumOpenInterest))
    .filter((v) => Number.isFinite(v));
  const firstOi = oiValues[0] ?? 0;
  const lastOi = oiValues[oiValues.length - 1] ?? firstOi;
  const oiDeltaPct = firstOi > 0 ? ((lastOi - firstOi) / firstOi) * 100 : 0;

  return buildSignal({
    symbol,
    markPrice: Number(premium.markPrice),
    fundingRate: Number(premium.lastFundingRate),
    change24h: Number(ticker.priceChangePercent),
    openInterestDeltaPct: oiDeltaPct,
    rsi,
  });
}

export async function GET() {
  try {
    const signals = await Promise.all(FUTURES_SYMBOLS.map(fetchSymbolSignal));
    const response: FuturesSignalsResponse = {
      source: "live",
      generatedAt: new Date().toISOString(),
      signals: signals.sort((a, b) => b.confidence - a.confidence),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      {
        source: "fallback",
        generatedAt: new Date().toISOString(),
        signals: [],
        error: message,
      },
      { status: 200 },
    );
  }
}
