// Market data types
export interface CoinData {
  id: string;
  symbol: string;
  name: string;
  image: string;
  current_price: number;
  market_cap: number;
  market_cap_rank: number;
  price_change_percentage_24h: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  circulating_supply: number;
  sparkline_in_7d?: {
    price: number[];
  };
}

export interface GlobalMarketData {
  total_market_cap: { [key: string]: number };
  total_volume: { [key: string]: number };
  market_cap_percentage: { [key: string]: number };
  market_cap_change_percentage_24h_usd: number;
}

// AI Growth Suggestion types
export type TrendLabel = "Strong" | "Watch" | "Weak";
export type SuggestedAction = "Buy small" | "Hold" | "Reduce" | "Avoid";
export type RiskTag = "Low" | "Medium" | "High";
export type RankChange = "up" | "down" | "same";

export interface GrowthCandidate {
  id: string;
  symbol: string;
  name: string;
  image: string;
  growthScore: number;
  confidence: number;
  trend: TrendLabel;
  aiReason: string;
  suggestedAction: SuggestedAction;
  riskTag: RiskTag;
  rankChange: RankChange;
  previousRank?: number;
  currentRank: number;
  factors: {
    momentum: number;
    volume: number;
    sentiment: number;
    dominance: number;
    volatility: number;
  };
}

// Alert types
export type AlertSeverity = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  message: string;
  severity: AlertSeverity;
  timestamp: Date;
  coinId?: string;
  coinSymbol?: string;
}

// Portfolio types
export interface PortfolioAsset {
  coinId: string;
  symbol: string;
  name: string;
  amount: number;
  value: number;
  allocation: number;
  pnl24h: number;
  pnlPercent24h: number;
}

export interface PortfolioSnapshot {
  totalBalance: number;
  pnl24h: number;
  pnlPercent24h: number;
  assets: PortfolioAsset[];
  riskScore: number;
  capitalProtectionMode: boolean;
}

// News & Sentiment types
export interface NewsItem {
  id: string;
  title: string;
  source: string;
  url: string;
  publishedAt: Date;
  aiSummary: string;
  marketImpact: "positive" | "negative" | "neutral";
}

export interface SentimentData {
  fearGreedIndex: number;
  fearGreedLabel: string;
  socialSentiment: number;
  socialSentimentLabel: string;
}

// Market status
export type MarketStatus = "Risk-On" | "Neutral" | "Risk-Off";

// Chatbot types
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

// Dashboard state
export interface DashboardState {
  lastUpdated: Date;
  isRefreshing: boolean;
  marketStatus: MarketStatus;
  dataSource: "live" | "fallback";
  error?: string;
}

// Risk controls
export interface RiskControls {
  maxPositionSize: number;
  maxDailyLoss: number;
  stopLossReminder: boolean;
}

// AI Trade Signal - detailed buy/sell suggestion
export type SignalType = "BUY" | "SELL" | "HOLD" | "STRONG_BUY" | "STRONG_SELL";
export type TimeHorizon = "short" | "medium" | "long";

export interface PriceTarget {
  price: number;
  probability: number;
  timeframe: string;
}

export interface AITradeSignal {
  id: string;
  coinId: string;
  symbol: string;
  name: string;
  image: string;
  signalType: SignalType;
  confidence: number;
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  takeProfits: PriceTarget[];
  riskRewardRatio: number;
  riskScore: number;
  volatilityLevel: "low" | "medium" | "high";
  expectedDrawdown: number;
  probabilityOfSuccess: number;
  timeHorizon: TimeHorizon;
  reasoning: string[];
  technicalIndicators: {
    rsi: number;
    macd: "bullish" | "bearish" | "neutral";
    movingAverages: "above" | "below" | "crossing";
    volume: "high" | "normal" | "low";
  };
  marketConditions: string[];
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

export type ScalpingTimeframe = "1m" | "3m" | "5m";
export type ScalpingDirection = "long" | "short";

export interface ScalpingSettings {
  /** `bot_settings.symbol` row updated when syncing scalping tunables. */
  symbol: string;
  timeframe: ScalpingTimeframe;
  minAiConfidence: number;
  /** RSI below this favors long entries (bot `rsi_buy_threshold`). */
  rsiBuyThreshold: number;
  /** RSI above this favors exits / overbought (bot `rsi_sell_threshold`). */
  rsiSellThreshold: number;
  /** Max simultaneous open positions per account (bot `max_open_trades`). */
  maxOpenTrades: number;
  minExpectedProfitToFeeRatio: number;
  maxSpreadPct: number;
  minLiquidityUsd: number;
  minVolatilityPct: number;
  maxVolatilitySpikePct: number;
  requiredTechnicalConfirmations: number;
  stopLossPct: number;
  takeProfitPct: number;
  maxPositionSizePct: number;
  maxDailyLossPct: number;
  useTrailingStop: boolean;
  trailingStopPct: number;
  maxSlippagePct: number;
  minOrderBookDepthUsd: number;
  minTradeScore: number;
  makerFeePct: number;
  takerFeePct: number;
}

export interface ScalpingTechnicalConfirmation {
  key: "rsi" | "macd" | "movingAverage" | "volumeSpike";
  label: string;
  agrees: boolean;
  score: number;
  detail: string;
}

export interface ScalpingMarketSnapshot {
  symbol: string;
  timeframe: ScalpingTimeframe;
  expectedProfitPct: number;
  totalFeePct: number;
  spreadPct: number;
  liquidityUsd: number;
  volatilityPct: number;
  volatilitySpikePct: number;
  orderBookDepthUsd: number;
  estimatedSlippagePct: number;
  volumeStrength: number;
  trendStrength: number;
  volatilityScore: number;
}

export interface ScalpingRiskPlan {
  positionSizeUsd: number;
  positionSizePct: number;
  stopLoss: number;
  takeProfit: number;
  trailingStopPct?: number;
  dailyLossUsedPct: number;
  dailyLossRemainingPct: number;
}

export interface ScalpingExecutionPlan {
  entryPrice: number;
  notionalUsd: number;
  quantity: number;
  spreadPct: number;
  slippagePct: number;
  feePct: number;
}

export interface ScalpingDecision {
  status: "execute" | "skip" | "halt";
  direction: ScalpingDirection | null;
  score: number;
  requiredScore: number;
  reasons: string[];
  blockers: string[];
  confirmations: ScalpingTechnicalConfirmation[];
  confirmationCount: number;
  market: ScalpingMarketSnapshot;
  risk?: ScalpingRiskPlan;
  execution?: ScalpingExecutionPlan;
}

// Demo Account
export interface DemoTrade {
  id: string;
  signalId: string;
  coinId: string;
  symbol: string;
  type: "buy" | "sell";
  /** Futures-specific fields */
  direction?: "LONG" | "SHORT";
  leverage?: number;
  marginUsed?: number;
  liquidationPrice?: number;
  isFutures?: boolean;
  /** Trade journal */
  notes?: string;
  tags?: string[];
  entryPrice: number;
  exitPrice?: number;
  amount: number;
  value: number;
  status: "open" | "closed" | "stopped" | "liquidated";
  pnl?: number;
  pnlPercent?: number;
  openedAt: Date;
  closedAt?: Date;
  stopLoss: number;
  takeProfit: number;
  /** Intraday peak for ATR trailing profit (15m alpha legs). */
  highestPriceReached?: number;
  /** Intraday trough for ATR trailing profit on SHORT legs. */
  lowestPriceReached?: number;
  /** First-fill entry — used for pyramid extension / breakeven gates. */
  originalEntryPrice?: number;
  /** Base layer notional (USDT) — pyramid adds 50% of this. */
  initialPositionValueUsdt?: number;
  /** Count of pyramid scale-ins (0 = base only). */
  pyramidLayers?: number;
  /** Cumulative USDT added via pyramid layers. */
  pyramidAddedUsdt?: number;
  /** 70% velocity scalp banked; runner trails on remainder. */
  velocityTakeProfitSecured?: boolean;
  trailingStopPct?: number;
  decisionScore?: number;
  estimatedSlippagePct?: number;
  spreadPct?: number;
  executionNotes?: string[];
  followedSignal: boolean;
  /** Parsed from `trades.ai_reasoning` when present (buys / bot audit JSON). */
  aiReasoning?: {
    proTip?: string;
    oneHBearishCapApplied?: boolean;
    rawWeightedConfidence?: number;
    effectiveConfidence?: number;
  };
}

export interface DemoAccount {
  id: string;
  startingBalance: number;
  currentBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  bestTrade: number;
  worstTrade: number;
  currentDrawdown: number;
  maxDrawdown: number;
  /** Equity curve data points */
  equityCurve: { time: string; equity: number }[];
  /** Daily loss tracking for circuit breaker */
  dailyPnl: number;
  dailyPnlResetDate: string;
  /** Circuit breaker */
  circuitBreakerTripped: boolean;
  openPositions: DemoTrade[];
  tradeHistory: DemoTrade[];
  createdAt: Date;
  expiresAt: Date;
  isActive: boolean;
}

// Whale Activity
export interface WhaleTransaction {
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
  timestamp: Date;
  impact: "bullish" | "bearish" | "neutral";
  aiAnalysis: string;
  /** Exchange inflow / outflow analysis */
  exchangeFlowAnalysis?: {
    classification:
      | "strong_accumulation"
      | "accumulation"
      | "distribution"
      | "strong_distribution"
      | "neutral_flow";
    netDirectionLabel: string;
    contextNote: string;
  };
  /** Wallet accumulation / distribution pattern */
  accumulationPattern?: {
    patternType:
      | "accumulation"
      | "distribution"
      | "otc_deal"
      | "internal_move"
      | "dormant_reactivation";
    confidence: number; // 0–100
    description: string;
  };
  /** Estimated market impact */
  marketImpactEstimate?: {
    timeframe: "immediate" | "1-24h" | "1-7d";
    priceEffect:
      | "strong_bullish"
      | "bullish"
      | "neutral"
      | "bearish"
      | "strong_bearish";
    magnitude: "high" | "medium" | "low";
    note: string;
  };
}

// Price Prediction
export interface PricePrediction {
  coinId: string;
  symbol: string;
  currentPrice: number;
  predictions: {
    timeframe: "1h" | "24h" | "7d" | "30d";
    predictedPrice: number;
    confidence: number;
    direction: "up" | "down" | "sideways";
    percentChange: number;
  }[];
  supportLevels: number[];
  resistanceLevels: number[];
  aiAnalysis: string;
}

// Portfolio Optimization
export interface PortfolioRecommendation {
  type: "rebalance" | "add" | "reduce" | "remove";
  coinId: string;
  symbol: string;
  currentAllocation: number;
  suggestedAllocation: number;
  reason: string;
  priority: "high" | "medium" | "low";
}

export interface PortfolioOptimization {
  currentRiskScore: number;
  optimizedRiskScore: number;
  expectedReturnIncrease: number;
  recommendations: PortfolioRecommendation[];
  aiSummary: string;
}

// Binance Futures Intelligence
export type FuturesSignalType = "LONG" | "SHORT" | "WAIT";

export interface FuturesSignal {
  symbol: string;
  signal: FuturesSignalType;
  confidence: number;
  markPrice: number;
  change24h: number;
  fundingRate: number;
  openInterestDeltaPct: number;
  rsi: number;
  direction: "up" | "down" | "sideways";
  reason: string;
  generatedAt: string;
}

export interface FuturesSignalsResponse {
  source: "live" | "fallback";
  generatedAt: string;
  signals: FuturesSignal[];
}
