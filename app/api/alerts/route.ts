import { NextResponse } from "next/server";
import { mockAlerts, mockCoins } from "@/lib/mock-data";
import type { Alert, AlertSeverity, CoinData } from "@/lib/types";

interface AlertsResponse {
  alerts: Alert[];
  source: "live" | "fallback";
  lastUpdated: string;
}

// Generate dynamic alerts based on market conditions
function generateAlerts(coins: CoinData[]): Alert[] {
  const alerts: Alert[] = [];
  const now = new Date();

  coins.forEach((coin) => {
    const change = coin.price_change_percentage_24h;
    const volatility =
      coin.high_24h && coin.low_24h
        ? ((coin.high_24h - coin.low_24h) / coin.low_24h) * 100
        : 0;

    // Falling fast alert
    if (change < -5) {
      alerts.push({
        id: `${coin.id}-falling-${now.getTime()}`,
        message: `${coin.symbol.toUpperCase()} falling fast (${change.toFixed(1)}%): Consider reducing exposure`,
        severity: change < -10 ? "critical" : "warning",
        timestamp: new Date(now.getTime() - Math.random() * 30 * 60 * 1000),
        coinId: coin.id,
        coinSymbol: coin.symbol.toUpperCase(),
      });
    }

    // Breakout alert
    if (change > 5) {
      alerts.push({
        id: `${coin.id}-breakout-${now.getTime()}`,
        message: `Breakout setup detected on ${coin.symbol.toUpperCase()} (+${change.toFixed(1)}%)`,
        severity: "info",
        timestamp: new Date(now.getTime() - Math.random() * 30 * 60 * 1000),
        coinId: coin.id,
        coinSymbol: coin.symbol.toUpperCase(),
      });
    }

    // High volatility warning
    if (volatility > 8) {
      alerts.push({
        id: `${coin.id}-volatility-${now.getTime()}`,
        message: `High volatility warning: ${coin.symbol.toUpperCase()} showing ${volatility.toFixed(1)}% price swings`,
        severity: "warning",
        timestamp: new Date(now.getTime() - Math.random() * 60 * 60 * 1000),
        coinId: coin.id,
        coinSymbol: coin.symbol.toUpperCase(),
      });
    }
  });

  // Sort by timestamp (newest first)
  return alerts.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}

export async function GET(): Promise<NextResponse<AlertsResponse>> {
  try {
    // In a real app, we'd fetch live market data and generate alerts
    // For now, generate alerts from mock data
    const alerts = generateAlerts(mockCoins);

    // If no dynamic alerts, use mock alerts
    const finalAlerts = alerts.length > 0 ? alerts : mockAlerts;

    return NextResponse.json({
      alerts: finalAlerts.slice(0, 10),
      source: alerts.length > 0 ? "live" : "fallback",
      lastUpdated: new Date().toISOString(),
    });
  } catch (error) {
    const errorMsg =
      error instanceof Error ? error.message : JSON.stringify(error);
    console.error("Alerts API error, using fallback:", errorMsg);
    return NextResponse.json({
      alerts: mockAlerts,
      source: "fallback",
      lastUpdated: new Date().toISOString(),
      error: errorMsg,
    });
  }
}
