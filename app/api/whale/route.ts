import { NextResponse } from "next/server";

interface ExchangeFlowAnalysis {
  classification:
    | "strong_accumulation"
    | "accumulation"
    | "distribution"
    | "strong_distribution"
    | "neutral_flow";
  netDirectionLabel: string;
  contextNote: string;
}

interface AccumulationPattern {
  patternType:
    | "accumulation"
    | "distribution"
    | "otc_deal"
    | "internal_move"
    | "dormant_reactivation";
  confidence: number;
  description: string;
}

interface MarketImpactEstimate {
  timeframe: "immediate" | "1-24h" | "1-7d";
  priceEffect:
    | "strong_bullish"
    | "bullish"
    | "neutral"
    | "bearish"
    | "strong_bearish";
  magnitude: "high" | "medium" | "low";
  note: string;
}

interface WhaleData {
  id: string;
  coinId: string;
  symbol: string;
  assetName: string;
  assetType: "coin" | "token";
  type: "transfer" | "exchange_inflow" | "exchange_outflow";
  amount: number;
  valueUsd: number;
  from: string;
  to: string;
  fromAddress: string;
  toAddress: string;
  timestamp: string; // ISO string for JSON transport
  impact: "bullish" | "bearish" | "neutral";
  aiAnalysis: string;
  exchangeFlowAnalysis: ExchangeFlowAnalysis;
  accumulationPattern: AccumulationPattern;
  marketImpactEstimate: MarketImpactEstimate;
}

const exchanges = [
  "Binance",
  "Coinbase",
  "Kraken",
  "OKX",
  "Bitfinex",
  "Bybit",
  "Gemini",
  "KuCoin",
];
const wallets = [
  "Unknown Wallet",
  "Institutional Wallet",
  "Cold Storage",
  "Galaxy Digital",
  "Jump Trading",
  "Wintermute",
  "Alameda Research",
  "Grayscale",
];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

function makeWalletAddress(symbol: string, rand: () => number) {
  const alphabet = "abcdef0123456789";
  const prefix =
    symbol === "BTC"
      ? "bc1q"
      : symbol === "ETH"
        ? "0x"
        : `${symbol.toLowerCase()}1`;
  const length = prefix === "0x" ? 40 : 28;
  let body = "";
  for (let i = 0; i < length; i++) {
    body += alphabet[Math.floor(rand() * alphabet.length)];
  }
  return `${prefix}${body}`;
}

function generateWhaleTransactions(
  prices: Record<string, number>,
): WhaleData[] {
  const now = Date.now();
  // Seed based on the hour so data changes every hour
  const hourSeed = Math.floor(now / (1000 * 60 * 60));
  const rand = seededRandom(hourSeed);

  const coins = [
    {
      id: "bitcoin",
      symbol: "BTC",
      name: "Bitcoin",
      assetType: "coin" as const,
      minAmount: 100,
      maxAmount: 5000,
    },
    {
      id: "ethereum",
      symbol: "ETH",
      name: "Ethereum",
      assetType: "coin" as const,
      minAmount: 1000,
      maxAmount: 30000,
    },
    {
      id: "solana",
      symbol: "SOL",
      name: "Solana",
      assetType: "coin" as const,
      minAmount: 50000,
      maxAmount: 800000,
    },
    {
      id: "dogecoin",
      symbol: "DOGE",
      name: "Dogecoin",
      assetType: "coin" as const,
      minAmount: 10000000,
      maxAmount: 500000000,
    },
    {
      id: "ripple",
      symbol: "XRP",
      name: "XRP",
      assetType: "token" as const,
      minAmount: 5000000,
      maxAmount: 100000000,
    },
    {
      id: "cardano",
      symbol: "ADA",
      name: "Cardano",
      assetType: "coin" as const,
      minAmount: 5000000,
      maxAmount: 50000000,
    },
  ];

  const txCount = 8 + Math.floor(rand() * 5); // 8-12 transactions
  const transactions: WhaleData[] = [];

  for (let i = 0; i < txCount; i++) {
    const coin = coins[Math.floor(rand() * coins.length)];
    const price = prices[coin.id] ?? 1;
    const amount = Math.round(
      coin.minAmount + rand() * (coin.maxAmount - coin.minAmount),
    );
    const valueUsd = amount * price;

    // Skip small transactions
    if (valueUsd < 1000000) continue;

    const typeRoll = rand();
    const type: WhaleData["type"] =
      typeRoll < 0.35
        ? "exchange_outflow"
        : typeRoll < 0.7
          ? "exchange_inflow"
          : "transfer";

    const exchange = exchanges[Math.floor(rand() * exchanges.length)];
    const wallet = wallets[Math.floor(rand() * wallets.length)];

    let from: string;
    let to: string;
    let fromAddress: string;
    let toAddress: string;
    let impact: WhaleData["impact"];
    let aiAnalysis: string;
    let exchangeFlowAnalysis: ExchangeFlowAnalysis;
    let accumulationPattern: AccumulationPattern;
    let marketImpactEstimate: MarketImpactEstimate;

    if (type === "exchange_outflow") {
      from = exchange;
      to = wallet;
      fromAddress = `${exchange.toLowerCase()}-hot-wallet`;
      toAddress = makeWalletAddress(coin.symbol, rand);
      impact = "bullish";
      aiAnalysis = `Large ${coin.symbol} withdrawal from ${exchange} (${amount.toLocaleString()} ${coin.symbol} ≈ $${(valueUsd / 1e6).toFixed(1)}M). Exchange outflows indicate accumulation — coins moving to cold storage. Historically bullish signal.`;

      const isLarge = valueUsd >= 100_000_000;
      exchangeFlowAnalysis = {
        classification: isLarge ? "strong_accumulation" : "accumulation",
        netDirectionLabel: `${exchange} → Cold Storage`,
        contextNote: isLarge
          ? "Massive supply removal — coins no longer available for immediate sale on this exchange"
          : "Supply reduction signal — coins removed from immediate sell availability",
      };
      accumulationPattern = {
        patternType: "accumulation",
        confidence: Math.round(65 + Math.min(30, (valueUsd / 1e9) * 100)),
        description: `${coin.symbol} withdrawn from ${exchange} to private custody. Consistent with institutional DCA or strategic cold-storage stacking.`,
      };
      marketImpactEstimate = {
        timeframe: "1-24h",
        priceEffect: isLarge ? "strong_bullish" : "bullish",
        magnitude: isLarge ? "high" : "medium",
        note: `Exchange-available ${coin.symbol} supply compressing. ${isLarge ? "Consecutive large outflows historically precede 5–10% price rallies." : "Moderate supply tightening — watch for upside follow-through."}`,
      };
    } else if (type === "exchange_inflow") {
      from = wallet;
      to = exchange;
      fromAddress = makeWalletAddress(coin.symbol, rand);
      toAddress = `${exchange.toLowerCase()}-deposit-wallet`;
      impact = "bearish";
      aiAnalysis = `Significant ${coin.symbol} deposit to ${exchange} (${amount.toLocaleString()} ${coin.symbol} ≈ $${(valueUsd / 1e6).toFixed(1)}M). Exchange inflows may signal upcoming sell pressure. Monitor order books for large limit sells.`;

      const isLarge = valueUsd >= 80_000_000;
      exchangeFlowAnalysis = {
        classification: isLarge ? "strong_distribution" : "distribution",
        netDirectionLabel: `Wallet → ${exchange}`,
        contextNote: isLarge
          ? "High-volume coins repositioned to exchange — elevated probability of imminent sell-off"
          : "Coins entering exchange sell queue — distribution signal detected",
      };
      accumulationPattern = {
        patternType: "distribution",
        confidence: Math.round(62 + Math.min(28, (valueUsd / 1e9) * 90)),
        description: `${coin.symbol} moving from private wallet to ${exchange} trading account. Pattern suggests preparation for market-order or limit-sell distribution.`,
      };
      marketImpactEstimate = {
        timeframe: isLarge ? "immediate" : "1-24h",
        priceEffect: isLarge ? "strong_bearish" : "bearish",
        magnitude: isLarge ? "high" : "medium",
        note: `$${(valueUsd / 1e6).toFixed(0)}M potential sell pressure on ${exchange}. ${isLarge ? "Significant enough to move the market if sold at market price." : "Watch for large limit orders forming in the order book."}`,
      };
    } else {
      from = wallet;
      to = wallets[Math.floor(rand() * wallets.length)];
      if (to === from) to = "Unknown Wallet";
      fromAddress = makeWalletAddress(coin.symbol, rand);
      toAddress = makeWalletAddress(coin.symbol, rand);
      impact = "neutral";
      aiAnalysis = `Wallet-to-wallet transfer of ${amount.toLocaleString()} ${coin.symbol} ($${(valueUsd / 1e6).toFixed(1)}M). Likely OTC deal or internal reorganization. Minimal direct market impact expected.`;

      const isKnownEntity =
        from !== "Unknown Wallet" && to !== "Unknown Wallet";
      exchangeFlowAnalysis = {
        classification: "neutral_flow",
        netDirectionLabel: `${from} → ${to}`,
        contextNote: isKnownEntity
          ? "Transfer between two known entities — likely OTC settlement or fund rebalancing"
          : "Large off-exchange transfer — on-chain movement without immediate sell intent",
      };
      accumulationPattern = {
        patternType: isKnownEntity ? "otc_deal" : "internal_move",
        confidence: Math.round(55 + Math.min(25, (valueUsd / 1e9) * 70)),
        description: isKnownEntity
          ? `${from} → ${to}: institutional-grade transfer consistent with OTC block trade or fund settlement.`
          : `Large on-chain movement between private wallets. Could be internal portfolio reorganization or cold-storage rotation.`,
      };
      marketImpactEstimate = {
        timeframe: "1-7d",
        priceEffect: "neutral",
        magnitude: "low",
        note: `Off-exchange transfer does not directly affect visible order flow. ${isKnownEntity ? "Recipient entity may gradually deploy assets over days." : "Monitor destination wallet for future exchange deposits."}`,
      };
    }

    // Override some to be neutral if very small relative to market cap
    if (valueUsd < 5000000) impact = "neutral";

    const minutesAgo = Math.floor(rand() * 360); // up to 6 hours ago
    transactions.push({
      id: `whale-${hourSeed}-${i}`,
      coinId: coin.id,
      symbol: coin.symbol,
      assetName: coin.name,
      assetType: coin.assetType,
      type,
      amount,
      valueUsd,
      from,
      to,
      fromAddress,
      toAddress,
      timestamp: new Date(now - minutesAgo * 60 * 1000).toISOString(),
      impact,
      aiAnalysis,
      exchangeFlowAnalysis,
      accumulationPattern,
      marketImpactEstimate,
    });
  }

  // Sort by timestamp (most recent first)
  transactions.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return transactions;
}

export async function GET() {
  try {
    // Fetch real prices from CoinGecko
    const ids = "bitcoin,ethereum,solana,dogecoin,ripple,cardano";
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { next: { revalidate: 300 } },
    );

    let prices: Record<string, number> = {
      bitcoin: 97000,
      ethereum: 3800,
      solana: 198,
      dogecoin: 0.38,
      ripple: 2.2,
      cardano: 0.95,
    };

    if (res.ok) {
      const data = await res.json();
      for (const [id, val] of Object.entries(data)) {
        if (
          val &&
          typeof val === "object" &&
          "usd" in (val as Record<string, unknown>)
        ) {
          prices[id] = (val as { usd: number }).usd;
        }
      }
    }

    const transactions = generateWhaleTransactions(prices);

    return NextResponse.json({
      transactions,
      generatedAt: new Date().toISOString(),
    });
  } catch {
    // Fallback with default prices
    const fallbackPrices: Record<string, number> = {
      bitcoin: 97000,
      ethereum: 3800,
      solana: 198,
      dogecoin: 0.38,
      ripple: 2.2,
      cardano: 0.95,
    };
    const transactions = generateWhaleTransactions(fallbackPrices);
    return NextResponse.json({
      transactions,
      generatedAt: new Date().toISOString(),
    });
  }
}
