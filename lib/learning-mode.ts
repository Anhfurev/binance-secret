import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { runPostMortemProcessor } from "@/lib/post-mortem-learning";
import { runFeatureWeightLearning } from "@/lib/score-weight-learning";

const LEARNING_MODE_LOG_MESSAGE =
  "AI Strategy Adjusted for Market Volatility";
const DEFAULT_LOOKBACK_TRADES = 100;
const DEFAULT_STOP_LOSS_TIGHTEN_PCT = 1;

type TradeRow = Record<string, unknown> & {
  id?: string | number;
  user_id?: string | null;
  pnl?: number | string | null;
  type?: string | null;
  status?: string | null;
  entryPrice?: number | string | null;
  stopLoss?: number | string | null;
  notes?: string | null;
  opened_at?: string | null;
};

type UserIdRow = {
  user_id?: string | null;
};

export interface LearningModeRunResult {
  ok: boolean;
  scannedUsers: number;
  adjustedUsers: number;
  adjustedTrades: number;
  actions: string[];
  message?: string;
  postMortem?: Awaited<ReturnType<typeof runPostMortemProcessor>>;
  featureWeights?: Awaited<ReturnType<typeof runFeatureWeightLearning>>;
}

function isRelationMissingError(message: string, table: string) {
  return (
    message.includes(table) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("relation"))
  );
}

function toNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function toUserId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function getTradeDirection(trade: TradeRow) {
  const type = typeof trade.type === "string" ? trade.type.toLowerCase() : "";
  return type === "sell" ? "short" : "long";
}

function tightenStopLoss(trade: TradeRow, tightenPct: number) {
  const entryPrice = toNumber(trade.entryPrice);
  const currentStopLoss = toNumber(trade.stopLoss);

  if (!entryPrice || !currentStopLoss || entryPrice <= 0 || currentStopLoss <= 0) {
    return null;
  }

  const adjustment = entryPrice * (tightenPct / 100);
  if (adjustment <= 0) {
    return null;
  }

  const nextStopLoss =
    getTradeDirection(trade) === "short"
      ? Math.max(entryPrice, currentStopLoss - adjustment)
      : Math.min(entryPrice, currentStopLoss + adjustment);

  if (Math.abs(nextStopLoss - currentStopLoss) < Math.max(entryPrice * 1e-8, 1e-8)) {
    return null;
  }

  return Number(nextStopLoss.toFixed(entryPrice >= 1 ? 4 : 6));
}

function buildAdjustedNotes(existingNotes: unknown) {
  const notes = typeof existingNotes === "string" ? existingNotes.trim() : "";
  const stampedMessage = `${LEARNING_MODE_LOG_MESSAGE} @ ${new Date().toISOString()}`;
  return notes ? `${notes}\n${stampedMessage}` : stampedMessage;
}

async function listCandidateUserIds() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return [];
  }

  const userIds = new Set<string>();

  const tradeUsersResult = await supabaseAdmin
    .from("trades")
    .select("user_id")
    .not("user_id", "is", null)
    .order("opened_at", { ascending: false })
    .limit(500);

  if (tradeUsersResult.error) {
    if (isRelationMissingError(tradeUsersResult.error.message, "trades")) {
      return [];
    }

    throw tradeUsersResult.error;
  }

  for (const row of (tradeUsersResult.data ?? []) as UserIdRow[]) {
    const userId = toUserId(row.user_id);
    if (userId) {
      userIds.add(userId);
    }
  }

  return [...userIds];
}

async function fetchRecentCompletedTrades(userId: string) {
  const { data, error } = await supabaseAdmin!
    .from("trades")
    .select("id, user_id, pnl, type, status, entryPrice, stopLoss, notes, opened_at")
    .eq("user_id", userId)
    .not("pnl", "is", null)
    .order("opened_at", { ascending: false })
    .limit(DEFAULT_LOOKBACK_TRADES);

  if (error) {
    if (isRelationMissingError(error.message, "trades")) {
      return [];
    }

    throw error;
  }

  return (data ?? []) as TradeRow[];
}

async function fetchOpenTrades(userId: string) {
  const { data, error } = await supabaseAdmin!
    .from("trades")
    .select("id, user_id, type, status, entryPrice, stopLoss, notes")
    .eq("user_id", userId)
    .ilike("status", "open");

  if (error) {
    if (isRelationMissingError(error.message, "trades")) {
      return [];
    }

    throw error;
  }

  return (data ?? []) as TradeRow[];
}

async function adjustOpenTradeStopLosses(userId: string) {
  const openTrades = await fetchOpenTrades(userId);
  let adjustedTrades = 0;

  for (const trade of openTrades) {
    const nextStopLoss = tightenStopLoss(
      trade,
      DEFAULT_STOP_LOSS_TIGHTEN_PCT,
    );

    if (nextStopLoss === null || trade.id === undefined || trade.id === null) {
      continue;
    }

    const { error } = await supabaseAdmin!
      .from("trades")
      .update({
        stopLoss: nextStopLoss,
        notes: buildAdjustedNotes(trade.notes),
      })
      .eq("id", trade.id);

    if (error) {
      throw error;
    }

    adjustedTrades += 1;
  }

  return adjustedTrades;
}

export async function runLearningMode(): Promise<LearningModeRunResult> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return {
      ok: false,
      scannedUsers: 0,
      adjustedUsers: 0,
      adjustedTrades: 0,
      actions: [],
      message: "Supabase admin client is not configured",
      featureWeights: undefined,
    };
  }

  let postMortem: Awaited<ReturnType<typeof runPostMortemProcessor>> | undefined;
  try {
    postMortem = await runPostMortemProcessor();
  } catch (e) {
    postMortem = {
      ok: false,
      evaluated: 0,
      skipped: 0,
      calibrationUpdates: 0,
      actions: [],
      message: e instanceof Error ? e.message : String(e),
    };
  }

  let featureWeights: Awaited<ReturnType<typeof runFeatureWeightLearning>> | undefined;
  try {
    featureWeights = await runFeatureWeightLearning();
  } catch (e) {
    featureWeights = {
      ok: false,
      botsScanned: 0,
      profilesAdjusted: 0,
      actions: [],
      message: e instanceof Error ? e.message : String(e),
    };
  }

  const candidateUserIds = await listCandidateUserIds();
  const actions: string[] = [];
  let adjustedUsers = 0;
  let adjustedTrades = 0;

  for (const userId of candidateUserIds) {
    const recentTrades = await fetchRecentCompletedTrades(userId);
    if (recentTrades.length === 0) {
      continue;
    }

    const wins = recentTrades.filter((trade) => (toNumber(trade.pnl) ?? 0) > 0).length;
    const winRate = (wins / recentTrades.length) * 100;

    if (winRate >= 50) {
      continue;
    }

    const userAdjustedTrades = await adjustOpenTradeStopLosses(userId);
    if (userAdjustedTrades === 0) {
      actions.push(`${userId}:below-threshold-no-open-trades`);
      continue;
    }

    adjustedUsers += 1;
    adjustedTrades += userAdjustedTrades;
    actions.push(
      `${userId}:${LEARNING_MODE_LOG_MESSAGE}:win-rate=${winRate.toFixed(2)}%:trades=${userAdjustedTrades}`,
    );
  }

  return {
    ok: true,
    scannedUsers: candidateUserIds.length,
    adjustedUsers,
    adjustedTrades,
    actions,
    postMortem,
    featureWeights,
  };
}

export { LEARNING_MODE_LOG_MESSAGE };