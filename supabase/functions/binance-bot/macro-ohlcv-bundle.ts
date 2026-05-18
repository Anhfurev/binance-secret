// @ts-nocheck
/** Fetch 24h × 15m OHLCV for macro LLM bundle (public Binance REST). */

import ccxt from "ccxt";
import { CRON_SYMBOL_MATRIX_ORDER } from "./constants.ts";
import { ccxtBinanceOptionsForRestGateway } from "./binance-rest-base.ts";
import { toCcxtSymbol } from "./exchange-client.ts";
import { sanitizeOhlcvCandles } from "./ohlcv-sanitizer.ts";
import type { Candle } from "./types.ts";
import { formatUnknownError } from "./utils.ts";

const TIMEFRAME_15M = "15m";
/** 24h at 15m resolution. */
export const MACRO_15M_BAR_COUNT = 96;

export type MacroSymbolOhlcv = {
  symbol: string;
  candles: Candle[];
  compact: string;
};

export type MacroOhlcvBundle = {
  fetchedAtMs: number;
  symbols: MacroSymbolOhlcv[];
  payloadText: string;
};

let sharedExchange: InstanceType<typeof ccxt.binance> | null = null;

function getPublicExchange(): InstanceType<typeof ccxt.binance> {
  if (!sharedExchange) {
    sharedExchange = new ccxt.binance({
      enableRateLimit: true,
      ...ccxtBinanceOptionsForRestGateway(),
    });
  }
  return sharedExchange;
}

export function readMacroTrackingSymbols(): string[] {
  const raw = String(Deno.env.get("MACRO_TRACKING_SYMBOLS") ?? "").trim();
  if (raw) {
    return raw.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  }
  return [...CRON_SYMBOL_MATRIX_ORDER];
}

function compactCandleStream(symbol: string, candles: Candle[]): string {
  const lines = candles.map((c) =>
    `${c.openTime},${c.open.toFixed(4)},${c.high.toFixed(4)},${c.low.toFixed(4)},${c.close.toFixed(4)},${c.volume.toFixed(2)}`
  );
  return `${symbol}|15m|n=${lines.length}\n${lines.join("\n")}`;
}

export async function fetchMacro15mOhlcvBundle(
  symbols = readMacroTrackingSymbols(),
): Promise<MacroOhlcvBundle> {
  const exchange = getPublicExchange();
  const started = Date.now();
  const rows: MacroSymbolOhlcv[] = [];

  for (const symbol of symbols) {
    const ccxtSymbol = toCcxtSymbol(symbol);
    try {
      const raw = await exchange.fetchOHLCV(
        ccxtSymbol,
        TIMEFRAME_15M,
        undefined,
        MACRO_15M_BAR_COUNT,
      );
      const candles = sanitizeOhlcvCandles(raw ?? []);
      const compact = compactCandleStream(symbol, candles);
      rows.push({ symbol, candles, compact });
    } catch (error) {
      console.warn(
        `[macro_ohlcv] fetch failed symbol=${symbol}: ${formatUnknownError(error)}`,
      );
    }
  }

  if (!rows.length) {
    throw new Error("macro_ohlcv: all symbol fetches failed");
  }

  const payloadText = rows.map((r) => r.compact).join("\n\n");
  return { fetchedAtMs: started, symbols: rows, payloadText };
}
