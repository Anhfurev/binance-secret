// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { sendTelegramAlert } from "./notifier.ts";
import { escapeHtml } from "./bot-shared.ts";
import { botWarn } from "./bot-debug.ts";
import { safeInsertLog } from "./buy-logging.ts";

export function isDrawdownBreached(
  drawdownPct: number,
  maxDrawdownLimitPct: number,
): boolean {
  return Number.isFinite(drawdownPct) && drawdownPct > maxDrawdownLimitPct;
}

export async function resolveDrawdownBreachSkip(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  drawdownPct: number;
  maxDrawdownLimitPct: number;
  currentBalance: number;
  resolvedStartingBalance: number;
  ghostMode: boolean;
  isPaperOnly: boolean;
}): Promise<{ skipDetail: string } | null> {
  const {
    supabase,
    userId,
    symbol,
    drawdownPct,
    maxDrawdownLimitPct,
    currentBalance,
    resolvedStartingBalance,
    ghostMode,
    isPaperOnly,
  } = params;
  if (!isDrawdownBreached(drawdownPct, maxDrawdownLimitPct)) return null;

  botWarn("buyFlow", "drawdown_breach_block", {
    userId,
    symbol,
    drawdownPct,
    maxDrawdownLimitPct,
    ghostMode,
    isPaperOnly,
  });
  if (ghostMode) {
    return {
      skipDetail:
        `Ghost BUY skipped: drawdown ${drawdownPct.toFixed(2)}% would breach live safety (autopilot not changed).`,
    };
  }
  if (isPaperOnly) {
    await safeInsertLog(
      supabase,
      {
        user_id: userId,
        symbol,
        level: "info",
        source: "safety",
        message: "drawdown_breach_paper_skip",
        meta: {
          event: "drawdown_breach_paper_skip",
          balance_at_breach: Number(currentBalance.toFixed(2)),
          starting_balance: Number(resolvedStartingBalance.toFixed(2)),
          drawdown_pct: Number(drawdownPct.toFixed(2)),
          limit: Number(maxDrawdownLimitPct.toFixed(2)),
          note: "Paper mode: autopilot intentionally NOT disabled.",
        },
        created_at: new Date().toISOString(),
      },
      "drawdown_breach_paper_skip",
    );
    return {
      skipDetail:
        `Paper BUY skipped: drawdown ${drawdownPct.toFixed(2)}% > ${maxDrawdownLimitPct.toFixed(2)}% (autopilot kept ON for demo).`,
    };
  }
  const nowIso = new Date().toISOString();
  await sendTelegramAlert(
    `CRITICAL: DRAWDOWN BREACH\nSymbol: ${escapeHtml(symbol)}\nCurrent Balance: ${currentBalance.toFixed(2)} USDT\nStarting Balance: ${resolvedStartingBalance.toFixed(2)} USDT\nDrawdown: ${drawdownPct.toFixed(2)}%\nLimit: ${maxDrawdownLimitPct.toFixed(2)}%\nAUTOPILOT DISABLED FOR SAFETY`,
  );
  await supabase.from("bot_settings").update({ is_autopilot_enabled: false, updated_at: nowIso } as any).eq("user_id", userId);
  await safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "warn",
      source: "safety",
      message: "drawdown_autopilot_disabled",
      meta: {
        event: "drawdown_autopilot_disabled",
        balance_at_breach: Number(currentBalance.toFixed(2)),
        drawdown_pct: Number(drawdownPct.toFixed(2)),
        limit: Number(maxDrawdownLimitPct.toFixed(2)),
      },
      created_at: nowIso,
    },
    "drawdown_autopilot_disabled",
  );
  return {
    skipDetail: `BUY blocked by drawdown breach (${drawdownPct.toFixed(2)}% > ${maxDrawdownLimitPct.toFixed(2)}%)`,
  };
}
