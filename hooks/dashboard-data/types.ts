import type {
  Alert,
  AITradeSignal,
  CoinData,
  DemoAccount,
  FuturesSignal,
  GlobalMarketData,
  GrowthCandidate,
  NewsItem,
  PricePrediction,
  SentimentData,
  WhaleTransaction,
} from "@/lib/types";

export const DEMO_STORAGE_KEY = "nextrade-demo-account";
export const PAPER_TRADING_UPDATED_EVENT = "nextrade:paper-trading-updated";

export interface PaperTradingSnapshot {
  currentBalance: number;
  totalPnl: number;
  totalPnlPercent: number;
  winRate: number;
  totalTrades: number;
  openPositions: number;
  closedTrades: number;
  dailyPnl: number;
  circuitBreakerTripped: boolean;
  bestTrade: number;
  worstTrade: number;
  source: "live" | "fallback";
  lastUpdated: Date | null;
}

export interface MarketResponse {
  coins: CoinData[];
  global: GlobalMarketData;
  source: "live" | "fallback";
  lastUpdated: string;
}

export interface GrowthResponse {
  candidates: GrowthCandidate[];
  source: "live" | "fallback";
  lastUpdated: string;
  signalsChanged: boolean;
}

export interface SentimentResponse {
  sentiment: SentimentData;
  news: NewsItem[];
  source: "live" | "fallback";
  lastUpdated: string;
}

export interface AlertsResponse {
  alerts: Alert[];
  source: "live" | "fallback";
  lastUpdated: string;
}

export interface WhaleResponse {
  transactions: (Omit<WhaleTransaction, "timestamp"> & { timestamp: string })[];
  generatedAt: string;
}

export interface SignalsResponse {
  signals: AITradeSignal[];
  source: "live" | "fallback";
  lastUpdated: string;
  computed: boolean;
}

export interface PredictionsResponse {
  predictions: PricePrediction[];
  source: "live" | "fallback";
  lastUpdated: string;
  computed: boolean;
}

export interface FuturesSignalsApiResponse {
  source: "live" | "fallback";
  generatedAt: string;
  signals: FuturesSignal[];
}

export interface BinanceAccountStatusResponse {
  configured: boolean;
  canTrade?: boolean;
  canWithdraw?: boolean;
  canDeposit?: boolean;
  accountType?: string;
  permissions?: string[];
  nonZeroBalances?: Array<{ asset: string; free: number; locked: number }>;
  message?: string;
  error?: string;
}

export type PartialDemoAccount = Partial<DemoAccount> | null;
