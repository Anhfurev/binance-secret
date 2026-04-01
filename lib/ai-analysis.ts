import type {
  AITradeSignal,
  CoinData,
  GrowthCandidate,
  PricePrediction,
  SentimentData,
  WhaleTransaction,
} from "@/lib/types";

export type MarketBias = "bullish" | "neutral" | "bearish";
export type RiskLevel = "low" | "medium" | "high";

export interface AiActionItem {
  id: string;
  severity: "info" | "warning" | "critical";
  title: string;
  titleMn: string;
  detail: string;
  detailMn: string;
}

export interface DashboardAiAnalysis {
  bias: MarketBias;
  confidence: number;
  riskLevel: RiskLevel;
  summary: string;
  summaryMn: string;
  actions: AiActionItem[];
}

export interface DailyMarketSummary {
  generatedAt: Date;
  overall: string;
  overallMn: string;
  btcLine: string;
  btcLineMn: string;
  ethLine: string;
  ethLineMn: string;
  whaleLine: string;
  whaleLineMn: string;
  volatilityLine: string;
  volatilityLineMn: string;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getBiasScore(
  sentiment: SentimentData,
  candidates: GrowthCandidate[],
  coins: CoinData[],
) {
  const sentimentScore =
    (sentiment.fearGreedIndex - 50) * 0.5 +
    (sentiment.socialSentiment - 50) * 0.3;

  const avgGrowthScore =
    candidates.length > 0
      ? candidates.reduce((total, item) => total + item.growthScore, 0) /
        candidates.length
      : 50;
  const growthScore = (avgGrowthScore - 50) * 0.8;

  const avgChange24h =
    coins.length > 0
      ? coins.reduce(
          (total, coin) => total + (coin.price_change_percentage_24h || 0),
          0,
        ) / coins.length
      : 0;
  const momentumScore = avgChange24h * 1.5;

  return sentimentScore + growthScore + momentumScore;
}

function getRiskLevel(
  coins: CoinData[],
  candidates: GrowthCandidate[],
): RiskLevel {
  const avgSwing =
    coins.length > 0
      ? coins.reduce((total, coin) => {
          const swing =
            coin.low_24h > 0
              ? ((coin.high_24h - coin.low_24h) / coin.low_24h) * 100
              : 0;
          return total + swing;
        }, 0) / coins.length
      : 0;

  const highRiskCount = candidates.filter(
    (item) => item.riskTag === "High",
  ).length;
  const highRiskRatio =
    candidates.length > 0 ? highRiskCount / candidates.length : 0;

  const riskScore = avgSwing * 0.7 + highRiskRatio * 40;
  if (riskScore >= 18) return "high";
  if (riskScore >= 10) return "medium";
  return "low";
}

function buildActions(
  bias: MarketBias,
  riskLevel: RiskLevel,
  sentiment: SentimentData,
  topCandidate: GrowthCandidate | undefined,
): AiActionItem[] {
  const actions: AiActionItem[] = [];

  if (bias === "bullish") {
    actions.push({
      id: "trend",
      severity: "info",
      title: "Trend is supportive",
      titleMn: "Тренд дэмжиж байна",
      detail:
        "Momentum and sentiment are aligned. Scale in using small entries instead of one large order.",
      detailMn:
        "Momentum болон sentiment нийлж байна. Нэг том оролтоос илүү шаталсан жижиг оролт хий.",
    });
  }

  if (bias === "bearish") {
    actions.push({
      id: "defense",
      severity: "critical",
      title: "Protect capital first",
      titleMn: "Эхлээд капиталаа хамгаал",
      detail:
        "Market conditions are weak. Keep cash reserve higher and prioritize stop-loss discipline.",
      detailMn:
        "Зах сул байна. Бэлэн мөнгөний нөөцөө өсгөж, stop-loss дүрмээ чанд мөрд.",
    });
  }

  if (riskLevel !== "low") {
    actions.push({
      id: "risk",
      severity: "warning",
      title: "Volatility is elevated",
      titleMn: "Савлагаа өндөр байна",
      detail:
        "Reduce position size and avoid over-leverage while intraday swings stay large.",
      detailMn:
        "Өдрийн савлагаа өндөр үед position size-ээ багасгаж, хэт leverage бүү хэрэглэ.",
    });
  }

  if (topCandidate) {
    actions.push({
      id: "candidate",
      severity: "info",
      title: `Watch ${topCandidate.symbol} setup`,
      titleMn: `${topCandidate.symbol} setup-г ажигла`,
      detail: `Top score ${topCandidate.growthScore}/100 with ${topCandidate.confidence}% confidence. Use staged entries and respect invalidation levels.`,
      detailMn: `${topCandidate.growthScore}/100 оноо, ${topCandidate.confidence}% итгэлцэлтэй. Шаталсан оролт хийж invalidation түвшнээ мөрд.`,
    });
  }

  if (sentiment.fearGreedIndex <= 30) {
    actions.push({
      id: "fear",
      severity: "warning",
      title: "Extreme fear context",
      titleMn: "Хэт айдсын орчин",
      detail:
        "Short-term panic can create opportunities, but only with strict risk and longer time horizon.",
      detailMn:
        "Богино хугацааны сандрал боломж үүсгэж болно, гэхдээ зөвхөн хатуу эрсдэлийн дүрэмтэй ажилла.",
    });
  }

  if (actions.length === 0) {
    actions.push({
      id: "neutral",
      severity: "info",
      title: "No strong edge detected",
      titleMn: "Тод давуу тал харагдахгүй байна",
      detail: "Wait for clearer trend confirmation before increasing exposure.",
      detailMn: "Exposure нэмэхээс өмнө илүү тод трендийн баталгаажилт хүлээ.",
    });
  }

  return actions.slice(0, 3);
}

export function buildDashboardAiAnalysis(
  coins: CoinData[],
  candidates: GrowthCandidate[],
  sentiment: SentimentData,
): DashboardAiAnalysis {
  const biasScore = getBiasScore(sentiment, candidates, coins);
  const bias: MarketBias =
    biasScore >= 12 ? "bullish" : biasScore <= -12 ? "bearish" : "neutral";
  const riskLevel = getRiskLevel(coins, candidates);

  const confidenceBase = 55 + Math.min(25, Math.abs(biasScore));
  const confidencePenalty =
    riskLevel === "high" ? 18 : riskLevel === "medium" ? 8 : 0;
  const confidence = Math.round(
    clamp(confidenceBase - confidencePenalty, 35, 95),
  );

  const topCandidate = candidates[0];
  const summary =
    bias === "bullish"
      ? `Bias is bullish with ${confidence}% confidence. Data supports selective long exposure.`
      : bias === "bearish"
        ? `Bias is bearish with ${confidence}% confidence. Defensive positioning is preferred.`
        : `Bias is neutral with ${confidence}% confidence. Wait for stronger confirmation before aggressive trades.`;

  const summaryMn =
    bias === "bullish"
      ? `Өсөх төлөв ${confidence}% итгэлцэлтэй байна. Сонгомол long байрлал нээх боломжтой.`
      : bias === "bearish"
        ? `Буурах төлөв ${confidence}% итгэлцэлтэй байна. Хамгаалалтын байрлал илүү зөв.`
        : `Төвийг сахисан төлөв ${confidence}% итгэлцэлтэй байна. Илүү тод баталгаажилт хүртэл агрессив арилжаа бүү хий.`;

  return {
    bias,
    confidence,
    riskLevel,
    summary,
    summaryMn,
    actions: buildActions(bias, riskLevel, sentiment, topCandidate),
  };
}

function getPredictionDirection(
  predictions: PricePrediction[],
  coinSymbol: string,
): "up" | "down" | "sideways" | "unknown" {
  const match = predictions.find(
    (item) => item.symbol.toLowerCase() === coinSymbol.toLowerCase(),
  );
  const pred24h = match?.predictions.find((pred) => pred.timeframe === "24h");
  return pred24h?.direction ?? "unknown";
}

function summarizeCoinLine(params: {
  coin?: CoinData;
  signal?: AITradeSignal;
  predictionDirection: "up" | "down" | "sideways" | "unknown";
  symbol: "BTC" | "ETH";
}) {
  const { coin, signal, predictionDirection, symbol } = params;
  const change = coin?.price_change_percentage_24h ?? 0;
  const signalType = signal?.signalType ?? "HOLD";
  const isBullishSignal = signalType.includes("BUY");
  const isBearishSignal = signalType.includes("SELL");

  if ((isBullishSignal && predictionDirection === "up") || change >= 2.5) {
    return {
      en: `${symbol}: Bullish momentum building`,
      mn: `${symbol}: Өсөх моментум нэмэгдэж байна`,
    };
  }

  if ((isBearishSignal && predictionDirection === "down") || change <= -2.5) {
    return {
      en: `${symbol}: Bearish pressure increasing`,
      mn: `${symbol}: Буурах дарамт нэмэгдэж байна`,
    };
  }

  return {
    en: `${symbol}: Consolidating`,
    mn: `${symbol}: Нэгтгэж байна`,
  };
}

function summarizeWhaleLine(whales: WhaleTransaction[]) {
  const recent = whales
    .filter(
      (item) => Date.now() - item.timestamp.getTime() <= 24 * 60 * 60 * 1000,
    )
    .sort((left, right) => right.valueUsd - left.valueUsd);
  const largest = recent[0];

  if (!largest) {
    return {
      en: "No major whale transaction detected today",
      mn: "Өнөөдөр том whale гүйлгээ илрээгүй",
    };
  }

  if (largest.type === "exchange_inflow") {
    return {
      en: `Large whale inflow detected (${largest.symbol})`,
      mn: `Том whale inflow илэрлээ (${largest.symbol})`,
    };
  }

  if (largest.type === "exchange_outflow") {
    return {
      en: `Large whale outflow detected (${largest.symbol})`,
      mn: `Том whale outflow илэрлээ (${largest.symbol})`,
    };
  }

  return {
    en: `Large whale transfer detected (${largest.symbol})`,
    mn: `Том whale шилжүүлэг илэрлээ (${largest.symbol})`,
  };
}

function summarizeVolatilityLine(coins: CoinData[]) {
  const avgSwing =
    coins.length > 0
      ? coins.reduce((sum, coin) => {
          const swing =
            coin.low_24h > 0
              ? ((coin.high_24h - coin.low_24h) / coin.low_24h) * 100
              : 0;
          return sum + swing;
        }, 0) / coins.length
      : 0;

  if (avgSwing >= 8) {
    return {
      en: "Volatility increasing",
      mn: "Савлагаа өсөж байна",
    };
  }

  if (avgSwing >= 4.5) {
    return {
      en: "Volatility elevated",
      mn: "Савлагаа өндөр түвшинд байна",
    };
  }

  return {
    en: "Volatility stable",
    mn: "Савлагаа тогтвортой",
  };
}

export function buildDailyMarketSummary(params: {
  coins: CoinData[];
  signals: AITradeSignal[];
  predictions: PricePrediction[];
  whales: WhaleTransaction[];
}): DailyMarketSummary {
  const { coins, signals, predictions, whales } = params;

  const btcCoin = coins.find((coin) => coin.symbol.toLowerCase() === "btc");
  const ethCoin = coins.find((coin) => coin.symbol.toLowerCase() === "eth");

  const btcSignal = signals.find(
    (signal) =>
      signal.symbol.toLowerCase() === "btc" || signal.coinId === "bitcoin",
  );
  const ethSignal = signals.find(
    (signal) =>
      signal.symbol.toLowerCase() === "eth" || signal.coinId === "ethereum",
  );

  const btcLine = summarizeCoinLine({
    coin: btcCoin,
    signal: btcSignal,
    predictionDirection: getPredictionDirection(predictions, "BTC"),
    symbol: "BTC",
  });
  const ethLine = summarizeCoinLine({
    coin: ethCoin,
    signal: ethSignal,
    predictionDirection: getPredictionDirection(predictions, "ETH"),
    symbol: "ETH",
  });
  const whaleLine = summarizeWhaleLine(whales);
  const volatilityLine = summarizeVolatilityLine(coins);

  return {
    generatedAt: new Date(),
    overall:
      "Daily market overview generated from AI signals, predictions, and whale flow.",
    overallMn:
      "AI дохио, таамаглал, whale урсгалд суурилсан өдрийн захын тойм үүсгэлээ.",
    btcLine: btcLine.en,
    btcLineMn: btcLine.mn,
    ethLine: ethLine.en,
    ethLineMn: ethLine.mn,
    whaleLine: whaleLine.en,
    whaleLineMn: whaleLine.mn,
    volatilityLine: volatilityLine.en,
    volatilityLineMn: volatilityLine.mn,
  };
}
