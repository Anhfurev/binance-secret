/** Tunable 1h paper-scalp workspace policy (stored in demo_workspaces payload). */

export const PAPER_MIN_NOTIONAL_USDT = 5.5;

export const DEFAULT_RISK_PER_TRADE_PERCENT = 23;

export const DEFAULT_MAX_OPEN_POSITIONS = 5;

export const DEFAULT_PAPER_WATCH_SYMBOLS = [
  "BTCUSDT",
  "SOLUSDT",
  "PEPEUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "XRPUSDT",
  "ADAUSDT",
  "LINKUSDT",
  "DOGEUSDT",
  "AVAXUSDT",
] as const;

export type PaperScalpWorkspaceSettings = {
  riskPerTradePercent: number;
  symbols: string[];
  maxOpenPositions: number;
};

function normalizeSymbolList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((s) => String(s).trim().toUpperCase())
    .filter(Boolean)
    .map((s) => (s.endsWith("USDT") ? s : `${s}USDT`));
}

function readNumber(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Parse payload.paperSettings or legacy payload.settings from Supabase. */
export function resolvePaperScalpWorkspaceSettings(
  raw?: Partial<PaperScalpWorkspaceSettings> | Record<string, unknown> | null,
): PaperScalpWorkspaceSettings {
  const riskPerTradePercent = readNumber(
    raw?.riskPerTradePercent,
    DEFAULT_RISK_PER_TRADE_PERCENT,
  );
  const maxOpenPositions = Math.min(
    10,
    Math.max(1, Math.floor(readNumber(raw?.maxOpenPositions, DEFAULT_MAX_OPEN_POSITIONS))),
  );
  const symbols = normalizeSymbolList(raw?.symbols);
  return {
    riskPerTradePercent: Math.min(riskPerTradePercent, 50),
    symbols: symbols.length > 0 ? symbols : [...DEFAULT_PAPER_WATCH_SYMBOLS],
    maxOpenPositions,
  };
}

/**
 * positionSizeUsdt = (freeBalance * risk%) / 100, floored at $5.50 (Binance MIN_NOTIONAL).
 */
export function computePaperPositionSizeUsdt(
  freeBalanceUsdt: number,
  riskPerTradePercent: number,
): number {
  const free = Math.max(0, freeBalanceUsdt);
  const raw = (free * riskPerTradePercent) / 100;
  return Number(Math.max(PAPER_MIN_NOTIONAL_USDT, raw).toFixed(2));
}

export function mergeWorkspacePaperSymbolLists(
  lists: string[][],
): string[] {
  const merged = new Set<string>();
  for (const list of lists) {
    for (const s of list) merged.add(s);
  }
  return [...merged];
}
