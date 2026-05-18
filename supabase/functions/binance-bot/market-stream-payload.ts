// @ts-nocheck
/** JSON shape from gateway stream hub `/stream/market` and `/stream/market/bulk`. */

import type { Candle } from "./types.ts";

export type StreamMarketPayload = {
  ok: boolean;
  symbol: string;
  updated_at_ms: number;
  tick: {
    symbol: string;
    last: number;
    bid: number;
    ask: number;
    lastTradeTs: number;
    bookTickerTs: number;
  };
  mini: {
    last: number;
    high: number;
    low: number;
    quoteVolume: number;
    baseVolume: number;
    updatedAtMs: number;
  } | null;
  klines: {
    "1m": Candle[];
    "5m": Candle[];
    "15m": Candle[];
    "1h": Candle[];
    "4h": Candle[];
    "1d": Candle[];
  };
};
