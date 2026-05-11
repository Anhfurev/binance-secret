// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { escapeHtml } from "./bot-shared.ts";
import { sendTelegramAlert } from "./notifier.ts";
import { pollTelegramCommandUpdate } from "./telegram-poll.ts";
import {
  formatSignedUsd,
  loadWalletSummary,
} from "./telegram-wallet-summary.ts";

const WALLET_COMMANDS = ["/status", "/wallet"];

type OpenTradeRow = {
  symbol?: string | null;
  amount?: number | string | null;
  value?: number | string | null;
  entryPrice?: number | string | null;
};

export { formatSignedUsd } from "./telegram-wallet-summary.ts";

export function buildTelegramWalletStatusMessage(params: {
  demoBalance: number;
  startingBalance: number;
  accountPnl: number;
  realizedPnl: number;
  liveBalance: number | null;
  openTrades: OpenTradeRow[];
}) {
  const {
    demoBalance,
    startingBalance,
    accountPnl,
    realizedPnl,
    liveBalance,
    openTrades,
  } = params;

  const walletLines = [
    `💰 <b>WALLET &amp; PnL</b>`,
    `<b>Paper balance:</b> ${demoBalance.toFixed(2)} USDT`,
    `<b>Starting balance:</b> ${startingBalance.toFixed(2)} USDT`,
    `<b>Account PnL:</b> ${formatSignedUsd(accountPnl)}`,
    `<b>Realized (closed trades):</b> ${formatSignedUsd(realizedPnl)}`,
  ];
  if (liveBalance != null && liveBalance > 0) {
    walletLines.push(
      `<b>Live Binance:</b> ${liveBalance.toFixed(2)} USDT`,
    );
  }

  const header =
    `📊 <b>OPEN POSITIONS</b>\nTotal Open: ${openTrades.length}`;
  const body = openTrades.length === 0
    ? "\nNo open positions right now."
    : `\n${
      openTrades
        .map((trade) =>
          `• ${escapeHtml(String(trade.symbol ?? "UNKNOWN"))} | qty=${
            Number(trade.amount ?? 0).toFixed(4)
          } | value=${Number(trade.value ?? 0).toFixed(2)} USDT | entry=${
            Number(trade.entryPrice ?? 0).toFixed(8)
          }`
        )
        .join("\n")
    }`;

  return `${walletLines.join("\n")}\n\n${header}${body}`;
}

export async function maybeHandleTelegramWalletStatusCommand(
  supabase: ReturnType<typeof createClient>,
) {
  const latestUpdate = await pollTelegramCommandUpdate(supabase, WALLET_COMMANDS);
  if (!latestUpdate?.updateId) return;

  const marker = `status_handled_${latestUpdate.updateId}`;
  const alreadyHandled = await supabase
    .from("logs")
    .select("id")
    .eq("source", "telegram-command")
    .eq("message", marker)
    .limit(1)
    .maybeSingle();
  if (alreadyHandled.data) return;

  const [walletSummary, openTradesResult] = await Promise.all([
    loadWalletSummary(supabase),
    supabase
      .from("trades")
      .select("symbol, amount, value, entryPrice, opened_at")
      .ilike("status", "open")
      .order("opened_at", { ascending: false })
      .limit(20),
  ]);

  const openTrades = Array.isArray(openTradesResult.data)
    ? openTradesResult.data
    : [];
  const message = buildTelegramWalletStatusMessage({
    ...walletSummary,
    openTrades,
  });
  await sendTelegramAlert(message);

  await supabase.from("logs").insert([{
    level: "info",
    source: "telegram-command",
    message: marker,
    meta: {
      event: "status_command_handled",
      update_id: latestUpdate.updateId,
      command: latestUpdate.command,
      open_positions: openTrades.length,
      demo_balance: walletSummary.demoBalance,
      account_pnl: walletSummary.accountPnl,
      realized_pnl: walletSummary.realizedPnl,
    },
    created_at: new Date().toISOString(),
  }]);
}
