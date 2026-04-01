import { NextResponse } from "next/server";
import { mockCoins, mockGlobalData } from "@/lib/mock-data";
import type { CoinData, GlobalMarketData } from "@/lib/types";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COIN_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "ripple",
  "binancecoin",
  "dogecoin",
];

interface MarketResponse {
  coins: CoinData[];
  global: GlobalMarketData;
  source: "live" | "fallback";
  lastUpdated: string;
}

export async function GET(): Promise<NextResponse<MarketResponse>> {
  try {
    // Attempt to fetch live data from CoinGecko
    const [coinsRes, globalRes] = await Promise.all([
      fetch(
        `${COINGECKO_API}/coins/markets?vs_currency=usd&ids=${COIN_IDS.join(",")}&order=market_cap_desc&sparkline=false`,
        {
          next: { revalidate: 60 },
          headers: { Accept: "application/json" },
        },
      ),
      fetch(`${COINGECKO_API}/global`, {
        next: { revalidate: 60 },
        headers: { Accept: "application/json" },
      }),
    ]);

    if (!coinsRes.ok || !globalRes.ok) {
      throw new Error("API response not ok");
    }

    const coinsData = await coinsRes.json();
    const globalData = await globalRes.json();

    return NextResponse.json({
      coins: coinsData,
      global: globalData.data,
      source: "live",
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : typeof error === "object" && error !== null
            ? JSON.stringify(error, null, 2)
            : String(error);
    console.error("Market API error, using fallback:", errorMsg);
    // Return mock data as fallback
    return NextResponse.json({
      coins: mockCoins,
      global: mockGlobalData,
      source: "fallback",
      lastUpdated: new Date().toISOString(),
      error: errorMsg,
    });
  }
}
