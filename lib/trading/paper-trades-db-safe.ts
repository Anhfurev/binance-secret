import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export type PaperTradesSchemaMode = "unified" | "legacy";

let bindingLogged = false;
let schemaDetectLogged = false;

/** Production DB uses camelCase trades; unified only when migrated. */
function resolveTradesSchemaMode(): PaperTradesSchemaMode {
  const env = String(process.env.PAPER_TRADES_SCHEMA ?? "").trim().toLowerCase();
  if (env === "unified") return "unified";
  return "legacy";
}

let tradesSchemaMode: PaperTradesSchemaMode = resolveTradesSchemaMode();

/** Unified clean-slate columns (only when PAPER_TRADES_SCHEMA=unified). */
export const TRADES_UNIFIED_SELECT =
  "id,user_id,symbol,side,entry_price,exit_price,qty,raw_pnl,fees,net_pnl,strategy_executed,closed_at";

/** Production legacy columns (camelCase in Postgres). */
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

export function logPaperDbBinding(): void {
  if (bindingLogged) return;
  bindingLogged = true;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const hasService = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
  const paperUser = String(process.env.PAPER_TRADES_USER_ID ?? "").trim();

  console.log("[paper-db] Supabase binding", {
    url: url ? maskSupabaseHost(url) : "(missing NEXT_PUBLIC_SUPABASE_URL)",
    adminReady: isSupabaseAdminConfigured && Boolean(supabaseAdmin),
    envKeys: {
      NEXT_PUBLIC_SUPABASE_URL: Boolean(url),
      NEXT_PUBLIC_SUPABASE_ANON_KEY: Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
      ),
      SUPABASE_SERVICE_ROLE_KEY: hasService,
      PAPER_TRADES_USER_ID: paperUser.length > 0,
      PAPER_TRADES_SCHEMA: process.env.PAPER_TRADES_SCHEMA ?? "(default legacy)",
    },
    paperTradesUserId: paperUser ? `${paperUser.slice(0, 8)}…` : "(unset)",
    tradesSchemaMode,
  });
}

export function getPaperTradesSchemaMode(): PaperTradesSchemaMode {
  return tradesSchemaMode;
}

function isSchemaMismatchError(message: string): boolean {
  return (
    /column\s+.+\s+does not exist/i.test(message) ||
    /42703/.test(message) ||
    /Could not find the '[^']+' column/i.test(message)
  );
}

function lockSchemaMode(mode: PaperTradesSchemaMode, reason: string): void {
  if (tradesSchemaMode === mode && schemaDetectLogged) return;
  tradesSchemaMode = mode;
  if (!schemaDetectLogged) {
    schemaDetectLogged = true;
    console.log(`[paper-db] trades schema locked: ${mode} (${reason})`);
  }
}

function logTradesQueryError(
  op: string,
  userId: string,
  message: string,
): void {
  console.error(`[paper-db] trades ${op} failed`, {
    userId: `${userId.slice(0, 8)}…`,
    schemaMode: tradesSchemaMode,
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
  lockSchemaMode("legacy", "legacy select * ok");
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
      lockSchemaMode("legacy", "unified columns missing");
      return fetchClosedTradesLegacy(userId, limit);
    }
    logTradesQueryError("fetch-closed-unified", userId, error.message);
    return [];
  }
  lockSchemaMode("unified", "unified select ok");
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * Closed paper trade rows — never throws; returns [] on any failure.
 * Never selects trades.side / entry_price unless schema is unified.
 */
export async function safeFetchPaperClosedTrades(
  userId: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  logPaperDbBinding();
  if (!supabaseAdmin || !userId) return [];

  try {
    if (tradesSchemaMode === "legacy") {
      return await fetchClosedTradesLegacy(userId, limit);
    }
    return await fetchClosedTradesUnified(userId, limit);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-db] trades fetch-closed exception", {
      userId: `${userId.slice(0, 8)}…`,
      message: err.message,
    });
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
  lockSchemaMode("legacy", "legacy pnl aggregate ok");
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
      lockSchemaMode("legacy", "net_pnl missing");
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
  lockSchemaMode("unified", "unified net_pnl ok");
  return {
    lifetimeRealizedPnlUsdt: Number(sum.toFixed(4)),
    closedTradeCount: count,
  };
}

/**
 * Lifetime realized P&L aggregate — never throws.
 */
export async function safeFetchTradesPnlAggregate(
  userId: string,
): Promise<{ lifetimeRealizedPnlUsdt: number; closedTradeCount: number }> {
  logPaperDbBinding();
  if (!supabaseAdmin || !userId) {
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }

  try {
    if (tradesSchemaMode === "legacy") {
      return await aggregatePnlLegacy(userId);
    }
    return await aggregatePnlUnified(userId);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-db] trades aggregate exception", {
      userId: `${userId.slice(0, 8)}…`,
      message: err.message,
    });
    return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
  }
}

export async function safeFindClosedTradeRowId(
  userId: string,
  strategyKey: string,
): Promise<string | null> {
  if (!supabaseAdmin || !userId || !strategyKey) return null;

  try {
    if (tradesSchemaMode === "legacy") {
      const legId = strategyKey.split("|")[0] ?? strategyKey;
      const { data, error } = await supabaseAdmin
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

    const { data, error } = await supabaseAdmin
      .from("trades")
      .select("id")
      .eq("user_id", userId)
      .eq("strategy_executed", strategyKey)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (isSchemaMismatchError(error.message)) {
        lockSchemaMode("legacy", "strategy_executed missing");
        return safeFindClosedTradeRowId(userId, strategyKey);
      }
      logTradesQueryError("lookup-unified", userId, error.message);
      return null;
    }
    return typeof data?.id === "string" ? data.id : null;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-db] trades lookup exception", { message: err.message });
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
    const writeLegacyFirst = tradesSchemaMode === "legacy";
    const primary = writeLegacyFirst ? legacyRow : unifiedRow;
    const fallback = writeLegacyFirst ? unifiedRow : legacyRow;

    const existingId = await safeFindClosedTradeRowId(userId, strategyForLookup);

    if (existingId) {
      const { error } = await supabaseAdmin
        .from("trades")
        .update(primary)
        .eq("id", existingId);
      if (error && isSchemaMismatchError(error.message)) {
        lockSchemaMode(writeLegacyFirst ? "unified" : "legacy", "update fallback");
        const { error: err2 } = await supabaseAdmin
          .from("trades")
          .update(fallback)
          .eq("id", existingId);
        if (err2) {
          logTradesQueryError("update-fallback", userId, err2.message);
          return false;
        }
        return true;
      }
      if (error) {
        logTradesQueryError("update", userId, error.message);
        return false;
      }
      return true;
    }

    const { error } = await supabaseAdmin.from("trades").insert([primary]);
    if (error && isSchemaMismatchError(error.message)) {
      lockSchemaMode(writeLegacyFirst ? "unified" : "legacy", "insert fallback");
      const { error: err2 } = await supabaseAdmin.from("trades").insert([fallback]);
      if (err2) {
        logTradesQueryError("insert-fallback", userId, err2.message);
        return false;
      }
      return true;
    }
    if (error) {
      logTradesQueryError("insert", userId, error.message);
      return false;
    }
    return true;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-db] trades upsert exception", { message: err.message });
    return false;
  }
}
