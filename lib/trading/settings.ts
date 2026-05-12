import type { ScalpingSettings } from "@/lib/types";

export const SETTINGS_KEY = "nextrade-settings";

export interface NotificationSettings {
  priceAlerts: boolean;
  signalAlerts: boolean;
  whaleAlerts: boolean;
  dailyDigest: boolean;
}

export interface RiskSettings {
  maxPositionSize: number;
  maxDailyLoss: number;
  stopLossReminder: boolean;
  capitalProtection: boolean;
}

export interface AppSettings {
  notifications: NotificationSettings;
  risk: RiskSettings;
  refreshInterval: number;
  scalping: ScalpingSettings;
}

export const defaultScalpingSettings: ScalpingSettings = {
  timeframe: "3m",
  minAiConfidence: 58,
  rsiBuyThreshold: 30,
  rsiSellThreshold: 70,
  maxOpenTrades: 5,
  minExpectedProfitToFeeRatio: 2,
  maxSpreadPct: 0.05,
  minLiquidityUsd: 1_500_000,
  minVolatilityPct: 0.2,
  maxVolatilitySpikePct: 2.4,
  requiredTechnicalConfirmations: 2,
  stopLossPct: 2.0,
  takeProfitPct: 4.0,
  maxPositionSizePct: 5,
  maxDailyLossPct: 5,
  useTrailingStop: true,
  trailingStopPct: 0.35,
  maxSlippagePct: 0.08,
  minOrderBookDepthUsd: 250_000,
  minTradeScore: 74,
  makerFeePct: 0.02,
  takerFeePct: 0.04,
};

export const defaultSettings: AppSettings = {
  notifications: {
    priceAlerts: true,
    signalAlerts: true,
    whaleAlerts: false,
    dailyDigest: true,
  },
  risk: {
    maxPositionSize: 20,
    maxDailyLoss: 5,
    stopLossReminder: true,
    capitalProtection: false,
  },
  refreshInterval: 60,
  scalping: defaultScalpingSettings,
};

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeAppSettings(
  input?: Partial<AppSettings>,
): AppSettings {
  const root = toRecord(input);
  const notifications = toRecord(root.notifications);
  const risk = toRecord(root.risk);
  const scalping = toRecord(root.scalping);

  return {
    notifications: {
      ...defaultSettings.notifications,
      ...notifications,
    },
    risk: {
      ...defaultSettings.risk,
      ...risk,
    },
    refreshInterval:
      typeof root.refreshInterval === "number"
        ? root.refreshInterval
        : defaultSettings.refreshInterval,
    scalping: {
      ...defaultScalpingSettings,
      ...scalping,
    },
  };
}

export function loadAppSettings(storage?: Storage | null): AppSettings {
  const activeStorage =
    storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!activeStorage) return defaultSettings;

  try {
    const raw = activeStorage.getItem(SETTINGS_KEY);
    if (!raw) return defaultSettings;
    return normalizeAppSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return defaultSettings;
  }
}

export function saveAppSettings(
  settings: AppSettings,
  storage?: Storage | null,
) {
  const activeStorage =
    storage ?? (typeof window === "undefined" ? null : window.localStorage);
  if (!activeStorage) return;
  activeStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify(normalizeAppSettings(settings)),
  );
}

export function loadScalpingSettings(
  storage?: Storage | null,
): ScalpingSettings {
  return loadAppSettings(storage).scalping;
}
