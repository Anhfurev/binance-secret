// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { toStringValue } from "./utils.ts";
import { sendTelegramAlert } from "./notifier.ts";

type LogLevel = "info" | "warn" | "error";

const COLORS: Record<LogLevel, string> = {
  info: "\x1b[36m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};
const RESET = "\x1b[0m";

export async function logTradeAction(params: {
  supabase: ReturnType<typeof createClient>;
  action: string;
  data: Record<string, unknown>;
  level?: LogLevel;
  userId?: string;
  symbol?: string;
  source?: string;
}) {
  const {
    supabase,
    action,
    data,
    level = "info",
    userId,
    symbol,
    source = "trading-bot",
  } = params;

  const timestamp = new Date().toISOString();
  const color = COLORS[level] ?? COLORS.info;
  const pretty = `${color}[${timestamp}] [${level.toUpperCase()}] ${action}${RESET} ${JSON.stringify(data)}`;
  console.log(pretty);

  const payload = {
    user_id: userId ?? null,
    symbol: symbol ?? null,
    level,
    source,
    message: action,
    meta: data,
    created_at: timestamp,
  };

  const result = await supabase.from("logs").insert([payload]);
  if (result.error) {
    console.error(`[binance-bot] failed to write logs table: ${result.error.message}`);
  }
}

export async function logCcxtOrderError(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  error: unknown;
}) {
  const { supabase, userId, symbol, side, amount, error } = params;
  const errorName = toStringValue((error as any)?.name) ?? "UnknownError";
  const errorMessage = toStringValue((error as any)?.message) ?? String(error);
  const isHandled =
    errorName === "InsufficientFunds" ||
    errorName === "InvalidOrder" ||
    errorName === "NetworkError";
  if (!isHandled) return;

  await logTradeAction({
    supabase,
    action: `[${errorName}] ${errorMessage}`,
    level: "error",
    userId,
    symbol,
    source: "ccxt",
    data: {
      side,
      amount,
      error_name: errorName,
    },
  });

  await sendTelegramAlert(
    `*Critical Trading Error*\n` +
      `Symbol: \`${symbol}\`\n` +
      `Side: \`${side}\`\n` +
      `Amount: \`${amount}\`\n` +
      `Error: \`${errorName}\`\n` +
      `Detail: ${errorMessage}`,
  );
}

export async function sendNotification(message: string) {
  // Placeholder for future Telegram/Discord/Slack webhook integration.
  console.log(`[notification-placeholder] ${message}`);
}

