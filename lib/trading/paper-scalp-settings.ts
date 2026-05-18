import { sanitizePaperScalpSymbolList } from "@/lib/trading/paper-scalp-kline-symbols";

/** Tunable 1h paper-scalp workspace policy (stored in demo_workspaces payload). */

export const PAPER_MIN_NOTIONAL_USDT = 5.5;

/**
 * Below this live NAV, paper mode uses %-of-wallet only (no $5.50 floor).
 * Live Binance spot: min notional ~$5–10/pair — at 23% risk, orders reject if
 * NAV × 0.23 < min (e.g. NAV < ~$22 when min = $5). $28 → $6.44 is fine.
 */
export const PAPER_NAV_COMPOUND_THRESHOLD_USDT = 50;

export const DEFAULT_RISK_PER_TRADE_PERCENT = 23;

export const DEFAULT_MAX_OPEN_POSITIONS = 2;

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
  /** Max RSI for trend-resumption entries (neutral/cool). */
  rsiBuyThreshold: number;
  /** Panic RSI — dip buy even if EMA9 below EMA21. */
  rsiOversoldPanic: number;
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
    2,
    Math.max(1, Math.floor(readNumber(raw?.maxOpenPositions, DEFAULT_MAX_OPEN_POSITIONS))),
  );
  const symbols = normalizeSymbolList(raw?.symbols);
  const rawMap = raw as Record<string, unknown> | undefined;
  const rsiBuyThreshold = readNumber(
    rawMap?.rsiBuyThreshold ?? rawMap?.rsi_buy_threshold,
    55,
  );
  const rsiOversoldPanic = readNumber(
    rawMap?.rsiOversoldPanic ?? rawMap?.rsi_oversold_panic,
    30,
  );
  return {
    riskPerTradePercent: Math.min(riskPerTradePercent, 50),
    symbols: symbols.length > 0 ? symbols : [...DEFAULT_PAPER_WATCH_SYMBOLS],
    maxOpenPositions,
    rsiBuyThreshold: Math.min(rsiBuyThreshold, 85),
    rsiOversoldPanic: Math.min(rsiOversoldPanic, 45),
  };
}

/**
 * Dynamic fractional compounding: size = live NAV × risk%.
 * NAV < $50 → percent-only (23% default, no $5.50 floor).
 * NAV ≥ $50 → enforce Binance min-notional floor.
 */
export function computePaperPositionSizeUsdt(
  liveNavUsdt: number,
  riskPerTradePercent: number,
): { sizeUsdt: number; usedNavCompounding: boolean; appliedMinFloor: boolean } {
  const nav = Math.max(0, liveNavUsdt);
  const riskPct = Math.min(Math.max(riskPerTradePercent, 1), 50);
  const raw = (nav * riskPct) / 100;
  const underThreshold = nav < PAPER_NAV_COMPOUND_THRESHOLD_USDT;

  if (underThreshold) {
    return {
      sizeUsdt: Number(raw.toFixed(4)),
      usedNavCompounding: true,
      appliedMinFloor: false,
    };
  }

  return {
    sizeUsdt: Number(Math.max(PAPER_MIN_NOTIONAL_USDT, raw).toFixed(4)),
    usedNavCompounding: true,
    appliedMinFloor: raw < PAPER_MIN_NOTIONAL_USDT,
  };
}

export function mergeWorkspacePaperSymbolLists(
  lists: string[][],
): string[] {
  const merged = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (s == null || s === undefined) continue;
      const t = String(s).trim().toUpperCase();
      if (t) merged.add(t.endsWith("USDT") ? t : `${t}USDT`);
    }
  }
  return [...merged];
}

const PAPER_PROFILE_ID_HINTS = ["paper-28", "paper-scalp", "paper_28"];

/** Demo / paper profiles — never tied to bot_settings.is_live_trading_enabled. */
export function isPaperScanWorkspace(snapshot: {
  walletMode: "demo" | "real";
  demoAutoPilot: boolean;
  activeId: string;
}): boolean {
  if (snapshot.walletMode !== "real") return true;
  if (snapshot.demoAutoPilot) return true;
  const id = snapshot.activeId.toLowerCase();
  return PAPER_PROFILE_ID_HINTS.some((hint) => id.includes(hint));
}

/** Collect watch-list tickers from workspace payload.paperSettings / settings.symbols. */
export function extractPaperWatchSymbolsFromWorkspaces(
  workspaces: ReadonlyArray<{ snapshot: { walletMode: "demo" | "real"; demoAutoPilot: boolean; activeId: string; paperSettings: PaperScalpWorkspaceSettings } }>,
): string[] {
  const primary: string[][] = [];
  const fallback: string[][] = [];

  for (const ws of workspaces) {
    const syms = ws.snapshot.paperSettings?.symbols ?? [];
    if (isPaperScanWorkspace(ws.snapshot)) {
      primary.push(syms);
    } else if (ws.snapshot.walletMode !== "real") {
      fallback.push(syms);
    }
  }

  const merged = mergeWorkspacePaperSymbolLists(
    primary.length > 0 ? primary : fallback,
  );
  return merged.length > 0 ? merged : [...DEFAULT_PAPER_WATCH_SYMBOLS];
}

/**
 * Union workspace JSON, env, defaults, and open-position extras.
 * Never replaces workspace list with a shorter env-only list.
 */
export function resolvePaperScalpSymbols(
  extra: string[] = [],
  workspaceSymbols: string[] = [],
): string[] {
  const raw = String(process.env.PAPER_SCALP_SYMBOLS ?? "").trim();
  const fromEnv = raw
    ? raw
        .split(",")
        .map((s) => String(s ?? "").trim().toUpperCase())
        .filter(Boolean)
    : [];

  const workspaceClean = mergeWorkspacePaperSymbolLists([workspaceSymbols]);
  const extraClean = mergeWorkspacePaperSymbolLists([extra]);

  const union = mergeWorkspacePaperSymbolLists([
    [...DEFAULT_PAPER_WATCH_SYMBOLS],
    workspaceClean,
    fromEnv,
    extraClean,
  ]);

  const resolved = sanitizePaperScalpSymbolList(union);

  return resolved;
}
