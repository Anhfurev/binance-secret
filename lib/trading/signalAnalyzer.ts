import type {
  AITradeSignal,
  CoinData,
  ScalpingDirection,
  ScalpingMarketSnapshot,
  ScalpingSettings,
  ScalpingTechnicalConfirmation,
} from "@/lib/types";

export interface SignalAnalysisResult {
  direction: ScalpingDirection | null;
  signal: AITradeSignal;
  market: ScalpingMarketSnapshot;
  confirmations: ScalpingTechnicalConfirmation[];
  confirmationCount: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getDirection(signal: AITradeSignal): ScalpingDirection | null {
  if (signal.signalType.includes("BUY")) return "long";
  if (signal.signalType.includes("SELL")) return "short";
  return null;
}

function getVolatilityPct(signal: AITradeSignal, coin?: CoinData) {
  if (coin && coin.current_price > 0 && coin.high_24h > 0 && coin.low_24h > 0) {
    return ((coin.high_24h - coin.low_24h) / coin.current_price) * 100 * 0.18;
  }

  if (signal.volatilityLevel === "low") return 0.16;
  if (signal.volatilityLevel === "medium") return 0.48;
  return 1.1;
}

function getVolatilitySpikePct(signal: AITradeSignal, coin?: CoinData) {
  const changePct = Math.abs(coin?.price_change_percentage_24h ?? 0);
  const signalBias =
    signal.volatilityLevel === "high"
      ? 0.7
      : signal.volatilityLevel === "medium"
        ? 0.35
        : 0.15;
  return clamp(changePct * 0.22 + signalBias, 0.05, 4.5);
}

function getLiquidityUsd(signal: AITradeSignal, coin?: CoinData) {
  const baseVolume = coin?.total_volume ?? signal.currentPrice * 25_000;
  const technicalBoost =
    signal.technicalIndicators.volume === "high"
      ? 1.2
      : signal.technicalIndicators.volume === "normal"
        ? 1
        : 0.75;
  return baseVolume * technicalBoost;
}

function getSpreadPct(
  signal: AITradeSignal,
  coin: CoinData | undefined,
  volatilityPct: number,
) {
  const volumeRatio = coin
    ? coin.total_volume / Math.max(coin.market_cap, 1)
    : 0.04;
  const confidenceTightener = signal.confidence >= 80 ? 0.008 : 0.014;
  const spread =
    confidenceTightener + volatilityPct * 0.035 - volumeRatio * 0.12;
  return clamp(spread, 0.01, 0.18);
}

function getOrderBookDepthUsd(
  liquidityUsd: number,
  signal: AITradeSignal,
  coin?: CoinData,
) {
  const depthFactor =
    coin && coin.market_cap_rank <= 10
      ? 0.28
      : coin && coin.market_cap_rank <= 50
        ? 0.2
        : 0.12;
  const confidenceFactor = 0.8 + signal.confidence / 250;
  return liquidityUsd * depthFactor * confidenceFactor;
}

function getExpectedProfitPct(signal: AITradeSignal) {
  const firstTarget = signal.takeProfits[0]?.price ?? signal.entryPrice;
  return Math.abs(
    ((firstTarget - signal.entryPrice) / signal.entryPrice) * 100,
  );
}

function getTotalFeePct(settings: ScalpingSettings) {
  return settings.takerFeePct * 2;
}

function getEstimatedSlippagePct(
  orderBookDepthUsd: number,
  liquidityUsd: number,
  signal: AITradeSignal,
) {
  const orderImpact =
    orderBookDepthUsd <= 0 ? 1 : liquidityUsd / orderBookDepthUsd;
  const volatilityPenalty =
    signal.volatilityLevel === "high"
      ? 0.03
      : signal.volatilityLevel === "medium"
        ? 0.015
        : 0.005;
  return clamp(orderImpact * 0.002 + volatilityPenalty, 0.01, 0.2);
}

function buildConfirmations(
  signal: AITradeSignal,
  direction: ScalpingDirection | null,
): ScalpingTechnicalConfirmation[] {
  if (!direction) {
    return [
      {
        key: "rsi",
        label: "RSI",
        agrees: false,
        score: 0,
        detail: "No directional bias from AI signal.",
      },
    ];
  }

  const rsi = signal.technicalIndicators.rsi;
  const macd = signal.technicalIndicators.macd;
  const movingAverages = signal.technicalIndicators.movingAverages;
  const volume = signal.technicalIndicators.volume;

  const rsiAgrees = direction === "long" ? rsi <= 38 : rsi >= 62;
  const macdAgrees =
    direction === "long" ? macd === "bullish" : macd === "bearish";
  const maAgrees =
    direction === "long"
      ? movingAverages === "above"
      : movingAverages === "below";
  const volumeAgrees = volume === "high";

  return [
    {
      key: "rsi",
      label: "RSI",
      agrees: rsiAgrees,
      score: rsiAgrees ? 24 : 8,
      detail:
        direction === "long"
          ? `RSI ${rsi} ${rsiAgrees ? "shows pullback support" : "is not in a favorable long reset zone"}.`
          : `RSI ${rsi} ${rsiAgrees ? "confirms overbought exhaustion" : "is not stretched enough for a short fade"}.`,
    },
    {
      key: "macd",
      label: "MACD",
      agrees: macdAgrees,
      score: macdAgrees ? 26 : 6,
      detail: `MACD is ${macd}, ${macdAgrees ? "aligned" : "misaligned"} with the AI direction.`,
    },
    {
      key: "movingAverage",
      label: "Moving Average",
      agrees: maAgrees,
      score: maAgrees ? 24 : 6,
      detail: `Price is ${movingAverages} the fast/slow moving averages.`,
    },
    {
      key: "volumeSpike",
      label: "Volume Spike",
      agrees: volumeAgrees,
      score: volumeAgrees ? 18 : 4,
      detail: `Relative volume is ${volume}.`,
    },
  ];
}

export function analyzeSignal(params: {
  signal: AITradeSignal;
  coin?: CoinData;
  settings: ScalpingSettings;
}): SignalAnalysisResult {
  const { signal, coin, settings } = params;
  const direction = getDirection(signal);
  const volatilityPct = getVolatilityPct(signal, coin);
  const volatilitySpikePct = getVolatilitySpikePct(signal, coin);
  const liquidityUsd = getLiquidityUsd(signal, coin);
  const spreadPct = getSpreadPct(signal, coin, volatilityPct);
  const orderBookDepthUsd = getOrderBookDepthUsd(liquidityUsd, signal, coin);
  const estimatedSlippagePct = getEstimatedSlippagePct(
    orderBookDepthUsd,
    liquidityUsd,
    signal,
  );
  const confirmations = buildConfirmations(signal, direction);
  const confirmationCount = confirmations.filter((item) => item.agrees).length;
  const expectedProfitPct = getExpectedProfitPct(signal);
  const totalFeePct = getTotalFeePct(settings);

  const volumeStrength = clamp(
    (Math.min(liquidityUsd / settings.minLiquidityUsd, 2.5) / 2.5) * 100 +
      confirmations.find((item) => item.key === "volumeSpike")!.score,
    0,
    100,
  );
  const trendStrength = clamp(
    signal.confidence * 0.45 +
      confirmations
        .filter((item) => item.key === "macd" || item.key === "movingAverage")
        .reduce((sum, item) => sum + item.score, 0),
    0,
    100,
  );
  const volatilityScore = clamp(
    volatilityPct < settings.minVolatilityPct
      ? (volatilityPct / settings.minVolatilityPct) * 40
      : volatilitySpikePct > settings.maxVolatilitySpikePct
        ? 28
        : 68 + Math.min(22, volatilityPct * 18),
    0,
    100,
  );

  return {
    direction,
    signal,
    confirmations,
    confirmationCount,
    market: {
      symbol: signal.symbol,
      timeframe: settings.timeframe,
      expectedProfitPct: Number(expectedProfitPct.toFixed(3)),
      totalFeePct: Number(totalFeePct.toFixed(3)),
      spreadPct: Number(spreadPct.toFixed(3)),
      liquidityUsd: Math.round(liquidityUsd),
      volatilityPct: Number(volatilityPct.toFixed(3)),
      volatilitySpikePct: Number(volatilitySpikePct.toFixed(3)),
      orderBookDepthUsd: Math.round(orderBookDepthUsd),
      estimatedSlippagePct: Number(estimatedSlippagePct.toFixed(3)),
      volumeStrength: Number(volumeStrength.toFixed(1)),
      trendStrength: Number(trendStrength.toFixed(1)),
      volatilityScore: Number(volatilityScore.toFixed(1)),
    },
  };
}
