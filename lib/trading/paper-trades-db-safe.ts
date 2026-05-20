import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export type PaperTradesSchemaMode = "unified" | "legacy";

let bindingLogged = false;
let tradesSchemaMode: PaperTradesSchemaMode | null = null;

/** Unified clean-slate columns (snake_case). */
export const TRADES_UNIFIED_SELECT =
  "id,user_id,symbol,side,entry_price,exit_price,qty,raw_pnl,fees,net_pnl,strategy_executed,closed_at";

/** Production legacy columns (camelCase quoted in Postgres). */
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
    },
    paperTradesUserId: paperUser ? `${paperUser.slice(0, 8)}…` : "(unset)",
    tradesSchemaMode: tradesSchemaMode ?? "auto-detect",
  });
}

export function getPaperTradesSchemaMode(): PaperTradesSchemaMode | null {
  return tradesSchemaMode;
}

function isSchemaMismatchError(message: string): boolean {
  return (
    /column\s+.+\s+does not exist/i.test(message) ||
    /42703/.test(message) ||
    /Could not find the '[^']+' column/i.test(message)
  );
}

function logTradesQueryError(
  op: string,
  userId: string,
  message: string,
  mode: PaperTradesSchemaMode,
): void {
  console.error(`[paper-db] trades ${op} failed`, {
    userId: `${userId.slice(0, 8)}…`,
    schemaMode: mode,
    message,
  });
}

/**
 * Closed paper trade rows — never throws; returns [] on any failure.
 */
export async function safeFetchPaperClosedTrades(
  userId: string,
  limit = 200,
): Promise<Record<string, unknown>[]> {
  logPaperDbBinding();
  if (!supabaseAdmin || !userId) return [];

  const mode: PaperTradesSchemaMode = tradesSchemaMode ?? "unified";
  const select =
    mode === "legacy" ? TRADES_LEGACY_SELECT : TRADES_UNIFIED_SELECT;

  try {
    const query = supabaseAdmin
      .from("trades")
      .select(select)
      .eq("user_id", userId)
      .not("closed_at", "is", null)
      .order("closed_at", { ascending: false })
      .limit(limit);

    const { data, error } = await query;

    if (error) {
      if (mode === "unified" && isSchemaMismatchError(error.message)) {
        tradesSchemaMode = "legacy";
        console.error(
          "[paper-db] trades table uses legacy schema — switching reads to entryPrice/amount/pnl",
          { message: error.message },
        );
        return safeFetchPaperClosedTrades(userId, limit);
      }
      logTradesQueryError("fetch-closed", userId, error.message, mode);
      return [];
    }

    if (!tradesSchemaMode) tradesSchemaMode = mode;
    return (data ?? []) as Record<string, unknown>[];
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-db] trades fetch-closed exception", {
      userId: `${userId.slice(0, 8)}…`,
      message: err.message,
    });
    return [];
  }
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

  const mode: PaperTradesSchemaMode = tradesSchemaMode ?? "unified";

  try {
    if (mode === "legacy") {
      const { data, error } = await supabaseAdmin
        .from("trades")
        .select("pnl,status")
        .eq("user_id", userId)
        .in("status", ["closed", "stopped"]);

      if (error) {
        logTradesQueryError("aggregate-legacy", userId, error.message, mode);
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

    const { data, error } = await supabaseAdmin
      .from("trades")
      .select("net_pnl")
      .eq("user_id", userId)
      .not("closed_at", "is", null);

    if (error) {
      if (isSchemaMismatchError(error.message)) {
        tradesSchemaMode = "legacy";
        console.error(
          "[paper-db] net_pnl missing — using legacy pnl aggregate",
          { message: error.message },
        );
        return safeFetchTradesPnlAggregate(userId);
      }
      logTradesQueryError("aggregate-unified", userId, error.message, mode);
      return { lifetimeRealizedPnlUsdt: 0, closedTradeCount: 0 };
    }

    if (!tradesSchemaMode) tradesSchemaMode = "unified";

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

  const mode: PaperTradesSchemaMode = tradesSchemaMode ?? "unified";

  try {
    if (mode === "legacy") {
      const legId = strategyKey.split("|")[0] ?? strategyKey;
      const { data, error } = await supabaseAdmin
        .from("trades")
        .select("id")
        .eq("user_id", userId)
        .filter("extra->>paper_leg_id", "eq", legId)
        .limit(1)
        .maybeSingle();

      if (error) {
        if (isSchemaMismatchError(error.message)) {
          tradesSchemaMode = "unified";
          return safeFindClosedTradeRowId(userId, strategyKey);
        }
        logTradesQueryError("lookup-legacy", userId, error.message, mode);
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
        tradesSchemaMode = "legacy";
        return safeFindClosedTradeRowId(userId, strategyKey);
      }
      logTradesQueryError("lookup-unified", userId, error.message, mode);
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
    const mode: PaperTradesSchemaMode = tradesSchemaMode ?? "unified";
    const existingId = await safeFindClosedTradeRowId(userId, strategyForLookup);

    const writeRow = mode === "legacy" ? legacyRow : unifiedRow;

    if (existingId) {
      const { error } = await supabaseAdmin
        .from("trades")
        .update(writeRow)
        .eq("id", existingId);
      if (error) {
        if (mode === "unified" && isSchemaMismatchError(error.message)) {
          tradesSchemaMode = "legacy";
          return safeUpsertClosedTradeRow(unifiedRow, legacyRow);
        }
        logTradesQueryError("update", userId, error.message, mode);
        return false;
      }
      return true;
    }

    const { error } = await supabaseAdmin.from("trades").insert([writeRow]);
    if (error) {
      if (mode === "unified" && isSchemaMismatchError(error.message)) {
        tradesSchemaMode = "legacy";
        console.error(
          "[paper-db] trades insert unified columns rejected — using legacy insert",
          { message: error.message },
        );
        return safeUpsertClosedTradeRow(unifiedRow, legacyRow);
      }
      logTradesQueryError("insert", userId, error.message, mode);
      return false;
    }
    if (!tradesSchemaMode) tradesSchemaMode = mode;
    return true;
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error("[paper-db] trades upsert exception", { message: err.message });
    return false;
  }
}
