import {
  binanceSignedSpotPost,
  getServerSideBinanceClient,
} from "@/lib/binance";
import {
  floorQuantity,
  getLotSizeFilter,
  getMinNotionalFilter,
  toNumber,
} from "@/lib/services/execution/execution-helpers";

export type MicroOrderSide = "BUY" | "SELL";

function iocPrice(side: MicroOrderSide, targetPrice: number, bps: number): string {
  const slip = targetPrice * (bps / 10_000);
  const px = side === "BUY" ? targetPrice + slip : targetPrice - slip;
  return px.toFixed(8);
}

/**
 * Signed LIMIT + IOC to Binance `/api/v3/order` — no hanging partial limits.
 */
export async function placeMicroIocLimit(
  symbol: string,
  side: MicroOrderSide,
  quantity: number,
  targetPrice: number,
  options?: { spreadBps?: number; quoteOrderQty?: number },
): Promise<{ orderId: number; status: string }> {
  const client = getServerSideBinanceClient();
  const info = await client.getExchangeSymbolInfo(symbol);
  if (!info) throw new Error(`exchangeInfo missing for ${symbol}`);

  const bps = options?.spreadBps ?? 4;
  const price = iocPrice(side, targetPrice, bps);
  const lot = getLotSizeFilter(info);
  const minNotional = toNumber(getMinNotionalFilter(info)?.minNotional);

  const body: Record<string, string | number> = {
    symbol,
    side,
    type: "LIMIT",
    timeInForce: "IOC",
    price,
  };

  if (side === "BUY" && options?.quoteOrderQty != null) {
    const qty = options.quoteOrderQty / Number(price);
    const floored = floorQuantity(qty, lot?.stepSize);
    if (floored * Number(price) < minNotional) {
      throw new Error(`IOC BUY below min notional ${minNotional}`);
    }
    body.quantity = floored;
  } else {
    const floored = floorQuantity(quantity, lot?.stepSize);
    if (floored <= 0) throw new Error("IOC quantity zero after lot filter");
    body.quantity = floored;
  }

  const res = await binanceSignedSpotPost<{ orderId: number; status: string }>(
    "/api/v3/order",
    body,
  );
  return { orderId: res.orderId, status: res.status };
}

export function isBinanceRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("429") ||
    m.includes("-1003") ||
    m.includes("rate limit") ||
    m.includes("too many requests")
  );
}

export function backoffMs(attempt: number): number {
  return Math.min(8_000, 250 * 2 ** attempt);
}
