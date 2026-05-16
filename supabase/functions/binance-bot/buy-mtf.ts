// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { computeEmaLastFromCloses, fetchCandlesOHLCV } from "./exchange-client.ts";
import { safeExecute } from "./safe-execute.ts";
import { botError } from "./bot-debug.ts";
import { toNumber } from "./utils.ts";
import { MIN_1H_BARS_FOR_LIVE_MTF } from "./buy-helpers.ts";

export function evaluateLiveMtfStatus(params: {
  bars1h: number;
  ema200: number | null;
  last1h: number;
}): {
  mtfDataRejected: boolean;
  bearish1hCap: boolean;
} {
  const barsOk = params.bars1h >= MIN_1H_BARS_FOR_LIVE_MTF;
  const emaOk = params.ema200 != null && Number.isFinite(Number(params.ema200));
  const lastOk = Number.isFinite(params.last1h);
  const mtfDataRejected = !barsOk || !emaOk || !lastOk;
  const bearish1hCap = !mtfDataRejected
    && params.ema200 != null
    && Number.isFinite(params.last1h)
    && Number(params.last1h) < Number(params.ema200);
  return { mtfDataRejected, bearish1hCap };
}

/**
 * Resolve the 1h bearish-cap context for a BUY decision. Live mode requires
 * ≥201 1h closes plus a finite EMA200 — when missing, returns
 * `mtfDataRejected=true` so the caller refuses the trade ("No Data = No Trade").
 * Paper mode short-circuits with the snapshot EMA200.
 */
export async function resolveBuyFlowMtfContext(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  isTestMode: boolean;
  snapshotPrice: number;
  snapshotEma200?: number;
  signal?: AbortSignal;
}): Promise<{
  bearish1hCap: boolean;
  mtf: Record<string, unknown>;
  /** Live only: true when 1h OHLCV is missing/short/invalid — caller must skip BUY (no MTF = no trade). */
  mtfDataRejected: boolean;
}> {
  const { supabase, userId, symbol, isTestMode, snapshotPrice, snapshotEma200, signal } = params;
  if (isTestMode) {
    const em = toNumber(snapshotEma200, NaN);
    const bearish =
      Number.isFinite(em) &&
      Number.isFinite(snapshotPrice) &&
      snapshotPrice < em;
    return {
      bearish1hCap: bearish,
      mtfDataRejected: false,
      mtf: {
        source: "paper_snapshot_only",
        execution_tf: "5m (not fetched in paper)",
        trend_tf: "snapshot_ema200",
        last_price: snapshotPrice,
        ema200: Number.isFinite(em) ? em : null,
        bearish_1h_price_below_ema200: bearish,
      },
    };
  }
  if (signal?.aborted) {
    throw new Error(`CYCLE_ABORTED:${symbol}`);
  }
  try {
    const [c5, c1h] = await Promise.all([
      fetchCandlesOHLCV(symbol, "5m", 150, signal),
      fetchCandlesOHLCV(symbol, "1h", 220, signal),
    ]);
    const closes5 = c5.map((x) => x.close);
    const closes1h = c1h.map((x) => x.close);
    const ema200 = computeEmaLastFromCloses(closes1h, 200);
    const last1h = closes1h.length ? closes1h[closes1h.length - 1] : NaN;
    const { mtfDataRejected, bearish1hCap: bearish } = evaluateLiveMtfStatus({
      bars1h: c1h.length,
      ema200,
      last1h,
    });
    const emaOk = ema200 != null && Number.isFinite(Number(ema200));
    const lastOk = Number.isFinite(last1h);
    const barsOk = c1h.length >= MIN_1H_BARS_FOR_LIVE_MTF;
    return {
      bearish1hCap: bearish,
      mtfDataRejected,
      mtf: {
        source: mtfDataRejected ? "binance_ohlcv_insufficient" : "binance_ohlcv",
        execution_tf: "5m",
        trend_tf: "1h",
        bars_5m: c5.length,
        bars_1h: c1h.length,
        min_1h_bars_required: MIN_1H_BARS_FOR_LIVE_MTF,
        last_5m_close: closes5.length ? closes5[closes5.length - 1] : null,
        last_1h_close: lastOk ? last1h : null,
        ema200_on_1h_closes: emaOk ? ema200 : null,
        bearish_1h_price_below_ema200: bearish,
        ...(mtfDataRejected
          ? {
            reject_reason: !barsOk
              ? "1h_series_too_short_or_empty"
              : !emaOk
              ? "ema200_not_computable"
              : "last_1h_close_invalid",
          }
          : {}),
      },
    };
  } catch (e) {
    await safeExecute(
      "catch_mtf_ohlcv_fetch_failed_log",
      () =>
        supabase.from("logs").insert([{
          user_id: userId,
          symbol,
          level: "warn",
          source: "buy-flow",
          message: "mtf_ohlcv_fetch_failed",
          meta: {
            event: "mtf_ohlcv_fetch_failed",
            detail: e instanceof Error ? e.message : String(e),
          },
          created_at: new Date().toISOString(),
        }]),
      undefined,
    );
    botError("buyFlow", "mtf_ohlcv_fetch_failed", {
      symbol,
      detail: e instanceof Error ? e.message : String(e),
    });
    const emSnap = toNumber(snapshotEma200, NaN);
    return {
      bearish1hCap: false,
      mtfDataRejected: true,
      mtf: {
        source: "ohlcv_fetch_failed",
        error: e instanceof Error ? e.message : String(e),
        last_price: snapshotPrice,
        ema200_snapshot: Number.isFinite(emSnap) ? emSnap : null,
        bearish_1h_price_below_ema200: false,
        reject_reason: "fetch_threw_no_fallback_trade",
      },
    };
  }
}
