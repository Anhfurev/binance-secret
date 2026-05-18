// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { upsertBotPerformance } from "./trade-store.ts";
import { sendTelegramAlert } from "./notifier.ts";
import {
  escapeHtml,
  formatTelegramPrice,
} from "./bot-shared.ts";
import { persistRunTelemetry } from "./bot-telemetry.ts";
import { syncProfilePortfolioHoldings } from "./portfolio-holdings-sync.ts";
import { botDebug } from "./bot-debug.ts";

export async function notifyFullSellClose(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  strategyNotes: string;
  ghostMode: boolean;
  pnl: number;
  pnlPercent: number;
  nextBalance: number;
  accountPnl: number;
  exitPx: number;
  soldBase: number;
  trailingStopTriggered: boolean;
  sellOrderId: string | null;
}) {
  const {
    supabase,
    userId,
    symbol,
    strategyNotes,
    ghostMode,
    pnl,
    pnlPercent,
    nextBalance,
    accountPnl,
    exitPx,
    soldBase,
    trailingStopTriggered,
    sellOrderId,
  } = params;
  if (!ghostMode) {
    await upsertBotPerformance(supabase, { userId, symbol, pnl });
  }
  await persistRunTelemetry({
    supabase,
    userId,
    symbol,
    action: "sell",
    detail: `SELL ${soldBase} @ ${exitPx.toFixed(8)} | pnl ${pnl.toFixed(2)}`,
    balance: nextBalance,
  });
  await syncProfilePortfolioHoldings({
    supabase,
    userId,
    availableUsdt: nextBalance,
    priceByBase: { [symbol.replace(/USDT$/, "")]: exitPx },
  });
  const trailNote = trailingStopTriggered
    ? `\n<b>Exit driver:</b> trailing / stop (${pnlPercent.toFixed(2)}% vs entry)`
    : "";
  await sendTelegramAlert(
    (ghostMode ? `👻 <b>GHOST SELL</b> (DB only, no Binance)\n` : `🔴 <b>SELL</b>\n`) +
      `<b>Symbol:</b> ${escapeHtml(symbol)} · <b>Exit</b> ${formatTelegramPrice(exitPx)}\n` +
      `<b>PnL:</b> ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USDT (${pnlPercent.toFixed(2)}%)` +
      ` · <b>Balance:</b> ${nextBalance.toFixed(2)} USDT` +
      ` · <b>Acct PnL:</b> ${accountPnl >= 0 ? "+" : ""}${accountPnl.toFixed(2)} USDT` +
      trailNote +
      `\n<b>Strategy:</b> ${escapeHtml(strategyNotes)}`,
  );
  botDebug("sellFlow", "sell_completed", {
    userId,
    symbol,
    amount: soldBase,
    pnl,
    pnlPercent,
    nextBalance,
    orderId: sellOrderId ?? "n/a",
  });
}
