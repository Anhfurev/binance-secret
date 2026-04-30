"use client";

import type { AITradeSignal } from "@/lib/types";
import type { CustomStrategyConfig } from "@/lib/trading/custom-strategy";

export type StrategyType = "trend" | "reversal" | "breakout" | "scalp";
export type StrategySignal = "long" | "short" | "wait";
export type RiskBand = "low" | "medium" | "high";
export type MarketRegime = "bull" | "bear" | "range";
export type RiskProfile = CustomStrategyConfig["riskProfile"];
export type StopLossMode = CustomStrategyConfig["stopLossMode"];
export type BuilderConfig = CustomStrategyConfig;

export interface Strategy {
  id: string;
  name: string;
  nameMn: string;
  type: StrategyType;
  signal: StrategySignal;
  winRate: number;
  riskReward: string;
  description: string;
  descriptionMn: string;
  pairs: string[];
  confidence: number;
  riskBand: RiskBand;
  timeframe: string;
  timeframeMn: string;
  positionSizePct: number;
  stopLossPct: number;
  rationale: string[];
  rationaleMn: string[];
  invalidation: string;
  invalidationMn: string;
  score: number;
}

export interface StrategyPanelProps {
  fearGreedIndex: number;
  btcChange24h?: number;
  aiSignals?: AITradeSignal[];
}
