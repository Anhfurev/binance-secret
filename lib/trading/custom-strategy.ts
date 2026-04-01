export type RiskProfile = "conservative" | "balanced" | "aggressive";
export type StopLossMode = "fixed" | "dynamic";

export interface CustomStrategyConfig {
  name: string;
  market: string;
  minSignalConfidence: number;
  allowLong: boolean;
  allowShort: boolean;
  useRsi: boolean;
  useMacd: boolean;
  useMovingAverage: boolean;
  useVolumeSpike: boolean;
  rsiOversold: number;
  rsiOverbought: number;
  riskProfile: RiskProfile;
  maxPositionSize: number;
  maxDailyLoss: number;
  stopLossMode: StopLossMode;
  stopLossPct: number;
  takeProfitPct: number;
  useTrailingStop: boolean;
}

export interface SavedCustomStrategy {
  id: string;
  createdAt: string;
  config: CustomStrategyConfig;
}

export const STRATEGY_BUILDER_STORAGE_KEY = "nextrade-custom-strategies";
export const ACTIVE_CUSTOM_STRATEGY_ID_KEY =
  "nextrade-active-custom-strategy-id";

function getStorage(storage?: Storage | null) {
  return (
    storage ?? (typeof window === "undefined" ? null : window.localStorage)
  );
}

export function loadSavedCustomStrategies(
  storage?: Storage | null,
): SavedCustomStrategy[] {
  const activeStorage = getStorage(storage);
  if (!activeStorage) return [];

  try {
    const raw = activeStorage.getItem(STRATEGY_BUILDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedCustomStrategy[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getActiveCustomStrategyId(
  storage?: Storage | null,
): string | null {
  const activeStorage = getStorage(storage);
  if (!activeStorage) return null;
  return activeStorage.getItem(ACTIVE_CUSTOM_STRATEGY_ID_KEY);
}

export function setActiveCustomStrategyId(
  strategyId: string | null,
  storage?: Storage | null,
) {
  const activeStorage = getStorage(storage);
  if (!activeStorage) return;
  if (!strategyId) {
    activeStorage.removeItem(ACTIVE_CUSTOM_STRATEGY_ID_KEY);
    return;
  }
  activeStorage.setItem(ACTIVE_CUSTOM_STRATEGY_ID_KEY, strategyId);
}

export function loadActiveCustomStrategy(
  storage?: Storage | null,
): SavedCustomStrategy | null {
  const strategies = loadSavedCustomStrategies(storage);
  const activeId = getActiveCustomStrategyId(storage);
  if (!activeId) return null;
  return strategies.find((item) => item.id === activeId) ?? null;
}
