// @ts-nocheck
/**
 * Per-bot decision + execution. Market data is fetched once per symbol per cron
 * (`run-symbol-batch.ts` → `getCachedSnapshot`); all autopilot rows for that
 * symbol run in parallel via `Promise.allSettled`. Multi-symbol cron uses the
 * same pattern in `index.ts`. Keep heavy parallel work there, not here.
 */
import type { createClient } from "npm:@supabase/supabase-js@2";
import { sendTelegramAlert, sendTradeRowNotification } from "./notifier.ts";
import { ensureProfileRow, loadOpenTrade } from "./trade-store.ts";
import type {
  AiAnalysis,
  BotActionResult,
  BotSettingsRow,
  ExitReason,
  IndicatorSnapshot,
  ProfileRow,
  SignalDecision,
} from "./types.ts";
import { formatUnknownError, toNumber, toStringValue } from "./utils.ts";
import {
  DEFAULT_MAX_DRAWDOWN_LIMIT_PCT,
  buildTrailingStopState,
  escapeHtml,
  formatTelegramPrice,
  fromUsdCents,
  getLatestRecordedBalance,
  resolveCombinedStrategyNotes,
  resolveGhostMode,
  resolveTestMode,
  resolveExchangeSkipped,
  resolveTrailingStopPct,
  shouldSendHeartbeat,
  toUsdCents,
} from "./bot-shared.ts";
import { persistRunTelemetry } from "./bot-telemetry.ts";
import {
  shouldPersistBotSkipLog,
  shouldTelegramHoldHeartbeat,
  shouldTelegramTrailingRowUpdate,
} from "./log-policy.ts";
import { executeBuyFlow } from "./bot-buy-v2.ts";
import { applyBreakEvenTrigger, executeSellFlow } from "./bot-sell.ts";
import { canFireDbStopLoss } from "./strategy-stop-hold.ts";
import { botDebug, botError } from "./bot-debug.ts";
import { assertExpectedEgressIpOrThrow } from "./exchange-client.ts";
import { VOL_BURST_MAX_ATR_BONUS } from "./constants.ts";

async function logSkipReason(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  reason: string;
}) {
  const { supabase, userId, symbol, reason } = params;
  if (!shouldPersistBotSkipLog()) return;
  const result = await supabase.from("logs").insert([
    {
      user_id: userId,
      symbol,
      level: "info",
      source: "bot-skip",
      message: `Action: Skip | Reason: ${reason}`,
      meta: {
        event: "bot_trade_skipped",
        reason,
      },
      created_at: new Date().toISOString(),
    },
  ]);
  if (result.error) {
    console.warn(
      `[binance-bot] skip log insert failed: ${result.error.message}`,
    );
  }
}

export async function processBot(params: {
  supabase: ReturnType<typeof createClient>;
  row: BotSettingsRow;
  snapshot: IndicatorSnapshot;
  technical: SignalDecision;
  ai: AiAnalysis;
  decision: SignalDecision;
  exitReason?: ExitReason;
  strategyReason?: string;
  cycleId: string;
  /** When set (e.g. 0.5), scales env-based BUY notional after min-trade clamp. */
  executionUsdScale?: number;
  /** Paper/demo only: bypass War Room + ranging gates so a probe BUY can execute. */
  demoProbeBuy?: boolean;
  signal?: AbortSignal;
}): Promise<BotActionResult> {
  const {
    supabase,
    row,
    snapshot,
    technical,
    ai,
    decision,
    exitReason,
    strategyReason,
    cycleId,
    executionUsdScale,
    demoProbeBuy = false,
    signal,
  } = params;
  const strategyNotes = resolveCombinedStrategyNotes(strategyReason);
  if (signal?.aborted) {
    return {
      userId: toStringValue(row.user_id) ?? "unknown",
      symbol: snapshot.symbol,
      decision: "HOLD",
      technical,
      ai,
      action: "skip",
      detail: "cycle_aborted",
      strategy_reason: strategyNotes,
    };
  }
  try {
    const userId = toStringValue(row.user_id);
    botDebug("processBot", "start", {
      userId: userId ?? "unknown",
      symbol: snapshot.symbol,
      decision,
      technical,
      aiAction: ai.action,
      aiConfidence: ai.ai_confidence,
    });
    if (!userId)
      return {
        userId: "unknown",
        symbol: snapshot.symbol,
        decision: "HOLD",
        technical,
        ai,
        action: "skip",
        detail: "bot_settings row missing user_id",
      };

    const profileResult = await supabase
      .from("profiles")
      .select("id, demo_balance, starting_balance, max_drawdown_limit")
      .eq("id", userId)
      .maybeSingle();
    if (profileResult.error)
      throw new Error(
        `profiles lookup failed for ${userId}: ${profileResult.error.message}`,
      );
    const profile = (profileResult.data as ProfileRow | null) ?? null;
    if (!profile) await ensureProfileRow(supabase, userId, 10000);

    const paperOrGhost = resolveExchangeSkipped(row);
    const liveBalance = paperOrGhost
      ? null
      : await getLatestRecordedBalance(supabase, userId);
    const currentBalance = paperOrGhost
      ? toNumber(profile?.demo_balance, 10000)
      : liveBalance ?? toNumber(profile?.demo_balance, 10000);
    const currentStartingBalance = toNumber(profile?.starting_balance, 0);
    const resolvedStartingBalance =
      currentStartingBalance > 0 ? currentStartingBalance : currentBalance;
    const shouldInitializeStartingBalance = currentStartingBalance <= 0;
    const maxDrawdownLimitPct = Math.max(
      0.1,
      Math.min(
        100,
        toNumber(profile?.max_drawdown_limit, DEFAULT_MAX_DRAWDOWN_LIMIT_PCT),
      ),
    );

    const indicators = {
      rsi: snapshot.rsi,
      macd: snapshot.macd.macd,
      macdSignal: snapshot.macd.signal,
      emaFast: snapshot.emaFast,
      emaSlow: snapshot.emaSlow,
      ema200: snapshot.ema200,
      ema50: snapshot.ema50,
    };

    const openTrade = await loadOpenTrade(
      supabase,
      userId,
      snapshot.symbol,
      toStringValue(row.id) ?? undefined,
    );
    const trailingStopPct = resolveTrailingStopPct(row.trailing_stop_pct);
    let effectiveDecision = decision;
    let effectiveExitReason = exitReason;
    let trailingStopTriggered = false;

    if (openTrade) {
      const breakEvenResult = await applyBreakEvenTrigger({
        supabase,
        userId,
        symbol: snapshot.symbol,
        openTrade,
        currentPrice: snapshot.latestPrice,
      });
      if (breakEvenResult.triggered) {
        botDebug("processBot", "break_even_triggered", {
          userId,
          symbol: snapshot.symbol,
          pnlPercent: breakEvenResult.pnlPercent,
        });
      }

      const trailingState = buildTrailingStopState(
        openTrade,
        snapshot.latestPrice,
        trailingStopPct,
        snapshot.atr14,
        snapshot.symbol,
      );
      if (trailingState.shouldPersistHigh && toStringValue(openTrade.id)) {
        await supabase
          .from("trades")
          .update({
            extra: {
              ...((openTrade.extra as Record<string, unknown> | undefined) ??
                {}),
              highest_price_seen: trailingState.highestPrice,
              highest_price_reached: trailingState.highestPrice,
              trailing_stop_price: trailingState.stopPrice,
              trailing_stop_pct: trailingStopPct,
              break_even_guard_active: trailingState.breakEvenGuardActive,
              atr14_trail_snapshot: Number(snapshot.atr14 ?? 0),
              trail_volatility_basis:
                Number.isFinite(snapshot.atr14) && Number(snapshot.atr14) > 0
                  ? "atr_1p5x"
                  : "pct_fallback",
            },
          })
          .eq("id", toStringValue(openTrade.id) ?? "");
        if (shouldTelegramTrailingRowUpdate()) {
          await sendTradeRowNotification({
            event: "update",
            trade: {
              id: toStringValue(openTrade.id),
              user_id: userId,
              symbol: snapshot.symbol,
              type: toStringValue(openTrade.type) ?? "buy",
              status: toStringValue(openTrade.status) ?? "open",
              entryPrice: toNumber(openTrade.entryPrice, 0),
              value: toNumber(openTrade.value, 0),
              notes: "Trailing stop / high watermark updated",
            },
            reason: "UPDATED: trailing stop/high watermark sync",
          });
        }
      }
      if (trailingState.shouldExit && canFireDbStopLoss(openTrade)) {
        effectiveDecision = "SELL";
        effectiveExitReason = "trailing_stop_hit";
        trailingStopTriggered = true;
      }
    }

    // Decision layer can request SELL while strategy exit remains "hold"
    // (e.g., order-book imbalance / AI panic / hard SELL signal). Normalize
    // this so closed trades never persist an ambiguous "hold" exit reason.
    if (
      effectiveDecision === "SELL" &&
      (effectiveExitReason == null || effectiveExitReason === "hold")
    ) {
      effectiveExitReason = "signal_exit";
    }

    if (effectiveDecision === "HOLD") {
      botDebug("processBot", "hold_gate", {
        userId,
        symbol: snapshot.symbol,
        detail: "No trade (confirmation layer held)",
      });
      const accountPnl = fromUsdCents(
        toUsdCents(currentBalance) - toUsdCents(resolvedStartingBalance),
      );
      if (
        shouldTelegramHoldHeartbeat() &&
        shouldSendHeartbeat(`${userId}:${snapshot.symbol}`)
      ) {
        await sendTelegramAlert(
          `🔍 <b>HEARTBEAT</b>\n` +
            `<b>Symbol:</b> ${escapeHtml(snapshot.symbol)}\n` +
            `<b>Status:</b> HOLD (no trade)\n` +
            `<b>Balance:</b> ${currentBalance.toFixed(2)} USDT\n` +
            `<b>Total PnL:</b> ${accountPnl >= 0 ? "+" : ""}${accountPnl.toFixed(2)} USDT\n` +
            `<b>Market Price:</b> ${formatTelegramPrice(snapshot.latestPrice)}\n` +
            `<b>Strategy:</b> ${escapeHtml(strategyNotes)}`,
        );
      }
      await persistRunTelemetry({
        supabase,
        userId,
        symbol: snapshot.symbol,
        action: "hold",
        detail: "No trade (confirmation layer held)",
        balance: currentBalance,
      });
      return {
        userId,
        symbol: snapshot.symbol,
        decision: effectiveDecision,
        technical,
        ai,
        indicators,
        action: "hold",
        detail: "No trade (confirmation layer held)",
        exit_reason: effectiveExitReason,
        strategy_reason: strategyNotes,
      };
    }

    if (effectiveDecision === "BUY") {
      botDebug("processBot", "reached_buy_flow_check", {
        userId,
        symbol: snapshot.symbol,
        hasOpenTrade: !!openTrade,
        exchangeSkipped: resolveExchangeSkipped(row),
      });
      if (openTrade)
        return {
          userId,
          symbol: snapshot.symbol,
          decision: effectiveDecision,
          technical,
          ai,
          indicators,
          action: "hold",
          detail: "Open position already exists",
          exit_reason: effectiveExitReason,
          strategy_reason: strategyNotes,
        };
      if (!resolveExchangeSkipped(row)) {
        await assertExpectedEgressIpOrThrow();
      }
      const buyResult = await executeBuyFlow({
        supabase,
        row,
        userId,
        symbol: snapshot.symbol,
        ai,
        technical,
        strategyNotes,
        snapshotPrice: snapshot.latestPrice,
        snapshotEma200: snapshot.ema200,
        marketRegime: snapshot.marketRegime,
        snapshotRsi: snapshot.rsi,
        snapshotBbLower: snapshot.bbLower,
        adx14: Number(snapshot.adx14 ?? 0),
        atr14: Number(snapshot.atr14 ?? 0),
        currentBalance,
        resolvedStartingBalance,
        shouldInitializeStartingBalance,
        maxDrawdownLimitPct,
        trailingStopPct,
        cycleId,
        volBurstWidenMult: (() => {
          const raw = Number(snapshot.volBurstWidenMult);
          const max = 1 + VOL_BURST_MAX_ATR_BONUS;
          if (!Number.isFinite(raw) || raw < 1) return 1;
          return Math.min(raw, max);
        })(),
        volBurstMeta: snapshot.volBurstMeta,
        snapshotImbalanceRatio: snapshot.imbalance_ratio,
        snapshotVolume24hQuote: snapshot.volume24hQuote ?? null,
        executionUsdScale,
        demoProbeBuy,
        signal,
      });
      if (buyResult.action === "skip") {
        botDebug("processBot", "buy_skipped", {
          userId,
          symbol: snapshot.symbol,
          detail: buyResult.detail,
        });
        await logSkipReason({
          supabase,
          userId,
          symbol: snapshot.symbol,
          reason: buyResult.detail,
        });
        await persistRunTelemetry({
          supabase,
          userId,
          symbol: snapshot.symbol,
          action: "skip",
          detail: buyResult.detail,
          balance: currentBalance,
        });
        return {
          userId,
          symbol: snapshot.symbol,
          decision: "HOLD",
          technical,
          ai,
          indicators,
          action: "skip",
          detail: buyResult.detail,
          exit_reason: effectiveExitReason,
          strategy_reason: strategyNotes,
        };
      }
      botDebug("processBot", "buy_executed", {
        userId,
        symbol: snapshot.symbol,
        detail: buyResult.detail,
      });
      return {
        userId,
        symbol: snapshot.symbol,
        decision: effectiveDecision,
        technical,
        ai,
        indicators,
        action: "buy",
        detail: buyResult.detail,
        exit_reason: effectiveExitReason,
        strategy_reason: strategyNotes,
      };
    }

    if (!openTrade) {
      await persistRunTelemetry({
        supabase,
        userId,
        symbol: snapshot.symbol,
        action: "hold",
        detail: "No open position to sell",
        balance: currentBalance,
      });
      return {
        userId,
        symbol: snapshot.symbol,
        decision: effectiveDecision,
        technical,
        ai,
        indicators,
        action: "hold",
        detail: "No open position to sell",
        exit_reason: effectiveExitReason,
        strategy_reason: strategyNotes,
      };
    }

    if (!resolveExchangeSkipped(row)) {
      await assertExpectedEgressIpOrThrow();
    }
    const sellResult = await executeSellFlow({
      supabase,
      row,
      userId,
      symbol: snapshot.symbol,
      openTrade,
      snapshotPrice: snapshot.latestPrice,
      technical,
      ai,
      effectiveDecision,
      effectiveExitReason,
      strategyNotes,
      currentBalance,
      resolvedStartingBalance,
      shouldInitializeStartingBalance,
      trailingStopTriggered,
      cycleId,
      marketRegime: snapshot.marketRegime,
      signal,
    });
    if (sellResult.action === "skip") {
      botDebug("processBot", "sell_skipped", {
        userId,
        symbol: snapshot.symbol,
        detail: sellResult.detail,
      });
      await logSkipReason({
        supabase,
        userId,
        symbol: snapshot.symbol,
        reason: sellResult.detail,
      });
      await persistRunTelemetry({
        supabase,
        userId,
        symbol: snapshot.symbol,
        action: "skip",
        detail: sellResult.detail,
        balance: currentBalance,
      });
      return {
        userId,
        symbol: snapshot.symbol,
        decision: effectiveDecision,
        technical,
        ai,
        indicators,
        action: "skip",
        detail: sellResult.detail,
        exit_reason: effectiveExitReason ?? "signal_exit",
        strategy_reason: strategyNotes,
      };
    }
    botDebug("processBot", "sell_executed", {
      userId,
      symbol: snapshot.symbol,
      detail: sellResult.detail,
    });
    return {
      userId,
      symbol: snapshot.symbol,
      decision: effectiveDecision,
      technical,
      ai,
      indicators,
      action: "sell",
      detail: sellResult.detail,
      exit_reason: effectiveExitReason ?? "signal_exit",
      strategy_reason: strategyNotes,
    };
  } catch (error) {
    const detail = formatUnknownError(error);
    botError("processBot", "process_bot_uncaught", {
      userId: toStringValue(row.user_id) ?? "unknown",
      symbol: snapshot?.symbol ?? "unknown",
      detail,
    });
    await sendTelegramAlert(`⚠️ <b>SYSTEM ALERT</b>\n${escapeHtml(detail)}`);
    throw error;
  }
}
