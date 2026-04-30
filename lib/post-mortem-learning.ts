import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { parseAiReasoning } from "@/lib/ai-reasoning";

const BINANCE_API = "https://api.binance.com";
const BATCH_LIMIT = 40;
const LOOKBACK_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const HORIZON_MS = 24 * 60 * 60 * 1000;
const MIN_SAMPLE_FOR_CALIBRATION = 5;
const RANGING_BAD_RATE = 0.38;
const TRENDING_GOOD_RATE = 0.62;
const CALIBRATION_STEP = 2;

export type PostMortemRunResult = {
  ok: boolean;
  evaluated: number;
  skipped: number;
  calibrationUpdates: number;
  actions: string[];
  message?: string;
};

function isRelationMissingError(message: string, table: string) {
  return (
    message.includes(table) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("relation"))
  );
}

function toNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toUserId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

type TradeRow = {
  id: string;
  user_id: string;
  symbol: string;
  type?: string | null;
  status?: string | null;
  entryPrice?: number | string | null;
  exitPrice?: number | string | null;
  closed_at?: string | null;
  ai_reasoning?: string | null;
  extra?: Record<string, unknown> | null;
  pnl?: number | string | null;
};

async function fetchBinanceHourlyCloseNear(
  symbol: string,
  targetMs: number,
): Promise<number | null> {
  const sym = symbol.toUpperCase().replace("/", "");
  const start = Math.max(0, targetMs - 3 * 60 * 60 * 1000);
  const url = new URL(`${BINANCE_API}/api/v3/klines`);
  url.searchParams.set("symbol", sym);
  url.searchParams.set("interval", "1h");
  url.searchParams.set("startTime", String(start));
  url.searchParams.set("endTime", String(targetMs + 3 * 60 * 60 * 1000));
  url.searchParams.set("limit", "10");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const rows = (await res.json()) as number[][];
  if (!Array.isArray(rows) || rows.length === 0) return null;
  for (const k of rows) {
    const closeTime = Number(k[6]);
    const close = Number(k[4]);
    if (Number.isFinite(closeTime) && closeTime >= targetMs - 60_000 && Number.isFinite(close)) {
      return close;
    }
  }
  const last = rows[rows.length - 1];
  const close = Number(last?.[4]);
  return Number.isFinite(close) ? close : null;
}

async function listCandidateClosedBuys(): Promise<TradeRow[]> {
  if (!supabaseAdmin) return [];
  const cutoff = new Date(Date.now() - HORIZON_MS).toISOString();
  const oldest = new Date(Date.now() - LOOKBACK_WINDOW_MS).toISOString();

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("id, user_id, symbol, type, status, entryPrice, exitPrice, closed_at, ai_reasoning, extra, pnl")
    .ilike("type", "buy")
    .in("status", ["closed", "stopped", "CLOSED", "STOPPED"])
    .not("closed_at", "is", null)
    .lte("closed_at", cutoff)
    .gte("closed_at", oldest)
    .order("closed_at", { ascending: false })
    .limit(200);

  if (error) {
    if (isRelationMissingError(error.message, "trades")) return [];
    throw error;
  }

  const rows = (data ?? []) as TradeRow[];
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id).filter(Boolean);
  const { data: doneRows, error: memErr } = await supabaseAdmin
    .from("ai_performance_memory")
    .select("trade_id")
    .in("trade_id", ids);

  if (memErr) {
    if (isRelationMissingError(memErr.message, "ai_performance_memory")) {
      return [];
    }
    throw memErr;
  }

  const done = new Set(
    (doneRows ?? []).map((r: { trade_id: string }) => r.trade_id).filter(Boolean),
  );
  return rows.filter((r) => r.id && !done.has(r.id)).slice(0, BATCH_LIMIT);
}

async function maybeCalibrateBotThresholds(params: {
  botId: string | null;
  regime: string;
}): Promise<number> {
  const { botId, regime } = params;
  if (!supabaseAdmin || !botId) return 0;

  const { data: recent, error } = await supabaseAdmin
    .from("ai_performance_memory")
    .select("outcome_directionally_correct")
    .eq("bot_id", botId)
    .eq("market_regime", regime)
    .order("created_at", { ascending: false })
    .limit(14);

  if (error || !recent?.length || recent.length < MIN_SAMPLE_FOR_CALIBRATION) {
    return 0;
  }

  const outcomes = recent
    .map((r: { outcome_directionally_correct: boolean | null }) => r.outcome_directionally_correct)
    .filter((x): x is boolean => x === true || x === false);
  if (outcomes.length < MIN_SAMPLE_FOR_CALIBRATION) return 0;

  const wins = outcomes.filter(Boolean).length;
  const rate = wins / outcomes.length;

  const { data: botRow, error: botErr } = await supabaseAdmin
    .from("bot_settings")
    .select("id, min_ai_confidence, min_ai_confidence_trending, min_ai_confidence_ranging")
    .eq("id", botId)
    .maybeSingle();

  if (botErr || !botRow) return 0;

  const base = Math.max(
    1,
    Math.min(100, Number((botRow as { min_ai_confidence?: number }).min_ai_confidence) || 78),
  );

  if (regime === "RANGING" && rate < RANGING_BAD_RATE) {
    const cur =
      (botRow as { min_ai_confidence_ranging?: number | null }).min_ai_confidence_ranging ?? base;
    const next = Math.min(92, Math.max(50, Math.round(cur + CALIBRATION_STEP)));
    if (next === cur) return 0;
    const { error: upErr } = await supabaseAdmin
      .from("bot_settings")
      .update({
        min_ai_confidence_ranging: next,
        updated_at: new Date().toISOString(),
      })
      .eq("id", botId);
    if (upErr) return 0;
    return CALIBRATION_STEP;
  }

  if (regime === "TRENDING" && rate > TRENDING_GOOD_RATE) {
    const cur =
      (botRow as { min_ai_confidence_trending?: number | null }).min_ai_confidence_trending ??
      base;
    const next = Math.max(52, Math.min(90, Math.round(cur - CALIBRATION_STEP)));
    if (next === cur) return 0;
    const { error: upErr } = await supabaseAdmin
      .from("bot_settings")
      .update({
        min_ai_confidence_trending: next,
        updated_at: new Date().toISOString(),
      })
      .eq("id", botId);
    if (upErr) return 0;
    return -CALIBRATION_STEP;
  }

  return 0;
}

/**
 * 24h post-close BUY post-mortem: forward return vs entry, memory row, optional
 * regime-specific `min_ai_confidence_*` calibration on `bot_settings`.
 */
export async function runPostMortemProcessor(): Promise<PostMortemRunResult> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return {
      ok: false,
      evaluated: 0,
      skipped: 0,
      calibrationUpdates: 0,
      actions: [],
      message: "Supabase admin client is not configured",
    };
  }

  const candidates = await listCandidateClosedBuys();
  if (candidates.length === 0) {
    return {
      ok: true,
      evaluated: 0,
      skipped: 0,
      calibrationUpdates: 0,
      actions: ["no_candidate_trades"],
    };
  }

  const actions: string[] = [];
  const touchedBotIds = new Set<string>();
  let evaluated = 0;
  let skipped = 0;
  let calibrationUpdates = 0;

  for (const trade of candidates) {
    const userId = toUserId(trade.user_id);
    const entry = toNumber(trade.entryPrice);
    const closedAt = trade.closed_at ? Date.parse(trade.closed_at) : NaN;
    if (!userId || entry === null || entry <= 0 || !Number.isFinite(closedAt)) {
      skipped += 1;
      continue;
    }

    const horizonAt = closedAt + HORIZON_MS;
    const px = await fetchBinanceHourlyCloseNear(trade.symbol, horizonAt);
    if (px === null || !Number.isFinite(px)) {
      skipped += 1;
      actions.push(`${trade.id}:no_price_at_horizon`);
      continue;
    }

    const actualReturnPct = ((px - entry) / entry) * 100;
    const correct = actualReturnPct > 0.12;

    const parsed = parseAiReasoning(trade.ai_reasoning ?? null);
    const regime = String(parsed?.market_regime ?? "NEUTRAL").toUpperCase();
    const predicted =
      parsed?.effective_confidence ??
      parsed?.raw_weighted_confidence ??
      null;

    const extra = (trade.extra ?? {}) as Record<string, unknown>;
    const botIdRaw = extra.bot_id;
    const botId =
      typeof botIdRaw === "string" && botIdRaw.length > 0
        ? botIdRaw
        : typeof botIdRaw === "number"
        ? String(botIdRaw)
        : null;

    const atr = toNumber(extra.atr14_at_entry);
    const marketTags: Record<string, unknown> = {};
    if (atr !== null && atr > 0 && entry > 0 && atr / entry > 0.025) {
      marketTags.high_volatility = true;
    }

    const { error: insErr } = await supabaseAdmin.from("ai_performance_memory").insert({
      user_id: userId,
      bot_id: botId,
      trade_id: trade.id,
      symbol: trade.symbol,
      market_regime: regime,
      market_tags: marketTags,
      predicted_confidence: predicted,
      entry_price: entry,
      exit_price: toNumber(trade.exitPrice),
      trade_closed_at: new Date(closedAt).toISOString(),
      horizon_target_at: new Date(horizonAt).toISOString(),
      price_at_horizon: px,
      actual_return_24h_pct: Number(actualReturnPct.toFixed(4)),
      outcome_directionally_correct: correct,
      calibration_delta_pct: 0,
      notes: `post_mortem_24h_entry_to_horizon_close`,
    });

    if (insErr) {
      if (isRelationMissingError(insErr.message, "ai_performance_memory")) {
        return {
          ok: false,
          evaluated,
          skipped,
          calibrationUpdates,
          actions,
          message: insErr.message,
        };
      }
      skipped += 1;
      actions.push(`${trade.id}:insert_failed:${insErr.message}`);
      continue;
    }

    evaluated += 1;
    if (botId) touchedBotIds.add(botId);
    actions.push(
      `${trade.id}:${trade.symbol}:ret=${actualReturnPct.toFixed(2)}%:ok=${correct}:reg=${regime}`,
    );
  }

  for (const bid of touchedBotIds) {
    for (const reg of ["RANGING", "TRENDING"] as const) {
      const d = await maybeCalibrateBotThresholds({ botId: bid, regime: reg });
      if (d !== 0) calibrationUpdates += 1;
    }
  }

  return {
    ok: true,
    evaluated,
    skipped,
    calibrationUpdates,
    actions,
  };
}
