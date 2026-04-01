"use client";

import { useCallback, useState, useRef, useEffect } from "react";
import {
  MessageSquare,
  Send,
  X,
  Sparkles,
  ChevronUp,
  Bot,
  User,
  BellRing,
  History,
  RotateCcw,
  Radar,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import type {
  ChatMessage,
  GrowthCandidate,
  CoinData,
  SentimentData,
  AITradeSignal,
  WhaleTransaction,
  PortfolioSnapshot,
  PricePrediction,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/components/language-provider";
import type { LanguageMode } from "@/lib/language";
import { buildDashboardAiAnalysis } from "@/lib/ai-analysis";
import type { PaperTradingSnapshot } from "@/hooks/use-dashboard-data";

interface ChatbotProps {
  candidates: GrowthCandidate[];
  coins: CoinData[];
  sentiment: SentimentData;
  signals: AITradeSignal[];
  predictions: PricePrediction[];
  whales: WhaleTransaction[];
  portfolio: PortfolioSnapshot;
  paperTrading: PaperTradingSnapshot;
  resolveContext?: (message: string) => Promise<{
    signals: AITradeSignal[];
    predictions: PricePrediction[];
    whales: WhaleTransaction[];
    portfolio: PortfolioSnapshot;
    paperTrading: PaperTradingSnapshot;
  }>;
}

const quickPrompts = [
  "How do I use this dashboard?",
  "Explain the latest AI signal",
  "Analyze ETHUSDT market conditions",
  "Explain the current trading signals",
  "Give me prediction summary",
  "What should I do if market falls?",
  "Which coin is strongest now?",
  "Give me market analysis now",
  "Summarize whale activity",
  "What whale activity is happening today?",
  "Give me portfolio insights",
  "Review my paper trading results",
  "Start auto paper trading",
  "Stop auto trading",
  "Show my bot performance",
  "Explain futures & leverage",
  "How does Demo Mode work?",
  "Risk management tips",
  "Trading strategies (DCA, swing)",
];

const quickPromptsMn = [
  "Энэ dashboard-ийг яаж ашиглах вэ?",
  "Хамгийн сүүлийн AI дохиог тайлбарла",
  "ETHUSDT захын нөхцөлийг шинжил",
  "Одоогийн trading signal-уудыг тайлбарла",
  "Таамаглалын тойм өг",
  "Зах буувал яах вэ?",
  "Одоо хамгийн хүчтэй coin аль вэ?",
  "Одоогийн захын AI анализ өг",
  "Whale activity-ийг нэгтгээд өг",
  "Өнөөдрийн whale activity юу байна?",
  "Портфолио insight өг",
  "Paper trading үр дүнг тайлбарла",
  "Auto paper trading эхлүүл",
  "Auto trading зогсоо",
  "Bot performance харуул",
  "Фьючерс & хөшүүрэг тайлбарла",
  "Дэмо горим яаж ажилладаг вэ?",
  "Эрсдэлийн зөвлөмж",
  "Арилжааны стратегиуд",
];

const CHAT_HISTORY_KEY = "nextrade-chat-history-v1";
const WALLET_MODE_STORAGE_KEY = "nextrade-wallet-mode";
const DEMO_AUTOPILOT_STORAGE_KEY = "nextrade-demo-autopilot";
const AUTOMATION_EVENT = "nextrade:automation-toggle";

function createWelcomeMessage(language: LanguageMode): ChatMessage {
  const isMn = language === "mn";

  return {
    id: "welcome-1",
    role: "assistant",
    content: isMn
      ? "Сайн байна уу! Би NexTrade AI туслах. Доорх action button, suggested question-уудыг ашиглан шууд эхлээрэй."
      : "Hello! I'm your NexTrade AI assistant. Use the action buttons and suggested questions below to get fast trading insights.",
    timestamp: new Date(),
  };
}

function hydrateMessages(raw: string): ChatMessage[] | null {
  try {
    const parsed = JSON.parse(raw) as Array<
      Omit<ChatMessage, "timestamp"> & { timestamp: string }
    >;

    if (!Array.isArray(parsed)) return null;

    return parsed.map((message) => ({
      ...message,
      timestamp: new Date(message.timestamp),
    }));
  } catch {
    return null;
  }
}

type ResponseMode = "beginner" | "advanced";

function detectResponseMode(message: string): ResponseMode {
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("advanced") ||
    lowerMessage.includes("detailed") ||
    lowerMessage.includes("detail") ||
    lowerMessage.includes("deep") ||
    lowerMessage.includes("pro") ||
    lowerMessage.includes("expert") ||
    lowerMessage.includes("нарийв")
  ) {
    return "advanced";
  }

  return "beginner";
}

function formatUsd(value: number) {
  if (Math.abs(value) >= 1000) {
    return `$${value.toLocaleString()}`;
  }

  if (Math.abs(value) >= 1) {
    return `$${value.toFixed(2)}`;
  }

  return `$${value.toFixed(4)}`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

type AutomationCommand = "start" | "stop" | "performance" | null;

function detectAutomationCommand(message: string): AutomationCommand {
  const lower = message.toLowerCase();

  if (
    lower.includes("start auto paper trading") ||
    lower.includes("start auto trading") ||
    lower.includes("enable paper trading automation") ||
    lower.includes("turn on autopilot") ||
    lower.includes("auto paper trading эхлүүл")
  ) {
    return "start";
  }

  if (
    lower.includes("stop auto trading") ||
    lower.includes("disable automated signals") ||
    lower.includes("disable auto trading") ||
    lower.includes("turn off autopilot") ||
    lower.includes("auto trading зогсоо")
  ) {
    return "stop";
  }

  if (
    lower.includes("show my bot performance") ||
    lower.includes("bot performance") ||
    lower.includes("automation performance") ||
    lower.includes("auto trading performance") ||
    lower.includes("ботын гүйцэтгэл") ||
    lower.includes("bot performance харуул")
  ) {
    return "performance";
  }

  return null;
}

function buildAutomationResponse(
  command: Exclude<AutomationCommand, null>,
  paperTrading: PaperTradingSnapshot,
  language: LanguageMode,
  enabled: boolean,
  blockedByRealMode: boolean,
): string {
  const isMn = language === "mn";
  const tr = (en: string, mn: string) => (isMn ? mn : en);

  const performanceBlock = tr(
    `- Win rate: ${paperTrading.winRate.toFixed(2)}%\n- Total PnL: ${paperTrading.totalPnl >= 0 ? "+" : ""}$${paperTrading.totalPnl.toLocaleString()}\n- Open positions: ${paperTrading.openPositions}\n- Total trades: ${paperTrading.totalTrades}`,
    `- Win rate: ${paperTrading.winRate.toFixed(2)}%\n- Нийт PnL: ${paperTrading.totalPnl >= 0 ? "+" : ""}$${paperTrading.totalPnl.toLocaleString()}\n- Нээлттэй байрлал: ${paperTrading.openPositions}\n- Нийт арилжаа: ${paperTrading.totalTrades}`,
  );

  if (command === "performance") {
    return tr(
      `**Automation Performance**\n\n- Status: ${enabled ? "ON" : "OFF"}\n${performanceBlock}\n\nAction: ${paperTrading.winRate >= 60 ? "Keep automation on but maintain strict risk limits." : "Review losing setups and reduce cadence before scaling."}`,
      `**Automation Гүйцэтгэл**\n\n- Төлөв: ${enabled ? "АСААЛТТАЙ" : "УНТРААЛТТАЙ"}\n${performanceBlock}\n\nҮйлдэл: ${paperTrading.winRate >= 60 ? "Автоматыг асаалттай үлдээгээд эрсдэлийн хязгаараа чанга мөрд." : "Алдагдалтай setup-уудаа шалгаад cadence-аа багасгасны дараа хэмжээг нэм."}`,
    );
  }

  if (command === "start") {
    if (blockedByRealMode) {
      return tr(
        `**Auto Paper Trading**\n\nUnable to enable automation while Real wallet mode is selected.\nSwitch wallet mode to Demo, then retry.\n\nCurrent status: OFF`,
        `**Auto Paper Trading**\n\nReal wallet горимд автоматжуулалтыг асаах боломжгүй.\nЭхлээд wallet mode-оо Demo болгож өөрчлөөд дахин оролдоно уу.\n\nОдоогийн төлөв: УНТРААЛТТАЙ`,
      );
    }

    return tr(
      `**Auto Paper Trading**\n\nAutomation is now ENABLED.\nThe demo bot can open/close paper trades from active signals.\n\n${performanceBlock}\n\nAction: monitor drawdown and keep stop-loss discipline.`,
      `**Auto Paper Trading**\n\nАвтоматжуулалт АСЛАА.\nДэмо bot нь идэвхтэй дохионоос paper trade нээж/хааж ажиллана.\n\n${performanceBlock}\n\nҮйлдэл: drawdown-оо хянаж, stop-loss дүрмээ чанд мөрд.`,
    );
  }

  return tr(
    `**Auto Paper Trading**\n\nAutomation is now DISABLED.\nAutomated signal execution has been stopped.\n\n${performanceBlock}\n\nAction: switch to manual mode and review current open positions.`,
    `**Auto Paper Trading**\n\nАвтоматжуулалт УНТАРЛАА.\nАвтомат дохионы гүйцэтгэл зогссон.\n\n${performanceBlock}\n\nҮйлдэл: гараар удирдах горимд шилжээд одоогийн нээлттэй байрлалуудaa шалга.`,
  );
}

function getSignalRiskNotes(signal: AITradeSignal, language: LanguageMode) {
  const stopDistancePct =
    (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) * 100;
  const isMn = language === "mn";
  const notes: string[] = [];

  if (stopDistancePct >= 7) {
    notes.push(
      isMn
        ? "Stop-loss зай их байна. Алдагдал томрох эрсдэлтэй тул позицийн хэмжээг багасга."
        : "Stop-loss distance is wide. Use a smaller position size to limit downside.",
    );
  } else {
    notes.push(
      isMn
        ? "Stop-loss зай харьцангуй ойр байна. Гэхдээ зах савлах үед амархан идэгдэж болно."
        : "Stop-loss distance is relatively tight, but fast volatility can still trigger it.",
    );
  }

  if (signal.confidence < 70) {
    notes.push(
      isMn
        ? "Итгэлцэл 70%-аас бага тул баталгаажуулалтгүйгээр шууд орох нь эрсдэлтэй."
        : "Confidence is below 70%, so waiting for extra confirmation is safer.",
    );
  }

  if (signal.technicalIndicators.volume === "low") {
    notes.push(
      isMn
        ? "Арилжааны хэмжээ бага тул false move гарах магадлал өндөр."
        : "Volume is low, so false breakouts are more likely.",
    );
  }

  return notes;
}

function renderInlineFormatting(line: string) {
  const segments = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

  return segments.map((segment, index) => {
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return (
        <strong key={`${segment}-${index}`}>{segment.slice(2, -2)}</strong>
      );
    }

    if (
      segment.startsWith("*") &&
      segment.endsWith("*") &&
      !segment.startsWith("**")
    ) {
      return <em key={`${segment}-${index}`}>{segment.slice(1, -1)}</em>;
    }

    return <span key={`${segment}-${index}`}>{segment}</span>;
  });
}

function normalizeSymbol(input: string) {
  return input.replace(/usdt$/i, "").trim().toLowerCase();
}

// Simple response generator based on dashboard data
function generateResponse(
  message: string,
  candidates: GrowthCandidate[],
  coins: CoinData[],
  sentiment: SentimentData,
  signals: AITradeSignal[],
  predictions: PricePrediction[],
  whales: WhaleTransaction[],
  portfolio: PortfolioSnapshot,
  paperTrading: PaperTradingSnapshot,
  language: LanguageMode,
): string {
  const isMn = language === "mn";
  const tr = (en: string, mn: string) => (isMn ? mn : en);
  const lowerMessage = message.toLowerCase();
  const mode = detectResponseMode(message);
  const analysis = buildDashboardAiAnalysis(coins, candidates, sentiment);
  const activeSignals = signals.filter((signal) => signal.isActive !== false);
  const latestSignal = [...activeSignals].sort(
    (left, right) =>
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime(),
  )[0];
  const activeWhales = whales.filter((tx) => tx.impact !== "neutral");
  const requestedSignal = activeSignals.find(
    (signal) =>
      lowerMessage.includes(signal.id.toLowerCase()) ||
      lowerMessage.includes(signal.symbol.toLowerCase()) ||
      lowerMessage.includes(signal.name.toLowerCase()),
  );
  const predictionMatch = predictions.find(
    (prediction) =>
      lowerMessage.includes(prediction.symbol.toLowerCase()) ||
      lowerMessage.includes(prediction.coinId.toLowerCase()),
  );

  const commandIsLatestSignal =
    lowerMessage.includes("latest ai signal") ||
    lowerMessage.includes("explain the latest") ||
    lowerMessage.includes("хамгийн сүүлийн ai дохио");

  const commandIsMarketConditions =
    lowerMessage.includes("market conditions") ||
    lowerMessage.includes("analyze ") ||
    lowerMessage.includes("шинжил") ||
    lowerMessage.includes("захын нөхцөл");

  if (commandIsLatestSignal || commandIsMarketConditions) {
    const coinForReport = commandIsLatestSignal
      ? coins.find(
          (coin) =>
            normalizeSymbol(coin.symbol) ===
            normalizeSymbol(latestSignal?.symbol ?? ""),
        )
      : (coins.find(
          (coin) =>
            lowerMessage.includes(coin.symbol.toLowerCase()) ||
            lowerMessage.includes(`${coin.symbol.toLowerCase()}usdt`) ||
            lowerMessage.includes(coin.name.toLowerCase()),
        ) ??
        coins.find((coin) =>
          lowerMessage.includes(normalizeSymbol(coin.symbol)),
        ));

    const signalForReport = commandIsLatestSignal
      ? latestSignal
      : (activeSignals.find(
          (signal) =>
            signal.coinId === coinForReport?.id ||
            normalizeSymbol(signal.symbol) ===
              normalizeSymbol(coinForReport?.symbol ?? ""),
        ) ?? latestSignal);

    const predictionForReport = predictions.find(
      (prediction) =>
        prediction.coinId === coinForReport?.id ||
        normalizeSymbol(prediction.symbol) ===
          normalizeSymbol(
            coinForReport?.symbol ?? signalForReport?.symbol ?? "",
          ),
    );

    const whalesForReport = activeWhales.filter(
      (whale) =>
        whale.coinId === coinForReport?.id ||
        normalizeSymbol(whale.symbol) ===
          normalizeSymbol(
            coinForReport?.symbol ?? signalForReport?.symbol ?? "",
          ),
    );

    if (!coinForReport && !signalForReport) {
      return tr(
        "I couldn't identify a specific asset to analyze. Try: `Analyze ETHUSDT market conditions`.",
        "Шинжлэх хөрөнгөө тодорхойлж чадсангүй. Жишээ нь: `Analyze ETHUSDT market conditions` гэж асууна уу.",
      );
    }

    const pred24h = predictionForReport?.predictions.find(
      (prediction) => prediction.timeframe === "24h",
    );
    const pred7d = predictionForReport?.predictions.find(
      (prediction) => prediction.timeframe === "7d",
    );
    const trend24h = coinForReport?.price_change_percentage_24h ?? 0;
    const signalBias = signalForReport
      ? signalForReport.signalType.includes("BUY")
        ? 1
        : signalForReport.signalType.includes("SELL")
          ? -1
          : 0
      : 0;
    const predBias = pred24h
      ? pred24h.direction === "up"
        ? 1
        : pred24h.direction === "down"
          ? -1
          : 0
      : 0;
    const whaleBias = whalesForReport.reduce((sum, whale) => {
      if (whale.impact === "bullish") return sum + 1;
      if (whale.impact === "bearish") return sum - 1;
      return sum;
    }, 0);
    const trendBias = trend24h >= 1 ? 1 : trend24h <= -1 ? -1 : 0;

    const weighted =
      signalBias * 0.4 +
      predBias * 0.3 +
      trendBias * 0.2 +
      (whaleBias === 0 ? 0 : whaleBias > 0 ? 0.1 : -0.1);
    const marketDirection =
      weighted >= 0.25
        ? tr("Bullish", "Өсөх")
        : weighted <= -0.25
          ? tr("Bearish", "Буурах")
          : tr("Neutral", "Саармаг");

    const indicatorBits = [
      coinForReport
        ? tr(
            `Trend: 24h change ${trend24h >= 0 ? "+" : ""}${trend24h.toFixed(2)}%`,
            `Тренд: 24ц өөрчлөлт ${trend24h >= 0 ? "+" : ""}${trend24h.toFixed(2)}%`,
          )
        : null,
      signalForReport
        ? tr(
            `Momentum: ${signalForReport.signalType} signal with RSI ${signalForReport.technicalIndicators.rsi} and MACD ${signalForReport.technicalIndicators.macd}`,
            `Моментум: ${signalForReport.signalType} дохио, RSI ${signalForReport.technicalIndicators.rsi}, MACD ${signalForReport.technicalIndicators.macd}`,
          )
        : tr(
            "Momentum: no active momentum signal",
            "Моментум: идэвхтэй моментум дохио алга",
          ),
      signalForReport
        ? tr(
            `Volatility proxy: stop-loss distance ${((Math.abs(signalForReport.entryPrice - signalForReport.stopLoss) / signalForReport.entryPrice) * 100).toFixed(1)}%`,
            `Савлагааны үзүүлэлт: stop-loss зай ${((Math.abs(signalForReport.entryPrice - signalForReport.stopLoss) / signalForReport.entryPrice) * 100).toFixed(1)}%`,
          )
        : tr(
            "Volatility proxy: using 24h price swing",
            "Савлагааны үзүүлэлт: 24ц үнийн савлагааг ашиглав",
          ),
    ].filter(Boolean);

    const whaleText = whalesForReport.length
      ? tr(
          `${whalesForReport.length} notable whale transfer(s) detected today; latest impact is ${whalesForReport[0].impact}.`,
          `Өнөөдөр ${whalesForReport.length} онцлох whale шилжүүлэг илэрсэн; сүүлийн нөлөө нь ${whalesForReport[0].impact}.`,
        )
      : tr(
          "No major coin-specific whale activity detected today.",
          "Өнөөдөр энэ coin-т том whale activity илрээгүй.",
        );

    const predictionConfidence =
      pred24h?.confidence ?? signalForReport?.confidence ?? 50;
    const confidenceScore = clamp(
      Math.round(
        predictionConfidence * 0.7 + (signalForReport?.confidence ?? 50) * 0.3,
      ),
      35,
      97,
    );

    const riskSummary = [
      trend24h <= -5
        ? tr(
            "Downside momentum is elevated; continuation risk remains high.",
            "Downside моментум өндөр тул цааш үргэлжлэх эрсдэл өндөр байна.",
          )
        : null,
      signalForReport &&
      (Math.abs(signalForReport.entryPrice - signalForReport.stopLoss) /
        signalForReport.entryPrice) *
        100 >=
        7
        ? tr(
            "Wide stop-loss distance implies higher volatility exposure.",
            "Stop-loss зай өргөн байгаа нь савлагааны өртөлтийг нэмэгдүүлнэ.",
          )
        : null,
      whalesForReport.some((whale) => whale.impact === "bearish")
        ? tr(
            "Bearish whale flow may create sudden liquidity pressure.",
            "Bearish whale урсгал нь гэнэтийн ликвидитийн дарамт үүсгэж болно.",
          )
        : null,
    ].filter(Boolean);

    if (riskSummary.length === 0) {
      riskSummary.push(
        tr(
          "No extreme risk flag right now, but crypto remains highly volatile.",
          "Одоогоор хэт эрсдэлийн улаан дохио алга ч крипто зах маш савлагаатай хэвээр.",
        ),
      );
    }

    const strategyText =
      marketDirection === tr("Bullish", "Өсөх")
        ? tr(
            "Consider staggered entries with strict stop-loss and avoid over-leverage.",
            "Хэсэгчлэн үе шаттай оролт хийж, stop-loss-оо хатуу мөрдөж, хэт хөшүүргээс зайлсхий.",
          )
        : marketDirection === tr("Bearish", "Буурах")
          ? tr(
              "Prioritize capital protection, reduce position size, and wait for confirmation before re-entry.",
              "Хөрөнгөө хамгаалахыг тэргүүнд тавьж, позицийн хэмжээг багасгаад, дахин орохоос өмнө баталгаажуулалт хүлээ.",
            )
          : tr(
              "Treat as a range environment and favor selective, smaller trades.",
              "Range орчин гэж үзээд сонгомол, жижиг хэмжээтэй арилжаанд төвлөр.",
            );

    const reportSymbol = (
      signalForReport?.symbol ??
      coinForReport?.symbol ??
      "ASSET"
    ).toUpperCase();

    return tr(
      `**Quant Trading Report: ${reportSymbol}**\n\n1. **Market Direction**\n${marketDirection}\n\n2. **Key Indicators**\n- ${indicatorBits.join("\n- ")}\n\n3. **Whale Activity**\n${whaleText}\n\n4. **AI Prediction Confidence**\n${confidenceScore}% ${pred24h ? `(24h model: ${pred24h.direction}, ${pred24h.percentChange >= 0 ? "+" : ""}${pred24h.percentChange.toFixed(2)}%)` : "(signal-derived estimate)"}\n\n5. **Risk Assessment**\n- ${riskSummary.join("\n- ")}\n\n6. **Suggested Strategy**\n${strategyText}\n\n*Educational report only. Not financial advice.*`,
      `**Quant Арилжааны Тайлан: ${reportSymbol}**\n\n1. **Захын Чиглэл**\n${marketDirection}\n\n2. **Гол Үзүүлэлтүүд**\n- ${indicatorBits.join("\n- ")}\n\n3. **Whale Activity**\n${whaleText}\n\n4. **AI Таамаглалын Итгэлцэл**\n${confidenceScore}% ${pred24h ? `(24ц загвар: ${pred24h.direction}, ${pred24h.percentChange >= 0 ? "+" : ""}${pred24h.percentChange.toFixed(2)}%)` : "(дохионоос тооцсон үнэлгээ)"}\n\n5. **Эрсдэлийн Үнэлгээ**\n- ${riskSummary.join("\n- ")}\n\n6. **Санал Болгох Стратеги**\n${strategyText}\n\n*Сургалтын тайлан. Санхүүгийн зөвлөгөө биш.*`,
    );
  }

  if (
    lowerMessage.includes("explain signal") ||
    lowerMessage.includes("signal explain") ||
    lowerMessage.includes("why this signal") ||
    lowerMessage.includes("about this signal") ||
    lowerMessage.includes("дохио") ||
    lowerMessage.includes("энэ дохио")
  ) {
    const signal = requestedSignal ?? activeSignals[0];
    if (!signal) {
      return tr(
        "I don't see an active signal to explain right now. Refresh signals and try again.",
        "Тайлбарлах идэвхтэй дохио одоогоор алга байна. Дохио шинэчлээд дахин оролдоно уу.",
      );
    }

    const indicatorSummary = [
      `RSI ${signal.technicalIndicators.rsi}`,
      `MACD ${signal.technicalIndicators.macd}`,
      `${tr("Moving averages", "Дундаж шугам")} ${signal.technicalIndicators.movingAverages}`,
      `${tr("Volume", "Хэмжээ")} ${signal.technicalIndicators.volume}`,
    ].join(", ");
    const riskNotes = getSignalRiskNotes(signal, language);

    return tr(
      `**Signal Explanation: ${signal.symbol} ${signal.signalType}**

- **Why generated:** ${signal.reasoning[0] ?? "AI detected a valid trade setup based on trend and momentum."}
- **Confidence level:** ${signal.confidence}%
- **Indicators used:** ${indicatorSummary}
- **Possible risks:**
${riskNotes.map((note) => `  - ${note}`).join("\n")}

Simple takeaway: treat this as a probability-based idea, not a guarantee. Use stop-loss and size control before entering.`,
      `**Дохионы тайлбар: ${signal.symbol} ${signal.signalType}**

- **Яагаад үүссэн:** ${signal.reasoning[0] ?? "AI тренд ба моментум дээр үндэслэн боломжит setup илрүүлсэн."}
- **Итгэлцлийн түвшин:** ${signal.confidence}%
- **Ашигласан үзүүлэлтүүд:** ${indicatorSummary}
- **Боломжит эрсдэлүүд:**
${riskNotes.map((note) => `  - ${note}`).join("\n")}

Энгийн дүгнэлт: энэ нь баталгаа биш, магадлалд суурилсан санаа. Орохоос өмнө stop-loss болон хэмжээгээ заавал тохируул.`,
    );
  }

  if (
    lowerMessage.includes("prediction") ||
    lowerMessage.includes("forecast") ||
    lowerMessage.includes("target") ||
    lowerMessage.includes("таамаг") ||
    (!!predictionMatch &&
      (lowerMessage.includes("price") || lowerMessage.includes("outlook")))
  ) {
    const prediction = predictionMatch ?? predictions[0];
    if (!prediction) {
      return tr(
        "Prediction data is not loaded yet. Refresh the predictions module and ask again.",
        "Таамаглалын өгөгдөл ачаалагдаагүй байна. Predictions модуль шинэчлээд дахин асуу.",
      );
    }

    const pred1h = prediction.predictions.find(
      (item) => item.timeframe === "1h",
    );
    const pred24h =
      prediction.predictions.find((item) => item.timeframe === "24h") ??
      prediction.predictions[0];
    const pred7d = prediction.predictions.find(
      (item) => item.timeframe === "7d",
    );
    const action =
      pred24h.direction === "up"
        ? tr(
            "Bias is constructive. Wait for confirmation near support before adding exposure.",
            "Төлөв эерэг байна. Дэмжлэгийн ойролцоо баталгаажуулалт хүлээгээд байрлал нэм.",
          )
        : pred24h.direction === "down"
          ? tr(
              "Bias is defensive. Reduce size, protect downside, and avoid chasing weak setups.",
              "Төлөв хамгаалалтын шинжтэй байна. Хэмжээг багасгаж, downside-аа хамгаалж, сул setup хөөхөөс зайлсхий.",
            )
          : tr(
              "Bias is neutral. Treat this as a range market until breakout confirmation arrives.",
              "Төлөв саармаг байна. Breakout батлагдтал range зах гэж үз.",
            );

    if (mode === "advanced") {
      return tr(
        `**${prediction.symbol} Prediction Matrix**

- Current price: ${formatUsd(prediction.currentPrice)}
- 1h: ${pred1h?.direction ?? "sideways"} to ${formatUsd(pred1h?.predictedPrice ?? prediction.currentPrice)} (${pred1h?.confidence ?? pred24h.confidence}% confidence)
- 24h: ${pred24h.direction} to ${formatUsd(pred24h.predictedPrice)} (${pred24h.percentChange >= 0 ? "+" : ""}${pred24h.percentChange.toFixed(2)}%)
- 7d: ${pred7d?.direction ?? "sideways"} to ${formatUsd(pred7d?.predictedPrice ?? prediction.currentPrice)}
- Support: ${prediction.supportLevels.map((level) => formatUsd(level)).join(", ")}
- Resistance: ${prediction.resistanceLevels.map((level) => formatUsd(level)).join(", ")}

${prediction.aiAnalysis}

Action: ${action}`,
        `**${prediction.symbol} Таамаглалын матриц**

- Одоогийн үнэ: ${formatUsd(prediction.currentPrice)}
- 1ц: ${pred1h?.direction ?? "sideways"} -> ${formatUsd(pred1h?.predictedPrice ?? prediction.currentPrice)} (${pred1h?.confidence ?? pred24h.confidence}% итгэлцэл)
- 24ц: ${pred24h.direction} -> ${formatUsd(pred24h.predictedPrice)} (${pred24h.percentChange >= 0 ? "+" : ""}${pred24h.percentChange.toFixed(2)}%)
- 7хоног: ${pred7d?.direction ?? "sideways"} -> ${formatUsd(pred7d?.predictedPrice ?? prediction.currentPrice)}
- Дэмжлэг: ${prediction.supportLevels.map((level) => formatUsd(level)).join(", ")}
- Эсэргүүцэл: ${prediction.resistanceLevels.map((level) => formatUsd(level)).join(", ")}

${prediction.aiAnalysis}

Үйлдэл: ${action}`,
      );
    }

    return tr(
      `**${prediction.symbol} Prediction Summary**

- Next 24h bias: ${pred24h.direction}
- Confidence: ${pred24h.confidence}%
- Expected move: ${pred24h.percentChange >= 0 ? "+" : ""}${pred24h.percentChange.toFixed(2)}%
- Key zone: ${formatUsd(prediction.supportLevels[0] ?? prediction.currentPrice)} to ${formatUsd(prediction.resistanceLevels[0] ?? prediction.currentPrice)}

Simple view: ${prediction.symbol} is currently projected to move ${pred24h.direction}. ${action}`,
      `**${prediction.symbol} Таамаглалын тойм**

- Дараагийн 24ц чиглэл: ${pred24h.direction}
- Итгэлцэл: ${pred24h.confidence}%
- Хүлээгдэж буй хөдөлгөөн: ${pred24h.percentChange >= 0 ? "+" : ""}${pred24h.percentChange.toFixed(2)}%
- Гол бүс: ${formatUsd(prediction.supportLevels[0] ?? prediction.currentPrice)} - ${formatUsd(prediction.resistanceLevels[0] ?? prediction.currentPrice)}

Энгийн тайлбар: ${prediction.symbol} одоогоор ${pred24h.direction} чиглэлтэй гэж таамаглагдаж байна. ${action}`,
    );
  }

  if (
    lowerMessage.includes("signal") ||
    lowerMessage.includes("trade idea") ||
    lowerMessage.includes("дохио")
  ) {
    const topSignals = activeSignals.slice(0, 3);
    if (topSignals.length === 0) {
      return tr(
        "I don't see active AI signals right now. Try refreshing market data.",
        "Одоогоор идэвхтэй AI дохио алга байна. Захын өгөгдлөө шинэчлээд үз.",
      );
    }

    if (mode === "advanced") {
      return tr(
        `**Current AI Signal Summary**

${topSignals
  .map(
    (signal, index) =>
      `${index + 1}. **${signal.symbol} ${signal.signalType}**\n- Confidence: ${signal.confidence}%\n- Entry: ${formatUsd(signal.entryPrice)}\n- Stop-loss: ${formatUsd(signal.stopLoss)}\n- First take-profit: ${formatUsd(signal.takeProfits[0]?.price ?? signal.entryPrice)}\n- Risk/reward: ${signal.riskRewardRatio.toFixed(2)}\n- Horizon: ${signal.timeHorizon}\n- Why: ${signal.reasoning[0] ?? "AI detected a tradable setup."}`,
  )
  .join("\n\n")}

Use the strongest setup only if the stop-loss distance matches your size rules. Avoid stacking correlated longs at the same time.`,
        `**Одоогийн AI дохионы тойм**

${topSignals
  .map(
    (signal, index) =>
      `${index + 1}. **${signal.symbol} ${signal.signalType}**\n- Итгэлцэл: ${signal.confidence}%\n- Оролт: ${formatUsd(signal.entryPrice)}\n- Stop-loss: ${formatUsd(signal.stopLoss)}\n- Эхний take-profit: ${formatUsd(signal.takeProfits[0]?.price ?? signal.entryPrice)}\n- Эрсдэл/ашиг: ${signal.riskRewardRatio.toFixed(2)}\n- Хугацаа: ${signal.timeHorizon}\n- Шалтгаан: ${signal.reasoning[0] ?? "AI арилжааны setup илрүүлсэн."}`,
  )
  .join("\n\n")}

Хамгийн сайн setup-ийг зөвхөн stop-loss зай нь позицийн дүрэмтэй таарч байвал сонго. Нэг дор хэт олон ижил чиглэлийн позиц бүү нээ.`,
      );
    }

    return tr(
      `**Current AI Signal Summary**

${topSignals
  .map(
    (signal, index) =>
      `${index + 1}. **${signal.symbol} ${signal.signalType}**\n- Confidence: ${signal.confidence}%\n- Entry: ${formatUsd(signal.entryPrice)}\n- Stop-loss: ${formatUsd(signal.stopLoss)}\n- Take-profit: ${formatUsd(signal.takeProfits[0]?.price ?? signal.entryPrice)}\n- Why: ${signal.reasoning[0] ?? "AI detected a tradable setup."}`,
  )
  .join("\n\n")}

Simple rule: use higher-confidence signals first, and keep size small if the stop-loss is wide.`,
      `**Одоогийн AI дохионы тойм**

${topSignals
  .map(
    (signal, index) =>
      `${index + 1}. **${signal.symbol} ${signal.signalType}**\n- Итгэлцэл: ${signal.confidence}%\n- Оролт: ${formatUsd(signal.entryPrice)}\n- Stop-loss: ${formatUsd(signal.stopLoss)}\n- Take-profit: ${formatUsd(signal.takeProfits[0]?.price ?? signal.entryPrice)}\n- Шалтгаан: ${signal.reasoning[0] ?? "AI арилжааны setup илрүүлсэн."}`,
  )
  .join("\n\n")}

Энгийн дүрэм: итгэлцэл өндөр дохиогоор эхэлж, stop-loss өргөн бол позицийн хэмжээг багасга.`,
    );
  }

  if (
    lowerMessage.includes("whale") ||
    lowerMessage.includes("large movement") ||
    lowerMessage.includes("wallet") ||
    lowerMessage.includes("халим")
  ) {
    const topWhales = whales.slice(0, 3);
    if (topWhales.length === 0) {
      return tr(
        "No whale transactions are loaded right now.",
        "Одоогоор whale гүйлгээ ачаалагдаагүй байна.",
      );
    }

    const bullish = whales.filter((tx) => tx.impact === "bullish").length;
    const bearish = whales.filter((tx) => tx.impact === "bearish").length;
    const exchangeInflows = whales.filter(
      (tx) => tx.type === "exchange_inflow",
    ).length;
    const exchangeOutflows = whales.filter(
      (tx) => tx.type === "exchange_outflow",
    ).length;

    if (mode === "advanced") {
      return tr(
        `**Whale Activity Summary**

- Bullish signals: ${bullish}
- Bearish signals: ${bearish}
- Exchange inflows: ${exchangeInflows}
- Exchange outflows: ${exchangeOutflows}

${topWhales
  .map(
    (tx) =>
      `• ${tx.symbol} ${tx.type.replace("_", " ")} worth $${(tx.valueUsd / 1e6).toFixed(1)}M\n  ${tx.fromAddress.slice(0, 8)}... -> ${tx.toAddress.slice(0, 8)}...\n  Impact: ${tx.impact}. ${tx.aiAnalysis}`,
  )
  .join("\n")}

Action: treat exchange inflows as possible near-term sell pressure and outflows as accumulation until price action proves otherwise.`,
        `**Whale activity тойм**

- Өсөх дохио: ${bullish}
- Буурах дохио: ${bearish}
- Exchange inflow: ${exchangeInflows}
- Exchange outflow: ${exchangeOutflows}

${topWhales
  .map(
    (tx) =>
      `• ${tx.symbol} ${tx.type.replace("_", " ")} $${(tx.valueUsd / 1e6).toFixed(1)}M\n  ${tx.fromAddress.slice(0, 8)}... -> ${tx.toAddress.slice(0, 8)}...\n  Нөлөө: ${tx.impact}. ${tx.aiAnalysis}`,
  )
  .join("\n")}

Үйлдэл: exchange inflow-г богино хугацааны зарах дарамт, outflow-г хуримтлал гэж үзээд дараа нь price action-аар баталгаажуул.`,
      );
    }

    return tr(
      `**Whale Activity Summary**

- Bullish signals: ${bullish}
- Bearish signals: ${bearish}

${topWhales
  .map(
    (tx) =>
      `• ${tx.symbol} ${tx.type.replace("_", " ")} worth $${(tx.valueUsd / 1e6).toFixed(1)}M from ${tx.from} to ${tx.to}. Impact: ${tx.impact}.`,
  )
  .join("\n")}

Exchange outflows usually suggest accumulation. Exchange inflows can imply sell pressure.`,
      `**Whale activity тойм**

- Өсөх дохио: ${bullish}
- Буурах дохио: ${bearish}

${topWhales
  .map(
    (tx) =>
      `• ${tx.symbol} ${tx.type.replace("_", " ")} $${(tx.valueUsd / 1e6).toFixed(1)}M хэмжээтэй, ${tx.from}-оос ${tx.to} руу. Нөлөө: ${tx.impact}.`,
  )
  .join("\n")}

Exchange-ээс гарах урсгал нь ихэвчлэн хуримтлал, exchange рүү орох урсгал нь зарах дарамтыг илтгэнэ.`,
    );
  }

  if (
    lowerMessage.includes("portfolio") ||
    lowerMessage.includes("allocation") ||
    lowerMessage.includes("bag") ||
    lowerMessage.includes("портфолио")
  ) {
    const topAsset = portfolio.assets[0];
    const diversification = portfolio.assets.length;
    const action =
      portfolio.riskScore > 65
        ? tr(
            "Reduce concentration and add more defensive cash or stablecoin exposure.",
            "Төвлөрлөө бууруулж, cash эсвэл stablecoin-ийн жинг нэм.",
          )
        : portfolio.riskScore > 35
          ? tr(
              "Risk is manageable, but review your biggest position before adding more size.",
              "Эрсдэл удирдаж болохуйц ч хамгийн том байрлалаа шалгаад дараа нь хэмжээ нэм.",
            )
          : tr(
              "Risk is controlled. Focus on protecting winners and avoiding forced trades.",
              "Эрсдэл хяналттай байна. Ашигтай байраа хамгаалж, хүчээр арилжаа нээхээс зайлсхий.",
            );

    if (mode === "advanced") {
      return tr(
        `**Portfolio Insights**

- Total balance: $${portfolio.totalBalance.toLocaleString()}
- 24h PnL: ${portfolio.pnl24h >= 0 ? "+" : ""}$${portfolio.pnl24h.toLocaleString()} (${portfolio.pnlPercent24h.toFixed(2)}%)
- Risk score: ${portfolio.riskScore}/100
- Capital protection: ${portfolio.capitalProtectionMode ? "ON" : "OFF"}
- Top allocations: ${portfolio.assets
          .slice(0, 3)
          .map((asset) => `${asset.symbol} ${asset.allocation.toFixed(1)}%`)
          .join(", ")}

Action: ${action}`,
        `**Портфолио insight**

- Нийт үлдэгдэл: $${portfolio.totalBalance.toLocaleString()}
- 24ц PnL: ${portfolio.pnl24h >= 0 ? "+" : ""}$${portfolio.pnl24h.toLocaleString()} (${portfolio.pnlPercent24h.toFixed(2)}%)
- Эрсдэлийн оноо: ${portfolio.riskScore}/100
- Capital protection: ${portfolio.capitalProtectionMode ? "ON" : "OFF"}
- Топ жинлэлтийн бүтэц: ${portfolio.assets
          .slice(0, 3)
          .map((asset) => `${asset.symbol} ${asset.allocation.toFixed(1)}%`)
          .join(", ")}

Үйлдэл: ${action}`,
      );
    }

    return tr(
      `**Portfolio Insights**

- Total balance: $${portfolio.totalBalance.toLocaleString()}
- 24h PnL: ${portfolio.pnl24h >= 0 ? "+" : ""}$${portfolio.pnl24h.toLocaleString()}
- Risk score: ${portfolio.riskScore}/100
- Largest position: ${topAsset?.symbol ?? "--"} (${topAsset?.allocation.toFixed(1) ?? "0"}%)
- Number of tracked assets: ${diversification}

Action: ${action}
`,
      `**Портфолио insight**

- Нийт үлдэгдэл: $${portfolio.totalBalance.toLocaleString()}
- 24ц PnL: ${portfolio.pnl24h >= 0 ? "+" : ""}$${portfolio.pnl24h.toLocaleString()}
- Эрсдэлийн оноо: ${portfolio.riskScore}/100
- Хамгийн том байрлал: ${topAsset?.symbol ?? "--"} (${topAsset?.allocation.toFixed(1) ?? "0"}%)
- Хянаж буй хөрөнгийн тоо: ${diversification}

Үйлдэл: ${action}
`,
    );
  }

  if (
    lowerMessage.includes("paper trading") ||
    lowerMessage.includes("paper results") ||
    lowerMessage.includes("demo result") ||
    lowerMessage.includes("win rate") ||
    lowerMessage.includes("trade history") ||
    lowerMessage.includes("open positions") ||
    lowerMessage.includes("цаасан") ||
    lowerMessage.includes("дэмо үр")
  ) {
    const action = paperTrading.circuitBreakerTripped
      ? tr(
          "Trading is paused by the circuit breaker. Review recent losses before restarting.",
          "Circuit breaker идэвхжсэн тул арилжаа түр зогссон байна. Дахин эхлэхээсээ өмнө сүүлийн алдагдлаа шалга.",
        )
      : paperTrading.winRate >= 60
        ? tr(
            "The system is performing well. Keep risk per trade stable and avoid raising size too fast.",
            "Системийн гүйцэтгэл сайн байна. Нэг арилжааны эрсдлээ тогтвортой барьж, хэмжээг хэт хурдан бүү өсгө.",
          )
        : tr(
            "Results are mixed. Cut trade frequency, review losing setups, and tighten execution rules.",
            "Үр дүн холимог байна. Арилжааны давтамжаа бууруулж, алдагдалтай setup-уудаа шалгаад дүрмээ чангал.",
          );

    if (mode === "advanced") {
      return tr(
        `**Paper Trading Performance**

- Balance: $${paperTrading.currentBalance.toLocaleString()}
- Total PnL: ${paperTrading.totalPnl >= 0 ? "+" : ""}$${paperTrading.totalPnl.toLocaleString()} (${paperTrading.totalPnlPercent.toFixed(2)}%)
- Win rate: ${paperTrading.winRate.toFixed(2)}%
- Total trades: ${paperTrading.totalTrades}
- Open positions: ${paperTrading.openPositions}
- Closed trades: ${paperTrading.closedTrades}
- Best trade: ${formatUsd(paperTrading.bestTrade)}
- Worst trade: ${formatUsd(paperTrading.worstTrade)}
- Daily PnL: ${paperTrading.dailyPnl >= 0 ? "+" : ""}${formatUsd(paperTrading.dailyPnl)}
- Circuit breaker: ${paperTrading.circuitBreakerTripped ? "TRIPPED" : "ACTIVE"}

Action: ${action}`,
        `**Paper trading гүйцэтгэл**

- Баланс: $${paperTrading.currentBalance.toLocaleString()}
- Нийт PnL: ${paperTrading.totalPnl >= 0 ? "+" : ""}$${paperTrading.totalPnl.toLocaleString()} (${paperTrading.totalPnlPercent.toFixed(2)}%)
- Win rate: ${paperTrading.winRate.toFixed(2)}%
- Нийт арилжаа: ${paperTrading.totalTrades}
- Нээлттэй байрлал: ${paperTrading.openPositions}
- Хаагдсан арилжаа: ${paperTrading.closedTrades}
- Хамгийн сайн арилжаа: ${formatUsd(paperTrading.bestTrade)}
- Хамгийн муу арилжаа: ${formatUsd(paperTrading.worstTrade)}
- Өдрийн PnL: ${paperTrading.dailyPnl >= 0 ? "+" : ""}${formatUsd(paperTrading.dailyPnl)}
- Circuit breaker: ${paperTrading.circuitBreakerTripped ? "ИДЭВХЖСЭН" : "ХЭВИЙН"}

Үйлдэл: ${action}`,
      );
    }

    return tr(
      `**Paper Trading Results**

- Win rate: ${paperTrading.winRate.toFixed(2)}%
- Total PnL: ${paperTrading.totalPnl >= 0 ? "+" : ""}$${paperTrading.totalPnl.toLocaleString()}
- Open positions: ${paperTrading.openPositions}

Simple view: your paper trading is ${paperTrading.winRate >= 60 ? "healthy" : "still being refined"}. ${action}`,
      `**Paper trading үр дүн**

- Win rate: ${paperTrading.winRate.toFixed(2)}%
- Нийт PnL: ${paperTrading.totalPnl >= 0 ? "+" : ""}$${paperTrading.totalPnl.toLocaleString()}
- Нээлттэй байрлал: ${paperTrading.openPositions}

Энгийн тайлбар: таны paper trading ${paperTrading.winRate >= 60 ? "сайн" : "сайжруулах шаардлагатай"} байна. ${action}`,
    );
  }

  // Dashboard usage
  if (
    lowerMessage.includes("how") &&
    (lowerMessage.includes("use") || lowerMessage.includes("dashboard"))
  ) {
    return tr(
      `Welcome to NexTrade! Here's how to use this dashboard:

**Portfolio Snapshot** - View your holdings, 24h PnL, and risk score. Toggle Capital Protection for automatic risk management suggestions.

**Live Market Board** - Real-time prices for major coins. Click column headers to sort. Search to find specific coins.

**AI Growth Candidates** - Our algorithm ranks coins by growth potential. Each card shows growth score, confidence level, and suggested action.

**AI Assistant** - Ask for signals, predictions, whale summaries, portfolio reviews, or paper trading performance. Add "advanced" if you want a deeper breakdown.

**Alert Feed** - Real-time alerts about market movements, breakouts, and risk warnings.

**News & Sentiment** - Latest headlines with AI summaries, plus Fear & Greed and social sentiment meters.

*Tip: The dashboard auto-refreshes every 60 seconds, or click Refresh for immediate updates.*`,
      `NexTrade-д тавтай морил! Энэ dashboard-ийг ингэж ашигла:

**Portfolio Snapshot** - Хөрөнгийн багц, 24 цагийн PnL, эрсдэлийн оноогоо харна.

**Live Market Board** - Гол coin-уудын бодит үнэ.

**AI Growth Candidates** - Өсөх магадлалтай coin-уудын эрэмбэ.

**AI Assistant** - Signal, prediction, whale summary, portfolio review, paper trading performance асууж болно. Илүү нарийвчилбал "advanced" гэж нэмж асуу.

**Alert Feed** - Хөдөлгөөн, breakout, эрсдэлийн анхааруулга.

**News & Sentiment** - Сүүлийн мэдээ, AI тайлбар, Fear & Greed үзүүлэлт.

*Зөвлөгөө: Dashboard 60 сек тутамд шинэчлэгдэнэ, эсвэл Refresh дарж шууд шинэчил.*`,
    );
  }

  if (
    lowerMessage.includes("analysis") ||
    lowerMessage.includes("snapshot") ||
    lowerMessage.includes("market now") ||
    lowerMessage.includes("анализ") ||
    lowerMessage.includes("зах")
  ) {
    const top = candidates[0];
    const avg24h =
      coins.length > 0
        ? coins.reduce(
            (sum, coin) => sum + (coin.price_change_percentage_24h || 0),
            0,
          ) / coins.length
        : 0;
    const biasLabel =
      analysis.bias === "bullish"
        ? tr("Bullish", "Өсөх төлөв")
        : analysis.bias === "bearish"
          ? tr("Bearish", "Буурах төлөв")
          : tr("Neutral", "Төвийг сахисан");

    return tr(
      `**Live AI Market Analysis**

- **Bias:** ${biasLabel}
- **Confidence:** ${analysis.confidence}%
- **Risk Level:** ${analysis.riskLevel.toUpperCase()}
- **Fear & Greed:** ${sentiment.fearGreedIndex} (${sentiment.fearGreedLabel})
- **Avg 24h Move (tracked coins):** ${avg24h >= 0 ? "+" : ""}${avg24h.toFixed(2)}%

${top ? `**Top Setup:** ${top.symbol} (${top.growthScore}/100, confidence ${top.confidence}%)\n${top.aiReason}\n` : ""}
**Action Plan:**
${analysis.actions.map((item, index) => `${index + 1}. ${item.title} - ${item.detail}`).join("\n")}

*Educational use only. Not financial advice.*`,
      `**Одоогийн AI зах зээлийн анализ**

- **Төлөв:** ${biasLabel}
- **Итгэлцэл:** ${analysis.confidence}%
- **Эрсдэл:** ${analysis.riskLevel === "high" ? "ӨНДӨР" : analysis.riskLevel === "medium" ? "ДУНД" : "БАГА"}
- **Fear & Greed:** ${sentiment.fearGreedIndex} (${sentiment.fearGreedLabel})
- **Хянаж буй coin-уудын 24ц дундаж хөдөлгөөн:** ${avg24h >= 0 ? "+" : ""}${avg24h.toFixed(2)}%

${top ? `**Шилдэг setup:** ${top.symbol} (${top.growthScore}/100, итгэлцэл ${top.confidence}%)\n${top.aiReason}\n` : ""}
**Үйлдлийн төлөвлөгөө:**
${analysis.actions.map((item, index) => `${index + 1}. ${item.title} - ${item.detail}`).join("\n")}

*Сургалтын зориулалттай. Санхүүгийн зөвлөгөө биш.*`,
    );
  }

  // Market falling
  if (
    lowerMessage.includes("fall") ||
    lowerMessage.includes("crash") ||
    lowerMessage.includes("down") ||
    lowerMessage.includes("буур")
  ) {
    const fearLevel = sentiment.fearGreedIndex;
    const advice =
      fearLevel < 30
        ? "Markets show extreme fear. Consider this a potential buying opportunity for long-term holds, but only with capital you can afford to lose."
        : fearLevel < 50
          ? "Market sentiment is cautious. Reduce position sizes, set stop-losses, and avoid leverage."
          : "Despite concerns, sentiment isn't extremely fearful yet. Stay vigilant and follow the AI suggestions.";

    return tr(
      `**If the market is falling, here's what to consider:**

1. **Don't panic sell** - Emotional decisions often lead to losses
2. **Check the Fear & Greed Index** - Currently at ${fearLevel} (${sentiment.fearGreedLabel})
3. **Review AI suggestions** - Look for 'Reduce' or 'Avoid' recommendations
4. **Enable Capital Protection** - This will suggest automatic risk reduction

${advice}

*Remember: This is not financial advice. Always do your own research and never invest more than you can afford to lose.*`,
      `**Зах бууж байвал дараахыг анхаар:**

1. **Сандарч шууд зарах хэрэггүй**
2. **Fear & Greed индексээ шалга** - Одоо ${fearLevel} (${sentiment.fearGreedLabel})
3. **AI зөвлөмжөө хар** - 'Reduce' эсвэл 'Avoid' анхаар
4. **Capital Protection** горимыг идэвхжүүл

${advice}

*Энэ нь санхүүгийн зөвлөгөө биш. Өөрийн судалгааг заавал хий.*`,
    );
  }

  // Strongest coin
  if (
    lowerMessage.includes("strongest") ||
    lowerMessage.includes("best") ||
    lowerMessage.includes("top")
  ) {
    const top = candidates[0];
    if (top) {
      return tr(
        `**Current Strongest Candidate: ${top.name} (${top.symbol})**

- **Growth Score:** ${top.growthScore}/100
- **Confidence:** ${top.confidence}%
- **Trend:** ${top.trend}
- **Suggested Action:** ${top.suggestedAction}
- **Risk Level:** ${top.riskTag}

**Why it's ranked #1:** ${top.aiReason}

**Factor Breakdown:**
- Momentum: ${top.factors.momentum}%
- Volume: ${top.factors.volume}%
- Sentiment: ${top.factors.sentiment}%
- Dominance: ${top.factors.dominance}%
- Volatility (stability): ${top.factors.volatility}%

*Note: Rankings change frequently. Always verify with your own analysis.*`,
        `**Одоогийн хамгийн хүчтэй candidate: ${top.name} (${top.symbol})**

- **Growth Score:** ${top.growthScore}/100
- **Итгэлцэл:** ${top.confidence}%
- **Тренд:** ${top.trend}
- **Зөвлөсөн үйлдэл:** ${top.suggestedAction}
- **Эрсдэл:** ${top.riskTag}

**Яагаад #1 вэ:** ${top.aiReason}

*Жагсаалт байнга өөрчлөгдөнө. Өөрийн анализтай давхар баталгаажуул.*`,
      );
    }
    return tr(
      "I couldn't find growth candidate data. Try refreshing the dashboard.",
      "Growth candidate өгөгдөл олдсонгүй. Dashboard-оо шинэчлээд дахин оролдоно уу.",
    );
  }

  // Growth score explanation
  if (lowerMessage.includes("growth score") || lowerMessage.includes("score")) {
    return tr(
      `**Understanding the Growth Score**

The Growth Score (0-100) predicts short-term growth potential by combining:

1. **Momentum (0-30 pts)** - Based on 24h price change. Positive movement = higher score.

2. **Market Cap Rank (0-20 pts)** - Top-ranked coins get more points (more stable, institutional interest).

3. **Volume Signal (0-25 pts)** - Higher trading volume relative to market cap indicates strong interest.

4. **Sentiment (0-15 pts)** - Derived from price momentum and volume patterns.

5. **Volatility Penalty (0-10 pts deducted)** - High price swings reduce the score (more risk).

**Score Interpretation:**
- 70+ = Strong growth potential
- 40-69 = Watch list, moderate potential
- Below 40 = Weak or risky

**Confidence %** indicates data reliability - higher market cap coins have more reliable data.`,
      `**Growth Score тайлбар**

Growth Score (0-100) нь богино хугацааны өсөлтийн магадлалыг харуулна:

1. **Momentum**
2. **Market Cap Rank**
3. **Volume Signal**
4. **Sentiment**
5. **Volatility Penalty**

**Онооны ойлголт:**
- 70+ = Өсөх магадлал өндөр
- 40-69 = Ажиглах бүс
- 40-оос доош = Сул эсвэл эрсдэлтэй

**Confidence %** нь өгөгдлийн найдвартай байдлыг илэрхийлнэ.`,
    );
  }

  // Futures / Leverage questions
  if (
    lowerMessage.includes("futures") ||
    lowerMessage.includes("leverage") ||
    lowerMessage.includes("leverage") ||
    lowerMessage.includes("long") ||
    lowerMessage.includes("short") ||
    lowerMessage.includes("liquidat") ||
    lowerMessage.includes("фьючерс") ||
    lowerMessage.includes("хөшүүрэг")
  ) {
    return tr(
      `**Futures Trading Guide**

Futures let you trade with leverage — amplifying both gains and losses.

**Key Concepts:**
- **LONG** = You profit when price goes UP
- **SHORT** = You profit when price goes DOWN
- **Leverage** = Multiplier on your margin (e.g., 10x means $100 margin controls $1,000 position)
- **Margin** = Collateral you put up
- **Liquidation** = If loss exceeds ~90% of your margin, position auto-closes

**Risk Levels:**
- 1-3x = Conservative (similar to spot)
- 5-10x = Moderate (suitable for experienced traders)
- 20x+ = High risk (small moves can liquidate you)

**Tips:**
1. Always use stop-losses
2. Start with 2-5x leverage max
3. Never use more than 10% of portfolio per trade
4. Practice in Demo Mode first!

**Try it:** Go to Demo Mode → Enable Futures Trading to practice risk-free.

*Futures trading carries significant risk. This is educational only.*`,
      `**Фьючерс арилжааны гарын авлага**

Фьючерс нь хөшүүрэг ашиглан арилжаа хийх боломж олгоно.

**Гол ойлголтууд:**
- **LONG** = Үнэ ӨСӨХӨД ашиг олно
- **SHORT** = Үнэ БУУРАХАД ашиг олно
- **Хөшүүрэг** = Маржингаа өсгөгч (10x = $100 маржинаар $1,000 позици)
- **Маржин** = Барьцаа хөрөнгө
- **Татан буулгалт** = Алдагдал маржингийн ~90%-аас хэтэрвэл позици автоматаар хаагдана

**Demo Mode дээр туршаад үз!**

*Фьючерс арилжаа нь их эрсдэлтэй. Зөвхөн сургалтын зориулалттай.*`,
    );
  }

  // Demo mode questions
  if (
    lowerMessage.includes("demo") ||
    lowerMessage.includes("paper") ||
    lowerMessage.includes("practice") ||
    lowerMessage.includes("дэмо") ||
    lowerMessage.includes("туршилт")
  ) {
    return tr(
      `**Demo Trading Mode**

Demo Mode gives you $100,000 virtual money to practice trading risk-free.

**Features:**
- 📊 Spot trading (buy/sell any coin)
- ⚡ Futures trading (LONG/SHORT with leverage)
- 🛡️ Circuit breaker (halts trading at 5% daily loss)
- 📈 Equity curve tracking
- 📝 Trade journal for notes
- 🤖 Auto-pilot mode (AI trades for you)

**How to use:**
1. Navigate to Demo Mode from the sidebar
2. Toggle Auto-Pilot ON for automated trading
3. Enable Futures Trading for leverage practice
4. Track your equity curve over time
5. Add journal notes to learn from each trade

**Your progress is saved** in your browser — come back anytime to continue.

*Perfect for testing strategies before using real money!*`,
      `**Дэмо арилжааны горим**

Дэмо горим нь $100,000 виртуал мөнгөөр эрсдэлгүй дадлага хийх боломж олгоно.

**Боломжууд:**
- 📊 Spot арилжаа
- ⚡ Фьючерс арилжаа (хөшүүрэгтэй)
- 🛡️ Хамгаалалтын систем (5% алдагдалд зогсоно)
- 📈 Капиталын муруй
- 📝 Арилжааны тэмдэглэл
- 🤖 Автомат арилжаа

*Бодит мөнгө ашиглахаас өмнө стратегиа туршихад тохиромжтой!*`,
    );
  }

  // Risk management
  if (
    lowerMessage.includes("risk") ||
    lowerMessage.includes("stop loss") ||
    lowerMessage.includes("stop-loss") ||
    lowerMessage.includes("position size") ||
    lowerMessage.includes("эрсдэл")
  ) {
    return tr(
      `**Risk Management Best Practices**

**Position Sizing:**
- Never risk more than 1-2% of your portfolio per trade
- Calculate: Position Size = (Portfolio × Risk%) / (Entry - Stop Loss)

**Stop-Loss Rules:**
- Always set a stop-loss before entering a trade
- For spot: 3-8% below entry for swing trades
- For futures: Tighter stops, 1-3% with leverage accounted for

**Daily Loss Limit:**
- NexTrade enforces a 5% daily circuit breaker in Demo Mode
- If you lose 5% in a day, all trading halts until tomorrow
- This prevents tilt/revenge trading

**Portfolio Rules:**
- Max 20-30% in any single asset
- Keep 20-40% in stablecoins as dry powder
- Diversify across market caps (large, mid, small)

**The #1 Rule:** Protect your capital first. Profits come from surviving long enough to catch the right trades.`,
      `**Эрсдэлийн удирдлагын зөвлөмж**

**Позицын хэмжээ:**
- Нэг арилжаанд багцын 1-2%-аас ихгүй эрсдэл
- Stop-loss заавал тавь

**Өдрийн алдагдлын хязгаар:**
- NexTrade 5% circuit breaker ашигладаг
- 5% алдагдалд хүрвэл арилжаа зогсоно

**Үндсэн дүрэм:** Хөрөнгөө хамгаалах нь #1 зорилго.`,
    );
  }

  // Automation / auto-pilot
  if (
    lowerMessage.includes("auto") ||
    lowerMessage.includes("bot") ||
    lowerMessage.includes("automat") ||
    lowerMessage.includes("pilot") ||
    lowerMessage.includes("автомат")
  ) {
    return tr(
      `**Auto-Pilot & Automation**

**Demo Auto-Pilot:**
The Demo Mode auto-pilot automatically opens and closes trades based on AI signals.

- Monitors the top signals every 30 seconds
- Opens trades with AI-calculated stop-loss & take-profit
- Automatically closes trades when targets are hit
- Respects the circuit breaker (stops at 5% daily loss)
- Supports both spot and futures trades

**How to enable:**
1. Go to Demo Mode
2. Toggle "Auto-Pilot" switch ON
3. Watch AI manage your demo portfolio

**Smart Features:**
- Follows AI signal confidence scores
- Applies proper position sizing (2-5% per trade)
- Tracks performance with equity curve
- Journal notes auto-added for AI trades

**Live Trading:**
For live automation, connect your Binance API keys in Settings. The AI will generate signals but requires manual confirmation for safety.

*Auto-pilot is educational. Always supervise automated trading.*`,
      `**Автомат арилжаа**

Demo Auto-Pilot нь AI сигнал дээр тулгуурлан автоматаар арилжаа хийнэ.

- 30 секунд тутамд шинэ сигнал шалгана
- Stop-loss & take-profit автоматаар тавина
- Хамгаалалтын системийг хүндэтгэнэ
- Капиталын муруйг хянана

**Идэвхжүүлэх:** Demo Mode → Auto-Pilot → ON

*Автомат арилжааг заавал хянаж бай.*`,
    );
  }

  // DCA / strategy
  if (
    lowerMessage.includes("dca") ||
    lowerMessage.includes("dollar cost") ||
    lowerMessage.includes("strategy") ||
    lowerMessage.includes("стратеги")
  ) {
    return tr(
      `**Popular Trading Strategies**

**1. DCA (Dollar-Cost Averaging)**
- Buy fixed amount at regular intervals (daily/weekly)
- Reduces impact of volatility
- Best for: Long-term holds like BTC, ETH
- Example: $100/week into BTC regardless of price

**2. Swing Trading**
- Hold positions for days to weeks
- Use Growth Score 70+ as entry signals
- Set 5-10% stop-loss, 15-30% take-profit
- Best for: Mid-cap coins with strong momentum

**3. Futures Scalping**
- Quick trades using 5-10x leverage
- Target 1-3% moves, tight stop-losses
- Requires active monitoring
- Practice in Demo Mode first!

**4. Trend Following**
- Follow the AI bias indicator (Bullish/Bearish)
- Go LONG in bullish trends, SHORT in bearish
- Use moving averages as confirmation

**Which strategy fits you?** Consider your:
- Time available (passive vs active)
- Risk tolerance (conservative vs aggressive)
- Capital size (affects position sizing)`,
      `**Түгээмэл арилжааны стратегиуд**

**1. DCA** - Тогтмол хугацаанд тогтмол хэмжээ худалдаж авна
**2. Swing Trading** - Хэдэн өдрөөс 7 хоног хүртэл барина
**3. Futures Scalping** - Хөшүүрэгтэй бяцхан хөдөлгөөн барина
**4. Trend Following** - AI тренд дагана

*Стратегиа Demo Mode дээр туршаад үз!*`,
    );
  }

  // Specific coin query
  const coinMatch = coins.find(
    (c) =>
      lowerMessage.includes(c.symbol.toLowerCase()) ||
      lowerMessage.includes(c.name.toLowerCase()),
  );
  if (coinMatch) {
    const candidate = candidates.find((c) => c.id === coinMatch.id);
    const signal = activeSignals.find(
      (item) =>
        item.coinId === coinMatch.id ||
        item.symbol.toLowerCase() === coinMatch.symbol.toLowerCase(),
    );
    const prediction = predictions.find(
      (item) =>
        item.coinId === coinMatch.id ||
        item.symbol.toLowerCase() === coinMatch.symbol.toLowerCase(),
    );
    const relatedWhales = activeWhales.filter(
      (item) =>
        item.coinId === coinMatch.id ||
        item.symbol.toLowerCase() === coinMatch.symbol.toLowerCase(),
    );
    const change = coinMatch.price_change_percentage_24h;

    const guidanceIntent =
      lowerMessage.includes("should i buy") ||
      lowerMessage.includes("should i sell") ||
      lowerMessage.includes("is it bullish") ||
      lowerMessage.includes("is it bearish") ||
      lowerMessage.includes(" bullish") ||
      lowerMessage.includes(" bearish") ||
      lowerMessage.includes("go long") ||
      lowerMessage.includes("go short") ||
      lowerMessage.includes("авах уу") ||
      lowerMessage.includes("өсөх үү") ||
      lowerMessage.includes("буурах уу");

    if (guidanceIntent) {
      const pred24h = prediction?.predictions.find(
        (item) => item.timeframe === "24h",
      );
      const signalBias = signal
        ? signal.signalType.includes("BUY")
          ? signal.confidence / 100
          : signal.signalType.includes("SELL")
            ? -signal.confidence / 100
            : 0
        : 0;
      const predictionBias = pred24h
        ? pred24h.direction === "up"
          ? pred24h.confidence / 100
          : pred24h.direction === "down"
            ? -pred24h.confidence / 100
            : 0
        : 0;
      const whaleBiasRaw = relatedWhales.reduce((score, whale) => {
        if (whale.impact === "bullish") return score + 0.35;
        if (whale.impact === "bearish") return score - 0.35;
        return score;
      }, 0);
      const whaleBias = clamp(whaleBiasRaw, -1, 1);
      const marketTrendBias = clamp(change / 8, -1, 1);

      const combinedScore =
        signalBias * 0.35 +
        predictionBias * 0.35 +
        whaleBias * 0.15 +
        marketTrendBias * 0.15;

      const direction =
        combinedScore >= 0.2
          ? tr("Bullish", "Өсөх")
          : combinedScore <= -0.2
            ? tr("Bearish", "Буурах")
            : tr("Neutral", "Саармаг");

      const directionForAction =
        combinedScore >= 0.2
          ? tr("consider small staged buys", "бага багаар хэсэгчлэн авах")
          : combinedScore <= -0.2
            ? tr("wait or reduce exposure", "хүлээх эсвэл өртөлтөө бууруулах")
            : tr(
                "wait for clearer confirmation",
                "илүү тод баталгаажуулалт хүлээх",
              );

      const agreementSignals = [
        signal
          ? signal.signalType.includes("BUY")
            ? 1
            : signal.signalType.includes("SELL")
              ? -1
              : 0
          : 0,
        pred24h
          ? pred24h.direction === "up"
            ? 1
            : pred24h.direction === "down"
              ? -1
              : 0
          : 0,
        whaleBias > 0 ? 1 : whaleBias < 0 ? -1 : 0,
        marketTrendBias > 0 ? 1 : marketTrendBias < 0 ? -1 : 0,
      ].filter((v) => v !== 0);

      const alignedCount = agreementSignals.filter(
        (v) => v === Math.sign(combinedScore || 1),
      ).length;
      const alignmentScore =
        agreementSignals.length > 0
          ? alignedCount / agreementSignals.length
          : 0.5;
      const baseConfidence =
        (signal?.confidence ?? 55) * 0.45 +
        (pred24h?.confidence ?? 55) * 0.45 +
        alignmentScore * 100 * 0.1;
      const confidenceScore = clamp(
        Math.round(
          baseConfidence * (0.75 + Math.min(Math.abs(combinedScore), 1) * 0.25),
        ),
        35,
        95,
      );

      const stopDistancePct = signal
        ? (Math.abs(signal.entryPrice - signal.stopLoss) / signal.entryPrice) *
          100
        : 0;
      const riskWarnings: string[] = [];

      if (Math.abs(change) >= 6) {
        riskWarnings.push(
          tr(
            "24h price movement is elevated, which increases whipsaw risk.",
            "24ц үнийн хөдөлгөөн өндөр байгаа нь whipsaw эрсдэлийг өсгөнө.",
          ),
        );
      }

      if (signal && stopDistancePct >= 7) {
        riskWarnings.push(
          tr(
            "Signal stop-loss distance is wide; position size should be smaller.",
            "Дохионы stop-loss зай өргөн тул позицийн хэмжээг багасгах хэрэгтэй.",
          ),
        );
      }

      if (signal && pred24h) {
        const signalDir = signal.signalType.includes("BUY")
          ? "up"
          : signal.signalType.includes("SELL")
            ? "down"
            : "sideways";
        if (signalDir !== "sideways" && signalDir !== pred24h.direction) {
          riskWarnings.push(
            tr(
              "Signal and prediction direction are not aligned.",
              "Дохио болон таамаглалын чиглэл зөрж байна.",
            ),
          );
        }
      }

      if (relatedWhales.some((whale) => whale.impact === "bearish")) {
        riskWarnings.push(
          tr(
            "Recent whale flow includes bearish transfers; momentum may fade quickly.",
            "Сүүлийн whale урсгалд bearish шилжүүлэг байгаа тул momentum хурдан суларч болно.",
          ),
        );
      }

      if (riskWarnings.length === 0) {
        riskWarnings.push(
          tr(
            "No major red flags right now, but crypto remains volatile. Use stop-loss and position sizing.",
            "Одоогоор том улаан дохио алга ч крипто зах савлагаатай хэвээр. Stop-loss болон позицийн хэмжээг мөрд.",
          ),
        );
      }

      return tr(
        `**Trading Guidance: ${coinMatch.symbol.toUpperCase()}**

- **Market Direction:** ${direction}
- **Confidence Score:** ${confidenceScore}%
- **Risk Warning:** ${riskWarnings[0]}

**Context Used:**
- Signals: ${signal ? `${signal.signalType} (${signal.confidence}%)` : "No active coin-specific signal"}
- AI Prediction (24h): ${pred24h ? `${pred24h.direction} (${pred24h.confidence}%)` : "Unavailable"}
- Whale Activity: ${relatedWhales.length > 0 ? `${relatedWhales[0].impact} flow detected` : "No major coin-specific whale alert"}
- Recent Market Trend: ${change >= 0 ? "+" : ""}${change.toFixed(2)}% (24h)

Action: ${directionForAction}. ${tr("This is educational guidance, not financial advice.", "Энэ нь сургалтын зориулалттай, санхүүгийн зөвлөгөө биш.")}`,
        `**Арилжааны Зөвлөмж: ${coinMatch.symbol.toUpperCase()}**

- **Захын чиглэл:** ${direction}
- **Итгэлцлийн оноо:** ${confidenceScore}%
- **Эрсдэлийн анхааруулга:** ${riskWarnings[0]}

**Ашигласан контекст:**
- Дохио: ${signal ? `${signal.signalType} (${signal.confidence}%)` : "Coin-т хамаарах идэвхтэй дохио алга"}
- AI Таамаглал (24ц): ${pred24h ? `${pred24h.direction} (${pred24h.confidence}%)` : "Байхгүй"}
- Whale Activity: ${relatedWhales.length > 0 ? `${relatedWhales[0].impact} урсгал илэрсэн` : "Coin-т хамаарах том whale alert алга"}
- Сүүлийн тренд: ${change >= 0 ? "+" : ""}${change.toFixed(2)}% (24ц)

Үйлдэл: ${directionForAction}. ${tr("This is educational guidance, not financial advice.", "Энэ нь сургалтын зориулалттай, санхүүгийн зөвлөгөө биш.")}`,
      );
    }

    if (
      lowerMessage.includes("why") ||
      lowerMessage.includes("trend") ||
      lowerMessage.includes("trending") ||
      lowerMessage.includes("outlook") ||
      lowerMessage.includes("reason") ||
      lowerMessage.includes("яагаад") ||
      lowerMessage.includes("шалтгаан")
    ) {
      const parts = [
        change >= 0
          ? tr(
              `Price is up ${change.toFixed(2)}% in the last 24h.`,
              `Сүүлийн 24 цагт үнэ ${change.toFixed(2)}%-иар өссөн байна.`,
            )
          : tr(
              `Price is down ${Math.abs(change).toFixed(2)}% in the last 24h.`,
              `Сүүлийн 24 цагт үнэ ${Math.abs(change).toFixed(2)}%-иар буурсан байна.`,
            ),
        signal
          ? tr(
              `AI signal is ${signal.signalType} with ${signal.confidence}% confidence.`,
              `AI дохио нь ${signal.signalType} бөгөөд ${signal.confidence}% итгэлцэлтэй байна.`,
            )
          : tr(
              "There is no high-conviction AI signal on this coin right now.",
              "Одоогоор энэ coin дээр өндөр итгэлцэлтэй AI дохио алга байна.",
            ),
        prediction
          ? tr(
              `The 24h prediction points ${prediction.predictions.find((item) => item.timeframe === "24h")?.direction ?? "sideways"} with ${prediction.predictions.find((item) => item.timeframe === "24h")?.confidence ?? 0}% confidence.`,
              `24 цагийн таамаг ${prediction.predictions.find((item) => item.timeframe === "24h")?.direction ?? "sideways"} чиглэлтэй бөгөөд ${prediction.predictions.find((item) => item.timeframe === "24h")?.confidence ?? 0}% итгэлцэлтэй байна.`,
            )
          : tr(
              "Prediction confidence is not available for this coin yet.",
              "Энэ coin-ийн таамаглалын итгэлцэл одоогоор алга байна.",
            ),
        relatedWhales[0]
          ? tr(
              `Latest whale flow is ${relatedWhales[0].impact} and came from a ${relatedWhales[0].type.replace("_", " ")} event.`,
              `Хамгийн сүүлийн whale урсгал нь ${relatedWhales[0].impact} бөгөөд ${relatedWhales[0].type.replace("_", " ")} үйл явдалтай холбоотой байна.`,
            )
          : tr(
              "No major whale alert is attached to this coin right now.",
              "Одоогоор энэ coin-тэй холбоотой том whale alert алга байна.",
            ),
      ];

      return tr(
        `**Why ${coinMatch.symbol.toUpperCase()} is trending**

- ${parts.join("\n- ")}

Action: ${candidate?.suggestedAction ?? "Wait for clearer confirmation before acting."}`,
        `**${coinMatch.symbol.toUpperCase()} яагаад тренд болж байна вэ**

- ${parts.join("\n- ")}

Үйлдэл: ${candidate?.suggestedAction ?? "Илүү тод баталгаажуулалт гарсны дараа үйлдэл хий."}`,
      );
    }

    return tr(
      `**${coinMatch.name} (${coinMatch.symbol.toUpperCase()})**

- **Price:** $${coinMatch.current_price.toLocaleString()}
- **24h Change:** ${change >= 0 ? "+" : ""}${change.toFixed(2)}%
- **Market Cap:** $${(coinMatch.market_cap / 1e9).toFixed(2)}B
- **Rank:** #${coinMatch.market_cap_rank}

${
  candidate
    ? `**AI Analysis:**
- Growth Score: ${candidate.growthScore}/100
- Suggested Action: ${candidate.suggestedAction}
- ${candidate.aiReason}`
    : "*This coin is not in the current top growth candidates.*"
}

*Always do your own research before making investment decisions.*`,
      `**${coinMatch.name} (${coinMatch.symbol.toUpperCase()})**

- **Үнэ:** $${coinMatch.current_price.toLocaleString()}
- **24ц өөрчлөлт:** ${change >= 0 ? "+" : ""}${change.toFixed(2)}%
- **Market Cap:** $${(coinMatch.market_cap / 1e9).toFixed(2)}B
- **Rank:** #${coinMatch.market_cap_rank}

${
  candidate
    ? `**AI анализ:**\n- Growth Score: ${candidate.growthScore}/100\n- Зөвлөсөн үйлдэл: ${candidate.suggestedAction}\n- ${candidate.aiReason}`
    : "*Одоогийн top growth candidate-д энэ coin алга.*"
}

*Шийдвэр гаргахаас өмнө өөрийн судалгааг хий.*`,
    );
  }

  // Default response
  return tr(
    `I can help you understand this dashboard and make sense of the market data. Try asking:

- "How do I use this dashboard?"
- "Which coin is strongest now?"
- "What should I do if market falls?"
- "Explain the growth score"
- Or ask about a specific coin like "Tell me about BTC"

*Remember: I provide educational information only, not financial advice.*`,
    `Би энэ dashboard болон зах зээлийн өгөгдлийг ойлгоход тусална. Дараах асуултыг туршаад үз:

- "Энэ dashboard-ийг яаж ашиглах вэ?"
- "Одоо хамгийн хүчтэй coin аль вэ?"
- "Зах буувал яах вэ?"
- "Growth score-ийг тайлбарла"
- Эсвэл "BTC-ийн тухай хэлээд өг" гэж асуу

*Би зөвхөн сургалтын мэдээлэл өгнө, санхүүгийн зөвлөгөө биш.*`,
  );
}

export function Chatbot({
  candidates,
  coins,
  sentiment,
  signals,
  predictions,
  whales,
  portfolio,
  paperTrading,
  resolveContext,
}: ChatbotProps) {
  const { t, language } = useLanguage();
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() => [
    createWelcomeMessage("en"),
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const notifiedSignalIdsRef = useRef<Set<string>>(new Set());
  const notifiedWhaleIdsRef = useRef<Set<string>>(new Set());
  const volatilitySpikeActiveRef = useRef(false);
  const highRiskActiveRef = useRef(false);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen, isMinimized]);

  useEffect(() => {
    const stored = window.localStorage.getItem(CHAT_HISTORY_KEY);
    if (!stored) {
      setMessages([createWelcomeMessage(language)]);
      return;
    }

    const hydrated = hydrateMessages(stored);
    if (!hydrated || hydrated.length === 0) {
      setMessages([createWelcomeMessage(language)]);
      return;
    }

    setMessages(hydrated);
  }, [language]);

  useEffect(() => {
    const serializable = messages.slice(-120).map((message) => ({
      ...message,
      timestamp: message.timestamp.toISOString(),
    }));
    window.localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify(serializable));
  }, [messages]);

  const pushInsightMessage = useCallback((content: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.role === "assistant" && last.content === content) {
        return prev;
      }

      return [
        ...prev,
        {
          id: `insight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          role: "assistant",
          content,
          timestamp: new Date(),
        },
      ];
    });
  }, []);

  useEffect(() => {
    const highConfidence = signals
      .filter((signal) => signal.isActive !== false && signal.confidence >= 85)
      .sort(
        (left, right) =>
          new Date(right.createdAt).getTime() -
          new Date(left.createdAt).getTime(),
      );
    const freshSignal = highConfidence.find(
      (signal) => !notifiedSignalIdsRef.current.has(signal.id),
    );

    if (!freshSignal) return;

    notifiedSignalIdsRef.current.add(freshSignal.id);
    pushInsightMessage(
      t(
        `**Auto Insight: High-Confidence Signal**\n\n${freshSignal.symbol} ${freshSignal.signalType} is now active with ${freshSignal.confidence}% confidence.\nWhy it matters: strong model agreement can improve decision quality.\nAction: review entry ${formatUsd(freshSignal.entryPrice)}, stop-loss ${formatUsd(freshSignal.stopLoss)}, and position size before acting.`,
        `**Auto Insight: Өндөр Итгэлцэлтэй Дохио**\n\n${freshSignal.symbol} ${freshSignal.signalType} дохио ${freshSignal.confidence}% итгэлцэлтэй идэвхжлээ.\nЯагаад чухал вэ: загваруудын санал нийлэлт өндөр үед шийдвэрийн чанар сайжирдаг.\nҮйлдэл: оролт ${formatUsd(freshSignal.entryPrice)}, stop-loss ${formatUsd(freshSignal.stopLoss)}, позицийн хэмжээгээ шалгаад дараа нь шийд.`,
      ),
    );
  }, [signals, t, pushInsightMessage]);

  useEffect(() => {
    const largeWhales = whales
      .filter((tx) => tx.valueUsd >= 50_000_000)
      .sort(
        (left, right) =>
          new Date(right.timestamp).getTime() -
          new Date(left.timestamp).getTime(),
      );
    const freshWhale = largeWhales.find(
      (tx) => !notifiedWhaleIdsRef.current.has(tx.id),
    );

    if (!freshWhale) return;

    notifiedWhaleIdsRef.current.add(freshWhale.id);
    pushInsightMessage(
      t(
        `**Auto Insight: Large Whale Transaction**\n\n${freshWhale.symbol} ${freshWhale.type.replace("_", " ")} detected: $${(freshWhale.valueUsd / 1e6).toFixed(1)}M.\nMarket impact flag: ${freshWhale.impact}.\nAction: monitor short-term volatility and avoid oversized entries until direction confirms.`,
        `**Auto Insight: Том Whale Гүйлгээ**\n\n${freshWhale.symbol} ${freshWhale.type.replace("_", " ")} илэрлээ: $${(freshWhale.valueUsd / 1e6).toFixed(1)}M.\nЗахын нөлөө: ${freshWhale.impact}.\nҮйлдэл: богино хугацааны савлагааг ажиглаж, чиглэл батлагдтал хэт том позицоос зайлсхий.`,
      ),
    );
  }, [whales, t, pushInsightMessage]);

  useEffect(() => {
    if (coins.length === 0) return;

    const absMoves = coins.map((coin) =>
      Math.abs(coin.price_change_percentage_24h || 0),
    );
    const avgAbsMove =
      absMoves.reduce((sum, move) => sum + move, 0) / absMoves.length;
    const maxAbsMove = Math.max(...absMoves);
    const spikeNow = avgAbsMove >= 4 || maxAbsMove >= 9;

    if (spikeNow && !volatilitySpikeActiveRef.current) {
      volatilitySpikeActiveRef.current = true;
      pushInsightMessage(
        t(
          `**Auto Insight: Volatility Spike**\n\nAverage 24h move across tracked coins is ${avgAbsMove.toFixed(2)}%, with max move ${maxAbsMove.toFixed(2)}%.\nAction: reduce leverage, tighten stop-loss placement, and prioritize high-confidence setups only.`,
          `**Auto Insight: Захын Савлагаа Өсөлт**\n\nХянаж буй coin-уудын 24ц дундаж хөдөлгөөн ${avgAbsMove.toFixed(2)}%, хамгийн их хөдөлгөөн ${maxAbsMove.toFixed(2)}% байна.\nҮйлдэл: хөшүүргээ багасгаж, stop-loss-оо чангалаад, зөвхөн өндөр итгэлцэлтэй setup сонго.`,
        ),
      );
      return;
    }

    if (!spikeNow) {
      volatilitySpikeActiveRef.current = false;
    }
  }, [coins, t, pushInsightMessage]);

  useEffect(() => {
    const isHighRisk = portfolio.riskScore >= 70;

    if (isHighRisk && !highRiskActiveRef.current) {
      highRiskActiveRef.current = true;
      pushInsightMessage(
        t(
          `**Auto Insight: Portfolio Risk Elevated**\n\nRisk score is now ${portfolio.riskScore}/100.\nAction: reduce concentration in the largest position, increase cash/stable allocation, and avoid adding new high-volatility trades.`,
          `**Auto Insight: Портфолио Эрсдэл Өндөр**\n\nЭрсдэлийн оноо ${portfolio.riskScore}/100 боллоо.\nҮйлдэл: хамгийн том байрлалын төвлөрлөө бууруулж, cash/stable жинг нэмээд, өндөр савлагаатай шинэ арилжаа нэмэхээс зайлсхий.`,
        ),
      );
      return;
    }

    if (!isHighRisk) {
      highRiskActiveRef.current = false;
    }
  }, [portfolio.riskScore, t, pushInsightMessage]);

  const handleSend = useCallback(
    async (text: string = input) => {
      if (!text.trim()) return;

      const trimmedText = text.trim();
      const automationCommand = detectAutomationCommand(trimmedText);

      const userMessage: ChatMessage = {
        id: Date.now().toString(),
        role: "user",
        content: trimmedText,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMessage]);
      setInput("");
      setIsTyping(true);

      const [latestContext] = await Promise.all([
        resolveContext?.(trimmedText),
        new Promise((resolve) =>
          setTimeout(resolve, 500 + Math.random() * 1000),
        ),
      ]);

      const livePaperTrading = latestContext?.paperTrading ?? paperTrading;

      if (automationCommand) {
        const walletMode =
          typeof window !== "undefined"
            ? window.localStorage.getItem(WALLET_MODE_STORAGE_KEY)
            : null;
        const blockedByRealMode =
          automationCommand === "start" && walletMode === "real";

        let nextEnabled =
          typeof window !== "undefined"
            ? window.localStorage.getItem(DEMO_AUTOPILOT_STORAGE_KEY) === "true"
            : false;

        if (automationCommand === "start" && !blockedByRealMode) {
          nextEnabled = true;
        }

        if (automationCommand === "stop") {
          nextEnabled = false;
        }

        if (
          automationCommand !== "performance" &&
          typeof window !== "undefined"
        ) {
          window.localStorage.setItem(
            DEMO_AUTOPILOT_STORAGE_KEY,
            nextEnabled ? "true" : "false",
          );
          window.dispatchEvent(
            new CustomEvent(AUTOMATION_EVENT, {
              detail: {
                enabled: nextEnabled,
                source: "chatbot",
              },
            }),
          );
        }

        const automationReply = buildAutomationResponse(
          automationCommand,
          livePaperTrading,
          language,
          nextEnabled,
          blockedByRealMode,
        );

        const assistantMessage: ChatMessage = {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: automationReply,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMessage]);
        setIsTyping(false);
        return;
      }

      const response = generateResponse(
        trimmedText,
        candidates,
        coins,
        sentiment,
        latestContext?.signals ?? signals,
        latestContext?.predictions ?? predictions,
        latestContext?.whales ?? whales,
        latestContext?.portfolio ?? portfolio,
        livePaperTrading,
        language,
      );

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: response,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, assistantMessage]);
      setIsTyping(false);
    },
    [
      input,
      resolveContext,
      candidates,
      coins,
      sentiment,
      signals,
      predictions,
      whales,
      portfolio,
      paperTrading,
      language,
    ],
  );

  useEffect(() => {
    const onChatAsk = (event: Event) => {
      const customEvent = event as CustomEvent<{ prompt?: string }>;
      const prompt = customEvent.detail?.prompt?.trim();
      if (!prompt) return;

      setIsOpen(true);
      setIsMinimized(false);
      void handleSend(prompt);
    };

    window.addEventListener("nextrade:chat-ask", onChatAsk as EventListener);
    return () => {
      window.removeEventListener(
        "nextrade:chat-ask",
        onChatAsk as EventListener,
      );
    };
  }, [handleSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const resetConversation = () => {
    const welcome = createWelcomeMessage(language);
    setMessages([welcome]);
    window.localStorage.setItem(
      CHAT_HISTORY_KEY,
      JSON.stringify([
        {
          ...welcome,
          timestamp: welcome.timestamp.toISOString(),
        },
      ]),
    );
  };

  const recentQuestions = messages
    .filter((message) => message.role === "user")
    .slice(-12)
    .reverse();

  if (!isOpen) {
    return (
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg glow-teal hover:bg-primary/90 md:bottom-6 md:right-6"
      >
        <MessageSquare className="h-6 w-6" />
        <span className="sr-only">Open chat assistant</span>
      </Button>
    );
  }

  return (
    <Card
      className={cn(
        "fixed z-50 flex flex-col border-border/50 bg-card/95 backdrop-blur-xl shadow-2xl transition-all duration-300",
        isMinimized
          ? "bottom-4 right-4 h-14 w-72 rounded-full md:bottom-6 md:right-6"
          : "bottom-0 right-0 h-168 w-full rounded-t-2xl sm:bottom-4 sm:right-4 sm:h-176 sm:w-104 sm:rounded-2xl md:bottom-6 md:right-6 md:h-192",
      )}
    >
      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border/50 px-4",
          isMinimized
            ? "h-full cursor-pointer rounded-full"
            : "h-14 rounded-t-2xl sm:rounded-t-2xl",
        )}
        onClick={() => isMinimized && setIsMinimized(false)}
      >
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">NexTrade AI</p>
            {!isMinimized && (
              <p className="text-xs text-muted-foreground">
                {t(
                  "Signals, predictions, portfolio, demo",
                  "Дохио, таамаглал, портфолио, дэмо",
                )}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {!isMinimized && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setIsMinimized(true)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setIsOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          <div className="border-b border-border/50 px-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                className="justify-start border-border/60 bg-secondary/30 text-xs"
                onClick={() =>
                  handleSend(
                    t(
                      "Give me market analysis now",
                      "Одоогийн захын AI анализ өг",
                    ),
                  )
                }
              >
                <Radar className="mr-1.5 h-3.5 w-3.5" />
                {t("Market Brief", "Захын тойм")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start border-border/60 bg-secondary/30 text-xs"
                onClick={() =>
                  handleSend(
                    t(
                      "Explain the current trading signals",
                      "Одоогийн trading signal-уудыг тайлбарла",
                    ),
                  )
                }
              >
                <BellRing className="mr-1.5 h-3.5 w-3.5" />
                {t("Top Signals", "Топ дохио")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start border-border/60 bg-secondary/30 text-xs"
                onClick={() =>
                  handleSend(
                    t("Give me portfolio insights", "Портфолио insight өг"),
                  )
                }
              >
                <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                {t("Risk Check", "Эрсдэлийн шалгалт")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="justify-start border-border/60 bg-secondary/30 text-xs"
                onClick={() => setShowHistory((prev) => !prev)}
              >
                <History className="mr-1.5 h-3.5 w-3.5" />
                {showHistory
                  ? t("Hide History", "Түүх нуух")
                  : t("History", "Түүх")}
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full justify-center text-xs text-muted-foreground"
              onClick={resetConversation}
            >
              <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
              {t("Reset Conversation", "Яриаг шинээр эхлүүлэх")}
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4" ref={scrollRef}>
            {showHistory && recentQuestions.length > 0 && (
              <div className="mb-3 rounded-lg border border-border/50 bg-secondary/20 p-2.5">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t("Conversation History", "Ярианы түүх")}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {recentQuestions.map((message) => (
                    <Button
                      key={message.id}
                      variant="outline"
                      size="sm"
                      className="max-w-full border-border/50 bg-card/60 text-xs"
                      onClick={() => handleSend(message.content)}
                    >
                      <span className="max-w-55 truncate">
                        {message.content}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-4 pr-1">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex gap-2",
                    message.role === "user" ? "justify-end" : "justify-start",
                  )}
                >
                  {message.role === "assistant" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                      <Sparkles className="h-3.5 w-3.5 text-primary" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[82%] rounded-2xl px-3 py-2.5 text-sm wrap-break-word",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary/70 text-foreground",
                    )}
                  >
                    <div className="max-w-none whitespace-pre-wrap wrap-anywhere leading-relaxed [&_strong]:font-semibold">
                      {message.content.split("\n").map((line, i, lines) => (
                        <span key={i}>
                          {line.startsWith("**") && line.endsWith("**") ? (
                            <strong>{line.slice(2, -2)}</strong>
                          ) : line.startsWith("- ") ? (
                            <span className="ml-2 block">
                              - {renderInlineFormatting(line.slice(2))}
                            </span>
                          ) : /^\d+\.\s/.test(line) ? (
                            <span className="ml-2 block">
                              {renderInlineFormatting(line)}
                            </span>
                          ) : line.startsWith("*") &&
                            line.endsWith("*") &&
                            !line.startsWith("**") ? (
                            <em className="text-muted-foreground">
                              {line.slice(1, -1)}
                            </em>
                          ) : (
                            renderInlineFormatting(line)
                          )}
                          {i < lines.length - 1 && <br />}
                        </span>
                      ))}
                    </div>
                  </div>
                  {message.role === "user" && (
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    </div>
                  )}
                </div>
              ))}
              {isTyping && (
                <div className="flex gap-2">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Sparkles className="h-3.5 w-3.5 text-primary animate-pulse" />
                  </div>
                  <div className="rounded-2xl bg-secondary/70 px-4 py-3">
                    <div className="flex gap-1">
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
                        style={{ animationDelay: "0ms" }}
                      />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
                        style={{ animationDelay: "150ms" }}
                      />
                      <span
                        className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground"
                        style={{ animationDelay: "300ms" }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Suggested questions */}
          <div className="border-t border-border/50 px-4 py-2">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t("Suggested Questions", "Санал болгох асуултууд")}
            </p>
            <div className="flex gap-2 overflow-x-auto scrollbar-none">
              {(language === "mn" ? quickPromptsMn : quickPrompts).map(
                (prompt, i) => (
                  <Button
                    key={i}
                    variant="outline"
                    size="sm"
                    className="shrink-0 border-border/50 bg-secondary/30 text-sm hover:bg-secondary/50"
                    onClick={() => handleSend(prompt)}
                  >
                    {prompt}
                  </Button>
                ),
              )}
            </div>
          </div>

          {/* Input */}
          <div className="border-t border-border/50 p-3">
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t(
                  "Ask about signals, predictions, whales, portfolio, or demo...",
                  "Signal, prediction, whale, портфолио, эсвэл demo-ийн талаар асуу...",
                )}
                className="flex-1 border-border/50 bg-secondary/50 text-base"
                disabled={isTyping}
              />
              <Button
                onClick={() => handleSend()}
                disabled={!input.trim() || isTyping}
                size="icon"
                className="shrink-0 bg-primary hover:bg-primary/90"
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </Card>
  );
}
