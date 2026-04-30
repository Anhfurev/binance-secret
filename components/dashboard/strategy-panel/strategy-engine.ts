"use client";

import type { AITradeSignal } from "@/lib/types";
import type {
  BuilderConfig,
  MarketRegime,
  RiskBand,
  Strategy,
  StrategySignal,
} from "./types";

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseRiskReward(rr: string) {
  const parts = rr.split(":");
  if (parts.length !== 2) return 1;
  const denominator = Number(parts[1]);
  return Number.isFinite(denominator) ? denominator : 1;
}

function signalMultiplier(signal: StrategySignal) {
  return signal === "wait" ? 0.75 : 1;
}

export function getMarketRegime(fgi: number, btcChange: number): MarketRegime {
  if (btcChange >= 1.5 && fgi >= 55) return "bull";
  if (btcChange <= -1.5 && fgi <= 45) return "bear";
  return "range";
}

export function getMarketVolatility(btcChange: number) {
  const absMove = Math.abs(btcChange);
  if (absMove >= 4) return "high";
  if (absMove >= 1.5) return "medium";
  return "low";
}

export function getRiskBandStyle(riskBand: RiskBand) {
  if (riskBand === "low") return "text-success border-success/30 bg-success/10";
  if (riskBand === "medium") {
    return "text-amber-700 border-amber-300 bg-amber-100/60";
  }
  return "text-destructive border-destructive/30 bg-destructive/10";
}

export function computeStrategies(
  fearGreedIndex: number,
  btcChange: number,
  regime: MarketRegime,
): { strategies: Strategy[]; volatility: string } {
  const fgi = clamp(fearGreedIndex, 0, 100);
  const normalizedBtcChange = btcChange ?? 0;
  const btcDir =
    normalizedBtcChange > 0.6
      ? "up"
      : normalizedBtcChange < -0.6
        ? "down"
        : "flat";
  const volatility = getMarketVolatility(normalizedBtcChange);

  const strategies: Strategy[] = [
    {
      id: "trend-follow",
      name: "Trend Momentum",
      nameMn: "Чиг хандлагын моментум",
      type: "trend",
      signal:
        btcDir === "up" && fgi > 45
          ? "long"
          : btcDir === "down" && fgi < 40
            ? "short"
            : "wait",
      winRate: btcDir !== "flat" ? 68 : 54,
      riskReward: "1:2.5",
      description: `Follow dominant ${btcDir === "up" ? "uptrend" : btcDir === "down" ? "downtrend" : "consolidation"} using EMA crossovers and volume confirmation. Best in directional markets.`,
      descriptionMn: `${btcDir === "up" ? "Өсөх" : btcDir === "down" ? "Буурах" : "Хажуу"} чиг хандлагыг EMA огтлолцол, эзэлхүүний баталгаажуулалтаар дагах. Чиглэлтэй захад тохиромжтой.`,
      pairs: ["BTC/USDT", "ETH/USDT", "SOL/USDT"],
      confidence: btcDir !== "flat" ? 74 : 50,
      riskBand: "medium",
      timeframe: "4h-1d",
      timeframeMn: "4ц-1хон",
      positionSizePct: regime === "range" ? 9 : 12,
      stopLossPct: 2.8,
      rationale: [
        "EMA trend alignment on major pairs",
        "Volume confirms directional continuation",
      ],
      rationaleMn: [
        "Том хосууд дээр EMA тренд давхцаж байна",
        "Эзэлхүүн чиглэлийн үргэлжлэлийг баталж байна",
      ],
      invalidation: "Close if EMA 20/50 cross reverses and volume fades",
      invalidationMn: "EMA 20/50 эсрэг огтлолцож, эзэлхүүн буурвал хаана",
      score: 0,
    },
    {
      id: "mean-revert",
      name: "Mean Reversion",
      nameMn: "Дундаж руу буцах",
      type: "reversal",
      signal: fgi < 25 ? "long" : fgi > 75 ? "short" : "wait",
      winRate: fgi < 30 || fgi > 70 ? 71 : 55,
      riskReward: "1:1.8",
      description: `RSI extremes + Bollinger Band squeeze. Fear/Greed at ${fgi} - ${fgi < 30 ? "oversold, watch for bounce" : fgi > 70 ? "overbought, watch for pullback" : "no extreme, wait for setup"}.`,
      descriptionMn: `RSI хэт + Bollinger Band шахалт. Fear/Greed ${fgi} - ${fgi < 30 ? "хэт борлуулалт, сэргэлт хүлээ" : fgi > 70 ? "хэт худалдан авалт, буурах" : "хэт утга алга, setup хүлээ"}.`,
      pairs: ["BTC/USDT", "ETH/USDT"],
      confidence: fgi < 25 || fgi > 75 ? 72 : 45,
      riskBand: "high",
      timeframe: "1h-6h",
      timeframeMn: "1ц-6ц",
      positionSizePct: 6,
      stopLossPct: 2.2,
      rationale: [
        "Sentiment is stretched at extremes",
        "Volatility mean-reverts after panic/euphoria",
      ],
      rationaleMn: [
        "Sentiment туйлдаа хүрсэн байна",
        "Айдас/хэтрэлтийн дараа хэлбэлзэл дундаж руу буцдаг",
      ],
      invalidation: "Invalidate on strong breakout with rising volume",
      invalidationMn: "Эзэлхүүн өссөн хүчтэй тасалт гарвал хүчингүй",
      score: 0,
    },
    {
      id: "breakout-vol",
      name: "Volume Breakout",
      nameMn: "Эзэлхүүний тасалт",
      type: "breakout",
      signal: btcDir === "flat" ? "wait" : btcDir === "up" ? "long" : "short",
      winRate: 62,
      riskReward: "1:3.0",
      description:
        "Detect range consolidation then enter on volume spike above resistance or below support. High reward but requires patience.",
      descriptionMn:
        "Range нэгтгэлийг илрүүлж, resistance/support-оос эзэлхүүний spike-аар орох. Өндөр шагнал, тэвчээр шаардана.",
      pairs: ["SOL/USDT", "AVAX/USDT", "BTC/USDT"],
      confidence: btcDir === "flat" ? 42 : 63,
      riskBand: "high",
      timeframe: "15m-4h",
      timeframeMn: "15м-4ц",
      positionSizePct: volatility === "high" ? 5 : 8,
      stopLossPct: 3.4,
      rationale: [
        "Compression often leads to expansion",
        "Higher R:R when breakout is confirmed",
      ],
      rationaleMn: [
        "Шахалт дараа нь ихэвчлэн тэлэлт авчирдаг",
        "Тасалт батлагдвал ашиг/эрсдэлийн харьцаа өндөр",
      ],
      invalidation: "Exit if breakout candle fails and re-enters range",
      invalidationMn: "Тасалт буцаад range руу орвол шууд гарна",
      score: 0,
    },
    {
      id: "dca-smart",
      name: "Smart DCA",
      nameMn: "Ухаалаг DCA",
      type: "scalp",
      signal: fgi < 40 ? "long" : "wait",
      winRate: 78,
      riskReward: "1:1.5",
      description: `Dollar-cost average into dips. Current Fear/Greed ${fgi} - ${fgi < 35 ? "ideal DCA zone, accumulate" : fgi < 50 ? "moderate zone, small entries" : "expensive zone, hold off"}.`,
      descriptionMn: `Буурах үед Dollar-cost average хийх. Fear/Greed ${fgi} - ${fgi < 35 ? "тохиромжтой DCA бүс, хуримтлуул" : fgi < 50 ? "дунд бүс, бага оролт" : "үнэтэй бүс, хүлээ"}.`,
      pairs: ["BTC/USDT", "ETH/USDT"],
      confidence: fgi < 35 ? 82 : fgi < 50 ? 65 : 40,
      riskBand: "low",
      timeframe: "1d-1w",
      timeframeMn: "1хон-1долоо",
      positionSizePct: fgi < 35 ? 14 : 8,
      stopLossPct: 4.5,
      rationale: [
        "Reduces timing risk during pullbacks",
        "Best for high conviction assets",
      ],
      rationaleMn: [
        "Бууралтын үеийн timing эрсдэлийг бууруулна",
        "Итгэлтэй гол активуудад хамгийн тохиромжтой",
      ],
      invalidation: "Pause entries if macro trend breaks below weekly support",
      invalidationMn: "Долоо хоногийн support эвдэрвэл худалдан авалтыг зогсоо",
      score: 0,
    },
  ];

  const scored = strategies.map((strategy) => {
    const rr = parseRiskReward(strategy.riskReward);
    const riskPenalty =
      strategy.riskBand === "low" ? 0 : strategy.riskBand === "medium" ? 3 : 6;
    const score =
      strategy.confidence * 0.45 +
      strategy.winRate * 0.35 +
      rr * 12 * signalMultiplier(strategy.signal) -
      riskPenalty;

    return { ...strategy, score: Number(score.toFixed(1)) };
  });

  return {
    strategies: scored.sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    ),
    volatility,
  };
}

export function getDefaultBuilderConfig(aiSignals: AITradeSignal[]): BuilderConfig {
  const topSignal = [...aiSignals].sort(
    (left, right) => right.confidence - left.confidence,
  )[0];

  return {
    name: "",
    market: topSignal?.symbol?.toUpperCase() ?? "any",
    minSignalConfidence: clamp(topSignal?.confidence ?? 70, 40, 95),
    allowLong: true,
    allowShort: false,
    useRsi: true,
    useMacd: true,
    useMovingAverage: true,
    useVolumeSpike: false,
    rsiOversold: 32,
    rsiOverbought: 68,
    riskProfile: "balanced",
    maxPositionSize: 12,
    maxDailyLoss: 5,
    stopLossMode: "fixed",
    stopLossPct: 3.2,
    takeProfitPct: 7.5,
    useTrailingStop: false,
  };
}

export function buildRuleSummary(config: BuilderConfig) {
  const aiDirections = [config.allowLong ? "LONG" : null, config.allowShort ? "SHORT" : null]
    .filter(Boolean)
    .join(" / ");
  const indicators = [
    config.useRsi ? `RSI(${config.rsiOversold}-${config.rsiOverbought})` : null,
    config.useMacd ? "MACD trend" : null,
    config.useMovingAverage ? "MA alignment" : null,
    config.useVolumeSpike ? "Volume spike" : null,
  ]
    .filter(Boolean)
    .join(", ");

  return [
    `Entry: AI signal >= ${config.minSignalConfidence}% confidence (${aiDirections || "disabled"}) on ${config.market === "any" ? "all tracked pairs" : config.market}`,
    `Filters: ${indicators || "No indicator filter"}`,
    `Risk: ${config.riskProfile} profile, max position ${config.maxPositionSize}%, max daily loss ${config.maxDailyLoss}%`,
    `Exit: stop loss ${config.stopLossPct}% (${config.stopLossMode}), take profit ${config.takeProfitPct}%${config.useTrailingStop ? ", trailing stop enabled" : ""}`,
  ];
}
