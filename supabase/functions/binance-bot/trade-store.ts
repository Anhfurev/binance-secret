// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type {
  BotPerformanceRow,
  BotSettingsRow,
  JsonRecord,
  OpenTradeRow,
} from "./types.ts";
import { clamp, toNumber } from "./utils.ts";
import { DEFAULT_RISK_PERCENT, PEPE_TEST_TRADE_USD } from "./constants.ts";
import { sendTradeRowNotification } from "./notifier.ts";

export async function loadOpenTrade(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  symbol: string,
  /** When set, only rows with `extra.bot_id` match — isolates ghost vs live bots on the same symbol. */
  botId?: string | null,
): Promise<OpenTradeRow | null> {
  const bid = typeof botId === "string" && botId.trim().length > 0 ? botId.trim() : null;
  if (bid) {
    const scoped = await supabase
      .from("trades")
      .select("*")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .eq("extra->>bot_id", bid)
      .ilike("status", "open")
      .order("opened_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (scoped.error) throw scoped.error;
    /** Strict per-bot isolation (ghost vs live on same symbol): no legacy fallback. */
    return (scoped.data as OpenTradeRow | null) ?? null;
  }

  // Legacy path (no bot_id): never treat ghost/paper as "the" open position —
  // same user+symbol can have a shadow bot; without bot_id scoping, only
  // live notionals should block BUY / drive exit logic.
  const { data, error } = await supabase
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .ilike("status", "open")
    .or("extra->>is_ghost.is.null,extra->>is_ghost.eq.false")
    .or("extra->>trade_mode.is.null,extra->>trade_mode.eq.live")
    .order("opened_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return (data as OpenTradeRow | null) ?? null;
}

export async function updateProfileBalance(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  balance: number,
  startingBalance?: number,
) {
  const patch: JsonRecord = { demo_balance: Number(balance.toFixed(2)) };
  if (typeof startingBalance === "number" && Number.isFinite(startingBalance)) {
    patch.starting_balance = Number(startingBalance.toFixed(2));
  }

  const result = await supabase.from("profiles").update(patch).eq("id", userId);
  if (result.error) throw result.error;
}

export async function ensureProfileRow(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  startingBalance: number,
) {
  const nowIso = new Date().toISOString();
  const result = await supabase
    .from("profiles")
    .upsert({
      id: userId,
      demo_balance: Number(startingBalance.toFixed(2)),
      starting_balance: Number(startingBalance.toFixed(2)),
      updated_at: nowIso,
    } as JsonRecord, { onConflict: "id" });
  if (result.error) throw result.error;
}

export async function insertTrade(
  supabase: ReturnType<typeof createClient>,
  payload: JsonRecord,
  notifyReason?: string,
) {
  const normalized = { ...payload } as JsonRecord;
  const round8 = (value: unknown): number | null => {
    const n = toNumber(value, NaN);
    if (!Number.isFinite(n)) return null;
    return Number(n.toFixed(8));
  };

  // trades.price is NOT NULL in the schema. Guarantee a positive, finite
  // numeric value regardless of upstream precision (e.g. micro-priced assets
  // like PEPE where entryPrice may round to 0 under .toFixed(2)).
  const priceCandidates: unknown[] = [
    normalized.price,
    normalized.entryPrice,
    normalized.exitPrice,
    (normalized.extra as JsonRecord | undefined)?.highest_price_seen,
    (normalized.extra as JsonRecord | undefined)?.highest_price_reached,
    (normalized.extra as JsonRecord | undefined)?.trailing_stop_price,
  ];
  let resolvedPrice = 0;
  for (const candidate of priceCandidates) {
    const n = toNumber(candidate, NaN);
    if (Number.isFinite(n) && n > 0) {
      resolvedPrice = n;
      break;
    }
  }
  if (resolvedPrice > 0) {
    normalized.price = resolvedPrice;
  } else {
    // Last-resort guard so we fail loudly with a clear message instead of a
    // bare "null value in column price" constraint error.
    throw new Error(
      `insertTrade: cannot resolve positive price (symbol=${String(normalized.symbol ?? "unknown")} entryPrice=${String(normalized.entryPrice)} exitPrice=${String(normalized.exitPrice)})`,
    );
  }

  // Persist price-bearing fields with 8-decimal precision for micro-priced assets.
  const roundedEntry = round8(normalized.entryPrice);
  if (roundedEntry !== null && roundedEntry > 0) normalized.entryPrice = roundedEntry;
  const roundedExit = round8(normalized.exitPrice);
  if (roundedExit !== null && roundedExit > 0) normalized.exitPrice = roundedExit;

  const extra = normalized.extra as JsonRecord | undefined;
  if (extra && typeof extra === "object") {
    const roundedHighest = round8(extra.highest_price_seen);
    if (roundedHighest !== null && roundedHighest > 0) {
      extra.highest_price_seen = roundedHighest;
    }
  }

  if (!normalized.opened_at) {
    normalized.opened_at = new Date().toISOString();
  }
  const result = await supabase
    .from("trades")
    .insert([normalized])
    .select("*")
    .single();
  if (result.error) throw result.error;
  await sendTradeRowNotification({
    event: "insert",
    trade: result.data as Record<string, unknown>,
    reason: notifyReason,
  });
}

export function resolveTradeSizeUsd(
  row: BotSettingsRow,
  currentBalance: number,
): number {
  const symbol = String(row.symbol ?? "").toUpperCase();
  if (symbol === "PEPEUSDT") {
    // Keep PEPE exposure small during test runs.
    return Math.min(currentBalance, PEPE_TEST_TRADE_USD);
  }

  const fixedUsd = toNumber(row.trade_size_usd ?? row.fixed_trade_usd, 0);
  if (fixedUsd > 0) return Math.min(currentBalance, fixedUsd);

  const riskPercent = clamp(
    toNumber(row.risk_percent, DEFAULT_RISK_PERCENT),
    0.1,
    100,
  );
  return Math.min(currentBalance, (currentBalance * riskPercent) / 100);
}

export async function upsertBotPerformance(
  supabase: ReturnType<typeof createClient>,
  params: {
    userId: string;
    symbol: string;
    pnl: number;
  },
) {
  const { userId, symbol, pnl } = params;

  const { data, error } = await supabase
    .from("bot_performance")
    .select(
      "id, total_trades, win_count, loss_count, total_pnl_usd, win_rate_pct",
    )
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw error;
  }

  const existing = (data as BotPerformanceRow | null) ?? null;

  const previousTrades = existing?.total_trades ?? 0;
  const previousWins = existing?.win_count ?? 0;
  const previousLosses = existing?.loss_count ?? 0;
  const previousPnl = existing?.total_pnl_usd ?? 0;

  const totalTrades = previousTrades + 1;
  const winCount = pnl > 0 ? previousWins + 1 : previousWins;
  const lossCount = pnl <= 0 ? previousLosses + 1 : previousLosses;
  const totalPnlUsd = Number((previousPnl + pnl).toFixed(2));
  const winRatePct =
    totalTrades > 0 ? Number(((winCount / totalTrades) * 100).toFixed(2)) : 0;

  const patch: BotPerformanceRow = {
    user_id: userId,
    symbol,
    total_trades: totalTrades,
    win_count: winCount,
    loss_count: lossCount,
    total_pnl_usd: totalPnlUsd,
    win_rate_pct: winRatePct,
    updated_at: new Date().toISOString(),
  };

  const upsertResult = await supabase
    .from("bot_performance")
    .upsert(patch, { onConflict: "user_id,symbol" });

  if (upsertResult.error) {
    throw upsertResult.error;
  }
}


