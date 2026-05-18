import { mockCoins } from "@/lib/mock-data";
import type { Scalp1mSnapshot } from "@/lib/trading/paper-scalp-indicators";
import type { CoinData } from "@/lib/types";

function normalizeUsdtSymbol(symbol: string): string {
  const s = symbol.toUpperCase().replace(/\//g, "");
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

function baseFromUsdt(symbol: string): string {
  return normalizeUsdtSymbol(symbol).replace(/USDT$/, "").toLowerCase();
}

function defaultCoinTemplate(base: string): CoinData {
  return {
    id: base,
    symbol: base,
    name: base.toUpperCase(),
    image: "",
    current_price: 0,
    market_cap: 0,
    market_cap_rank: 0,
    price_change_percentage_24h: 0,
    total_volume: 0,
    high_24h: 0,
    low_24h: 0,
    circulating_supply: 0,
  };
}

function findFallbackCoin(
  usdtSymbol: string,
  fallback: CoinData[],
): CoinData | undefined {
  const base = baseFromUsdt(usdtSymbol);
  return fallback.find((c) => c.symbol.toLowerCase() === base);
}

export type PaperScalpMarketSource = "1h-snapshots" | "mock-fallback" | "mixed";

/**
 * Live mark prices from 1h kline closes; mockCoins only when a symbol has no snapshot.
 */
export function buildPaperScalpMarketCoins(
  snapshots: Map<string, Scalp1mSnapshot>,
  options?: {
    fallback?: CoinData[];
    requiredSymbols?: string[];
  },
): { coins: CoinData[]; marketSource: PaperScalpMarketSource } {
  const fallback = options?.fallback ?? mockCoins;
  const required = new Set(
    (options?.requiredSymbols ?? []).map((s) => normalizeUsdtSymbol(s)),
  );
  for (const key of snapshots.keys()) {
    required.add(normalizeUsdtSymbol(key));
  }

  const coins: CoinData[] = [];
  let fromSnapshot = 0;
  let fromFallback = 0;

  for (const sym of required) {
    const snap = snapshots.get(sym);
    const template = findFallbackCoin(sym, fallback) ?? defaultCoinTemplate(baseFromUsdt(sym));

    if (snap && Number.isFinite(snap.close) && snap.close > 0) {
      fromSnapshot += 1;
      coins.push({
        ...template,
        current_price: snap.close,
        high_24h: Math.max(template.high_24h || snap.close, snap.close),
        low_24h:
          template.low_24h > 0
            ? Math.min(template.low_24h, snap.close)
            : snap.close,
      });
      continue;
    }

    if (template.current_price > 0) {
      fromFallback += 1;
      coins.push({ ...template });
      console.warn(
        `[paper-scalp] mark price fallback (no 1h snapshot): ${sym} → mock $${template.current_price}`,
      );
    }
  }

  if (coins.length === 0) {
    return { coins: fallback, marketSource: "mock-fallback" };
  }

  const marketSource: PaperScalpMarketSource =
    fromSnapshot === 0
      ? "mock-fallback"
      : fromFallback === 0
        ? "1h-snapshots"
        : "mixed";

  return { coins, marketSource };
}
