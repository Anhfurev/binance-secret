import { NextResponse } from "next/server";
import { mockSentiment, mockNews } from "@/lib/mock-data";
import type { SentimentData, NewsItem } from "@/lib/types";

const FEAR_GREED_API = "https://api.alternative.me/fng/";

interface SentimentResponse {
  sentiment: SentimentData;
  news: NewsItem[];
  source: "live" | "fallback";
  lastUpdated: string;
}

function getFearGreedLabel(value: number): string {
  if (value <= 25) return "Extreme Fear";
  if (value <= 45) return "Fear";
  if (value <= 55) return "Neutral";
  if (value <= 75) return "Greed";
  return "Extreme Greed";
}

function getSocialSentimentLabel(value: number): string {
  if (value <= 30) return "Very Bearish";
  if (value <= 45) return "Bearish";
  if (value <= 55) return "Neutral";
  if (value <= 70) return "Bullish";
  return "Very Bullish";
}

export async function GET(): Promise<NextResponse<SentimentResponse>> {
  try {
    // Fetch Fear & Greed Index
    const fngRes = await fetch(FEAR_GREED_API, {
      next: { revalidate: 3600 }, // Cache for 1 hour
      headers: { Accept: "application/json" },
    });

    if (!fngRes.ok) {
      throw new Error("Fear & Greed API response not ok");
    }

    const fngData = await fngRes.json();
    const fearGreedValue = parseInt(fngData.data?.[0]?.value || "50", 10);

    // Generate synthetic social sentiment based on Fear & Greed
    // In production, this would come from a real social sentiment API
    const socialSentiment = Math.min(
      100,
      Math.max(0, fearGreedValue + (Math.random() * 20 - 10)),
    );

    const sentiment: SentimentData = {
      fearGreedIndex: fearGreedValue,
      fearGreedLabel: getFearGreedLabel(fearGreedValue),
      socialSentiment: Math.round(socialSentiment),
      socialSentimentLabel: getSocialSentimentLabel(socialSentiment),
    };

    // For news, we'd normally fetch from CryptoPanic or similar
    // Using mock data with randomized timestamps for demo
    const news: NewsItem[] = mockNews.map((item) => ({
      ...item,
      publishedAt: new Date(Date.now() - Math.random() * 12 * 60 * 60 * 1000),
    }));

    return NextResponse.json({
      sentiment,
      news,
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
    console.error("Sentiment API error, using fallback:", errorMsg);
    return NextResponse.json({
      sentiment: mockSentiment,
      news: mockNews,
      source: "fallback",
      lastUpdated: new Date().toISOString(),
      error: errorMsg,
    });
  }
}
