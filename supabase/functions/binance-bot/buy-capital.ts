// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { sendTelegramAlert } from "./notifier.ts";
import { escapeHtml } from "./bot-shared.ts";
import { botDebug, botWarn } from "./bot-debug.ts";
import { safeInsertLog } from "./buy-logging.ts";
import { enforceBankrollMutex } from "./bankroll-mutex.ts";
import { getUsdtBalance } from "./binance.ts";
import { readOversoldBounceRigidFloorUsd } from "./buy-live-wallet-sizing.ts";

export async function acquireBuyCapitalReservation(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  tradeUsd: number;
  currentBalance: number;
  effectiveConfidence: number;
  rawWeighted: number;
  bearish1hCap: boolean;
  aiConfidence: number;
  cycleId: string;
  botId: string | null;
  ghostMode: boolean;
  isPaperOnly: boolean;
  usdtBalance: number;
  /** Rubber-band micro-clip: trust exchange free USDT, not DB open-notional headroom. */
  oversoldBounceMicroClip?: boolean;
}) {
  const {
    supabase,
    userId,
    symbol,
    tradeUsd,
    currentBalance,
    effectiveConfidence,
    rawWeighted,
    bearish1hCap,
    aiConfidence,
    cycleId,
    botId,
    ghostMode,
    isPaperOnly,
    usdtBalance,
    oversoldBounceMicroClip = false,
  } = params;
  if (ghostMode) return { reservationId: null as string | null };

  if (oversoldBounceMicroClip && !isPaperOnly) {
    try {
      const exchangeFree = await getUsdtBalance(false);
      const rigid = readOversoldBounceRigidFloorUsd();
      if (exchangeFree >= Math.min(tradeUsd, rigid) - 1e-6) {
        botDebug("buyFlow", "bounce_micro_clip_exchange_free_ok", {
          userId,
          symbol,
          exchange_free_usdt: Number(exchangeFree.toFixed(4)),
          trade_usd: Number(tradeUsd.toFixed(4)),
        });
        return { reservationId: null, exchangeFreeUsdt: exchangeFree };
      }
    } catch (error) {
      botWarn("buyFlow", "bounce_micro_clip_exchange_free_fetch_failed", {
        userId,
        symbol,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const mutex = await enforceBankrollMutex({ supabase, userId, symbol });
  if (!mutex.allowed) {
    botWarn("buyFlow", "bankroll_mutex_blocked", {
      userId,
      symbol,
      detail: mutex.detail,
      waited_ms: mutex.waitedMs,
      mode: mutex.mode,
    });
    return { skipDetail: mutex.detail };
  }

  const { data: reserved, error: reserveError } = await supabase.rpc("reserve_buy_capital", {
    p_user_id: userId,
    p_symbol: symbol,
    p_requested_usd: tradeUsd,
    p_min_dust_usd: 2.0,
    p_use_profile_demo_only: isPaperOnly,
  });
  if (reserveError) {
    botWarn("buyFlow", "reserve_buy_capital_rpc_error", {
      userId,
      symbol,
      detail: reserveError.message,
    });
    return { skipDetail: `reserve_buy_capital RPC failed: ${reserveError.message}` };
  }

  const reservationId =
    typeof reserved === "string" && reserved.length > 0
      ? reserved
      : (reserved && typeof (reserved as { reservation_id?: string }).reservation_id === "string"
        ? (reserved as { reservation_id: string }).reservation_id
        : null);

  if (!reservationId) {
    botDebug("buyFlow", "capital_reservation_phantom_block", {
      userId,
      symbol,
      trade_usd: Number(tradeUsd.toFixed(2)),
      usdt_balance_preflight: Number(usdtBalance.toFixed(2)),
      current_balance: Number(currentBalance.toFixed(2)),
      cycle_id: cycleId,
      bot_id: botId || null,
      ghost_mode: ghostMode,
    });
    botWarn("buyFlow", "insufficient_balance_reserved", {
      userId,
      symbol,
      tradeUsd: Number(tradeUsd.toFixed(8)),
    });
    await safeInsertLog(
      supabase,
      {
        user_id: userId,
        symbol,
        level: "warn",
        source: "buy-flow",
        message: "Insufficient balance (reserved)",
        meta: {
          event: "reserve_buy_capital_null",
          trade_usd: Number(tradeUsd.toFixed(8)),
          cycle_id: cycleId,
        },
        created_at: new Date().toISOString(),
      },
      "reserve_buy_capital_null",
    );
    await sendTelegramAlert(
      `⏸️ <b>TRADE SKIPPED — Capital constrained</b>\n` +
        `<b>Summary:</b> <code>reserve_buy_capital</code> returned no reservation (headroom covers open notionals + active reservations + min dust).\n` +
        `<b>Symbol:</b> ${escapeHtml(symbol)}\n` +
        `<b>Requested (USDT):</b> ${tradeUsd.toFixed(2)}\n` +
        `<b>Balance snapshot (USDT):</b> ${Number(currentBalance.toFixed(2))}\n` +
        `<b>Effective confidence:</b> ${effectiveConfidence.toFixed(2)}%` +
        (bearish1hCap && rawWeighted > effectiveConfidence
          ? ` (capped from ${rawWeighted.toFixed(2)}% — 1h below EMA200)\n`
          : "\n") +
        `<b>Model aggregate:</b> ${Number(aiConfidence).toFixed(2)}%\n` +
        `<b>Next step:</b> reduce concurrent bots, wait for reservations to clear, or fund wallet.`,
    );
    return { skipDetail: "Insufficient balance (reserved)" };
  }

  return { reservationId };
}

export async function releaseBuyCapitalReservation(params: {
  supabase: ReturnType<typeof createClient>;
  reservationId: string | null;
  userId: string;
  symbol: string;
}) {
  const { supabase, reservationId, userId, symbol } = params;
  if (!reservationId) return;
  const { error: releaseErr } = await supabase
    .from("capital_reservations")
    .delete()
    .eq("id", reservationId);
  if (releaseErr) {
    botWarn("buyFlow", "capital_reservation_release_failed", {
      userId,
      symbol,
      reservationId,
      detail: releaseErr.message,
    });
  }
}
