// @ts-nocheck
/** Paper-trade dispatch: block live CCXT when simulation env is active. */

function envFlagTrue(key: string): boolean {
  const raw = String(Deno.env.get(key) ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

/** Global paper gate — strategy-agnostic; all symbols/sides/strategies. */
export function isPaperTradingEnvForced(): boolean {
  if (envFlagTrue("IS_PAPER_TRADING")) return true;
  if (envFlagTrue("IS_TEST_MODE")) return true;
  const ankhush = String(Deno.env.get("ANKHUSH_PAPER_TRADING") ?? "").trim();
  if (ankhush.length > 0 && ankhush !== "0" && ankhush.toLowerCase() !== "false") {
    return true;
  }
  return false;
}

/** @deprecated Use {@link isPaperTradingEnvForced} — kept for callers/tests. */
export function shouldPaperInterceptExchangeDispatch(): boolean {
  return isPaperTradingEnvForced();
}

export function buildPaperCcxtLimitReceipt(params: {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  price: number;
}) {
  const symbol = String(params.symbol ?? "").toUpperCase();
  const side = params.side === "sell" ? "sell" : "buy";
  const amount = Number(params.amount);
  const price = Number(params.price);
  return {
    id: `paper-${crypto.randomUUID()}`,
    symbol,
    type: "limit",
    side,
    amount,
    price,
    status: "closed",
    filled: amount,
    remaining: 0,
    average: price,
    cost: amount * price,
    info: { message: "Simulated paper trade execution successful" },
  };
}

export function logPaperTradeExecution(params: {
  side: "buy" | "sell";
  amount: number;
  symbol: string;
  price: number;
}) {
  const side = params.side === "sell" ? "SELL" : "BUY";
  const amount = Number(params.amount);
  const price = Number(params.price);
  const symbol = String(params.symbol ?? "").toUpperCase();
  console.log(
    `> Ankhush Trading Bot: [PAPER_TRADE_EXECUTION] Simulated ${side} order for ${amount} ${symbol} successful at ${price}`,
  );
}

export function paperInterceptToSmartLimitResult(params: {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  signalPrice: number;
}) {
  const receipt = buildPaperCcxtLimitReceipt({
    symbol: params.symbol,
    side: params.side,
    amount: params.amount,
    price: params.signalPrice,
  });
  logPaperTradeExecution({
    side: params.side,
    amount: params.amount,
    symbol: params.symbol,
    price: params.signalPrice,
  });
  return {
    id: receipt.id,
    status: receipt.status,
    symbol: receipt.symbol,
    side: receipt.side,
    amount: receipt.amount,
    filled: receipt.filled,
    average: receipt.average,
    cost: receipt.cost,
    price: receipt.price,
    execution_type: "limit_chase" as const,
    actual_slippage_pct: 0,
    smart_execution_meta: {
      paper: true,
      instant_paper_intercept: true,
      ...receipt.info,
    },
    raw: receipt,
  };
}

export function paperInterceptToMarketResult(params: {
  symbol: string;
  side: "buy" | "sell";
  amount: number;
  referencePrice: number;
}) {
  const receipt = buildPaperCcxtLimitReceipt({
    symbol: params.symbol,
    side: params.side,
    amount: params.amount,
    price: params.referencePrice,
  });
  logPaperTradeExecution({
    side: params.side,
    amount: params.amount,
    symbol: params.symbol,
    price: params.referencePrice,
  });
  return {
    ...receipt,
    type: "market",
    execution_type: "paper_market",
    actual_slippage_pct: 0,
    smart_execution_meta: {
      paper: true,
      instant_paper_intercept: true,
      ...receipt.info,
    },
  };
}
