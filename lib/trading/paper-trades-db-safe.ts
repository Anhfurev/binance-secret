import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export type PaperTradesSchemaMode = "unified" | "legacy";

let bindingLogged = false;

/** Locked on first module load — no unified probe on legacy VPS unless env says unified. */
let cachedSchemaMode: PaperTradesSchemaMode | null = null;
let schemaInitPromise: Promise<PaperTradesSchemaMode> | null = null;

const DEBUG = String(process.env.PAPER_DB_DEBUG ?? "").trim() === "1";

function resolveTradesSchemaModeFromEnv(): PaperTradesSchemaMode | "auto" | null {
  const env = String(process.env.PAPER_TRADES_SCHEMA ?? "").trim().toLowerCase();
  if (env === "unified") return "unified";
  if (env === "legacy") return "legacy";
  if (env === "auto") return "auto";
  return null;
}

export const TRADES_UNIFIED_SELECT =
  "id,user_id,symbol,side,entry_price,exit_price,qty,raw_pnl,fees,net_pnl,strategy_executed,closed_at";

export const TRADES_LEGACY_SELECT =
  "id,user_id,symbol,type,entryPrice,exitPrice,amount,value,status,pnl,pnlPercent,opened_at,closed_at,exit_reason,notes,extra";

function maskSupabaseHost(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.hostname.slice(0, 12)}…${u.pathname}`;
  } catch {
    return "(invalid-url)";
  }
}

function isSchemaMismatchError(message: string): boolean {
  return (
    /column\s+.+\s+does not exist/i.test(message) ||
    /42703/.test(message) ||
    /Could not find the '[^']+' column/i.test(message)
  );
}

function debugLog(message: string, extra?: Record<string, unknown>): void {
  if (!DEBUG) return;
  console.log(message, extra ?? "");
}

async function probeTradesSchemaOnce(): Promise<PaperTradesSchemaMode> {
  if (!supabaseAdmin) return "legacy";

  const { error } = await supabaseAdmin.from("trades").select("side").limit(1);
  if (!error) return "unified";
  if (isSchemaMismatchError(error.message)) {
    debugLog("[paper-db] Falling back to legacy schema mapping");
    return "legacy";
  }
  return "legacy";
}

async function initSchemaCacheOnce(): Promise<PaperTradesSchemaMode> {
  if (cachedSchemaMode) return cachedSchemaMode;

  const fromEnv = resolveTradesSchemaModeFromEnv();
  if (fromEnv === "unified") {
    cachedSchemaMode = "unified";
    debugLog("[paper-db] trades schema: unified (env)");
    return cachedSchemaMode;
  }
  if (fromEnv === "legacy" || fromEnv === null) {
    cachedSchemaMode = "legacy";
    debugLog("[paper-db] trades schema: legacy (default)");
    return cachedSchemaMode;
  }

  const probed = await probeTradesSchemaOnce();
  cachedSchemaMode = probed;
  debugLog(`[paper-db] trades schema: ${probed} (auto-probe)`);
  return cachedSchemaMode;
}

void initSchemaCacheOnce();

function ensureTradesSchemaMode(): PaperTradesSchemaMode {
  if (cachedSchemaMode) return cachedSchemaMode;
  return "legacy";
}

async function ensureTradesSchemaModeAsync(): Promise<PaperTradesSchemaMode> {
  if (cachedSchemaMode) return cachedSchemaMode;
  if (!schemaInitPromise) {
    schemaInitPromise = initSchemaCacheOnce();
  }
  return schemaInitPromise;
}

export function logPaperDbBinding(): void {
  if (bindingLogged) return;
  bindingLogged = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const hasService = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const paperUser = String(process.env.PAPER_TRADES_USER_ID ?? "").trim();

  console.log("[paper-db] Supabase binding", {
    url: url ? maskSupabaseHost(url) : "(missing NEXT_PUBLIC_SUPABASE_URL)",
    adminReady: isSupabaseAdminConfigured && Boolean(supabaseAdmin),
    tradesSchemaMode: cachedSchemaMode ?? "legacy (pending-init)",
    paperTradesUserId: paperUser ? `${paperUser.slice(0, 8)}…` : "(unset)",
  });
}

export function getPaperTradesSchemaMode(): PaperTradesSchemaMode | null {
  return cachedSchemaMode;
}

function logTradesQueryError(
  op: string,
  userId: string,
  message: string,
): void {
  if (isSchemaMismatchError(message)) return;
  console.error(`[paper-db] trades ${op} failed`, {
    userId: `${userId.slice(0, 8)}…`,
    schemaMode: cachedSchemaMode ?? "legacy",
    message,
  });
}

async function fetchClosedTradesLegacy(
  userId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("*")
    .eq("user_id", userId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(limit);

  if (error) {
    logTradesQueryError("fetch-closed-legacy", userId, error.message);
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}

async function fetchClosedTradesUnified(
  userId: string,
  limit: number,
): Promise<Record<string, unknown>[]> {
  if (!supabaseAdmin) return [];

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select(TRADES_UNIFIED_SELECT)
    .eq("user_id", userId)
    .not("closed_at", "is", null)
    .order("closed_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isSchemaMismatchError(error.message)) {
      cachedSchemaMode = "legacy";
      return fetchClosedTradesLegacy(userId, limit);
    }
    logTradesQueryError("fetch-closed-unified", userId, error.message);
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}

export async function safeFetchPaperClosedTrades(
  userId: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  if (!supabaseAdmin || !userId) return [];

  try {
    await ensureTradesSchemaModeAsync();
    const mode = ensureTradesSchemaMode();
    return mode === "legacy"
      ? fetchClosedTradesLegacy(userId, limit)
      : fetchClosedTradesUnified(userId, limit);
  } catch {
    return [];
  }
}

async function aggregatePnlLegacy(
  userId: string,
): Promise<{ lifetimeRealizedPnlUsdt: number; closedTradeCount: number }> {
  if (!supabaseAdmin) {
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("pnl,status")
    .eq("user_id", userId)
    .in("status", ["closed", "stopped"]);

  if (error) {
    logTradesQueryError("aggregate-legacy", userId, error.message);
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }

  let sum = 0;
  let count = 0;
  for (const row of data ?? []) {
    sum += Number(row.pnl) || 0;
    count += 1;
  }
  return {
    lifetimeRealizedPnlUsdt: Number(sum.toFixed(4)),
    closedTradeCount: count,
  };
}

async function aggregatePnlUnified(
  userId: string,
): Promise<{ lifetimeRealizedPnlUsdt: number; closedTradeCount: number }> {
  if (!supabaseAdmin) {
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }

  const { data, error } = await supabaseAdmin
    .from("trades")
    .select("net_pnl")
    .eq("user_id", userId)
    .not("closed_at", "is", null);

  if (error) {
    if (isSchemaMismatchError(error.message)) {
      cachedSchemaMode = "legacy";
      return aggregatePnlLegacy(userId);
    }
    logTradesQueryError("aggregate-unified", userId, error.message);
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }

  let sum = 0;
  let count = 0;
  for (const row of data ?? []) {
    sum += Number(row.net_pnl) || 0;
    count += 1;
  }
  return {
    lifetimeRealizedPnlUsdt: Number(sum.toFixed(4)),
    closedTradeCount: count,
  };
}

export async function safeFetchTradesPnlAggregate(
  userId: string,
): Promise<{ lifetimeRealizedPnlUsdt: number; closedTradeCount: number }> {
  if (!supabaseAdmin || !userId) {
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }

  try {
    await ensureTradesSchemaModeAsync();
    const mode = ensureTradesSchemaMode();
    return mode === "legacy"
      ? aggregatePnlLegacy(userId)
      : aggregatePnlUnified(userId);
  } catch {
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }
}

async function findLegacyRowId(
  userId: string,
  strategyKey: string,
): Promise<string | null> {
  const legId = strategyKey.split("|")[0] ?? strategyKey;
  const { data, error } = await supabaseAdmin!
    .from("trades")
    .select("id")
    .eq("user_id", userId)
    .filter("extra->>paper_leg_id", "eq", legId)
    .limit(1)
    .maybeSingle();

  if (error) {
    logTradesQueryError("lookup-legacy", userId, error.message);
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

async function findUnifiedRowId(
  userId: string,
  strategyKey: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin!
    .from("trades")
    .select("id")
    .eq("user_id", userId)
    .eq("strategy_executed", strategyKey)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isSchemaMismatchError(error.message)) {
      cachedSchemaMode = "legacy";
      return findLegacyRowId(userId, strategyKey);
    }
    logTradesQueryError("lookup-unified", userId, error.message);
    return null;
  }
  return typeof data?.id === "string" ? data.id : null;
}

export async function safeFindClosedTradeRowId(
  userId: string,
  strategyKey: string,
): Promise<string | null> {
  if (!supabaseAdmin || !userId || !strategyKey) return null;

  try {
    await ensureTradesSchemaModeAsync();
    const mode = ensureTradesSchemaMode();
    return mode === "legacy"
      ? findLegacyRowId(userId, strategyKey)
      : findUnifiedRowId(userId, strategyKey);
  } catch {
    return null;
  }
}

export async function safeUpsertClosedTradeRow(
  unifiedRow: Record<string, unknown>,
  legacyRow: Record<string, unknown>,
): Promise<boolean> {
  if (!supabaseAdmin) return false;

  const userId = String(unifiedRow.user_id ?? legacyRow.user_id ?? "");
  const strategyForLookup =
    typeof unifiedRow.strategy_executed === "string"
      ? unifiedRow.strategy_executed
      : `${String((legacyRow.extra as Record<string, unknown>)?.paper_leg_id ?? "")}|paper-scalp`;

  try {
    await ensureTradesSchemaModeAsync();
    const mode = ensureTradesSchemaMode();
    const primary = mode === "legacy" ? legacyRow : unifiedRow;
    const fallback = mode === "legacy" ? unifiedRow : legacyRow;

    const existingId = await safeFindClosedTradeRowId(userId, strategyForLookup);

    if (existingId) {
      const { error } = await supabaseAdmin
        .from("trades")
        .update(primary)
        .eq("id", existingId);
      if (error && isSchemaMismatchError(error.message)) {
        cachedSchemaMode = "legacy";
        const { error: err2 } = await supabaseAdmin
          .from("trades")
          .update(fallback)
          .eq("id", existingId);
        if (err2 && !isSchemaMismatchError(err2.message)) {
          logTradesQueryError("update-fallback", userId, err2.message);
        }
        return !err2;
      }
      if (error) {
        logTradesQueryError("update", userId, error.message);
        return false;
      }
      return true;
    }

    const { error } = await supabaseAdmin.from("trades").insert([primary]);
    if (error && isSchemaMismatchError(error.message)) {
      cachedSchemaMode = "legacy";
      const { error: err2 } = await supabaseAdmin.from("trades").insert([fallback]);
      if (err2 && !isSchemaMismatchError(err2.message)) {
        logTradesQueryError("insert-fallback", userId, err2.message);
      }
      return !err2;
    }
    if (error) {
      logTradesQueryError("insert", userId, error.message);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}
