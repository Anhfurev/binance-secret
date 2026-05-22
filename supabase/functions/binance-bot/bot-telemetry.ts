// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { fireAndForgetLogsInsert, fireAndForgetTableInsert } from "./async-supabase-writes.ts";
import { fireAndForgetSideEffect } from "./edge-runtime.ts";
import { shouldPersistBotCycleTelemetryLog } from "./log-policy.ts";

/** HOLD/SKIP used to insert one account_balances row per symbol per minute → DB bloat. */
function shouldPersistBalanceSnapshot(
  action: "buy" | "sell" | "hold" | "skip",
): boolean {
  if (action === "buy" || action === "sell") return true;
  return String(Deno.env.get("TELEMETRY_ACCOUNT_BALANCE_ON_HOLD") ?? "")
    .trim() === "1";
}

export function persistRunTelemetry(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  action: "buy" | "sell" | "hold" | "skip";
  detail: string;
  balance: number;
}) {
  fireAndForgetSideEffect(
    `persist_run_telemetry_${params.symbol}_${params.action}`,
    () => persistRunTelemetryInner(params),
  );
}

async function persistRunTelemetryInner(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  action: "buy" | "sell" | "hold" | "skip";
  detail: string;
  balance: number;
}) {
  const { supabase, userId, symbol, action, detail, balance } = params;
  const nowIso = new Date().toISOString();

  if (shouldPersistBalanceSnapshot(action)) {
    fireAndForgetTableInsert(supabase, "account_balances", {
      user_id: userId,
      balance: Number(balance.toFixed(2)),
      timestamp: nowIso,
      extra: { symbol, action, detail },
    }, `balance_${symbol}_${action}`);
  }

  if (shouldPersistBotCycleTelemetryLog(action)) {
    fireAndForgetLogsInsert(supabase, {
      user_id: userId,
      symbol,
      level: "info",
      source: "bot-cycle",
      message: `action_${action}`,
      meta: { detail, balance: Number(balance.toFixed(2)) },
      created_at: nowIso,
    }, `bot_cycle_${action}`);
  }
}
