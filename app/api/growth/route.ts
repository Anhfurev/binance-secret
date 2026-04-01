import { NextResponse } from "next/server";
import {
  mockCoins,
  mockGrowthCandidates,
  mockGlobalData,
} from "@/lib/mock-data";
import { rankGrowthCandidates } from "@/lib/scoring";
import type { GrowthCandidate, CoinData } from "@/lib/types";

const COINGECKO_API = "https://api.coingecko.com/api/v3";
const COIN_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "ripple",
  "binancecoin",
  "dogecoin",
  "cardano",
  "polkadot",
  "avalanche-2",
  "chainlink",
];

// Store previous ranks in memory (in production, use a database or cache)
const previousRanks = new Map<string, number>();

interface GrowthResponse {
  candidates: GrowthCandidate[];
  source: "live" | "fallback";
  lastUpdated: string;
  signalsChanged: boolean;
}

export async function GET(): Promise<NextResponse<GrowthResponse>> {
  try {
    // Attempt to fetch live data
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

    const coinsData: CoinData[] = await coinsRes.json();
    const globalData = await globalRes.json();

    const globalVolume = globalData.data?.total_volume?.usd || 100000000000;

    // Calculate growth candidates
    const candidates = rankGrowthCandidates(
      coinsData,
      globalVolume,
      previousRanks,
      5,
    );

    // Check if signals changed
    let signalsChanged = false;
    candidates.forEach((candidate, index) => {
      const prevRank = previousRanks.get(candidate.id);
      if (prevRank !== undefined && prevRank !== index + 1) {
        signalsChanged = true;
      }
      previousRanks.set(candidate.id, index + 1);
    });

    return NextResponse.json({
      candidates,
      source: "live",
      lastUpdated: new Date().toISOString(),
      signalsChanged,
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
    console.error("Growth API error, using fallback:", errorMsg);
    return NextResponse.json({
      candidates: mockGrowthCandidates,
      source: "fallback",
      lastUpdated: new Date().toISOString(),
      signalsChanged: false,
      error: errorMsg,
    });
  }
}
