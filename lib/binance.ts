import crypto from "node:crypto";

const BINANCE_SPOT_BASE = "https://api.binance.com";
const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

function resolveBinanceSpotBaseUrl(): string {
  const gateway = (
    process.env.BINANCE_REST_GATEWAY_URL ??
    process.env.BINANCE_API_GATEWAY_URL ??
    ""
  ).trim();
  if (!gateway) return BINANCE_SPOT_BASE;
  return gateway.replace(/\/+$/, "");
}

function resolveBinanceGatewayHeaders(): Record<string, string> {
  const secret = (process.env.BINANCE_GATEWAY_SECRET ?? "").trim();
  if (!secret) return {};
  return { "X-Binance-Gateway-Secret": secret };
}

export interface BinanceSpotBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceSpotAccountInfo {
  makerCommission: number;
  takerCommission: number;
  buyerCommission: number;
  sellerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  balances: BinanceSpotBalance[];
  permissions?: string[];
}

export interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

export interface BinanceSymbolFilter {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  applyToMarket?: boolean;
}

export interface BinanceExchangeSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  filters: BinanceSymbolFilter[];
}

interface BinanceExchangeInfo {
  symbols: BinanceExchangeSymbol[];
}

export interface BinanceOrderFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
}

export interface BinanceSpotOrderResponse {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  timeInForce?: string;
  type: string;
  side: "BUY" | "SELL";
  fills?: BinanceOrderFill[];
}

function toQuery(params: Record<string, string | number | boolean>) {
  return new URLSearchParams(
    Object.entries(params).reduce<Record<string, string>>((acc, [k, v]) => {
      acc[k] = String(v);
      return acc;
    }, {}),
  ).toString();
}

function signQuery(query: string, secret: string) {
  return crypto.createHmac("sha256", secret).update(query).digest("hex");
}

function getStepPrecision(stepSize: string) {
  const normalized = stepSize.trim();
  if (!normalized.includes(".")) return 0;
  return normalized.replace(/0+$/, "").split(".")[1]?.length ?? 0;
}

export function floorToStep(value: number, stepSize: string) {
  const step = Number(stepSize);
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }

  const precision = getStepPrecision(stepSize);
  const floored = Math.floor(value / step) * step;
  return Number(floored.toFixed(precision));
}

function formatQuantity(value: number, stepSize?: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Quantity must be a positive number");
  }

  if (!stepSize) {
    return String(value);
  }

  const precision = getStepPrecision(stepSize);
  return floorToStep(value, stepSize).toFixed(precision);
}

async function binanceSpotPublicGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = toQuery(params);
  const url = `${resolveBinanceSpotBaseUrl()}${path}${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...resolveBinanceGatewayHeaders(),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance spot public request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

async function binanceSignedSpotRequest<T>(
  method: "GET" | "POST",
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const { apiKey, apiSecret, configured } = getBinanceCredentials();

  if (!configured || !apiKey || !apiSecret) {
    throw new Error("Binance API credentials are not configured");
  }

  const recvWindow = Number(process.env.BINANCE_RECV_WINDOW ?? 5000);
  const query = toQuery({
    ...params,
    recvWindow,
    timestamp: Date.now(),
  });
  const signature = signQuery(query, apiSecret);
  const url = `${resolveBinanceSpotBaseUrl()}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    method,
    headers: {
      Accept: "application/json",
      "X-MBX-APIKEY": apiKey,
      ...resolveBinanceGatewayHeaders(),
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance signed request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
}

export function getBinanceCredentials() {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET;

  return {
    apiKey,
    apiSecret,
    configured: Boolean(apiKey && apiSecret),
  };
}

export async function binanceSignedSpotGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  return binanceSignedSpotRequest("GET", path, params);
}

export async function binanceSignedSpotPost<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  return binanceSignedSpotRequest("POST", path, params);
}

export async function binanceFuturesPublicGet<T>(
  path: string,
  params: Record<string, string | number | boolean> = {},
): Promise<T> {
  const query = toQuery(params);
  const url = `${BINANCE_FUTURES_BASE}${path}${query ? `?${query}` : ""}`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Binance futures public request failed: ${res.status} ${text}`,
    );
  }

  return (await res.json()) as T;
}

export function getServerSideBinanceClient() {
  return {
    getAccountInfo() {
      return binanceSignedSpotGet<BinanceSpotAccountInfo>("/api/v3/account");
    },

    async getAssetBalance(asset: string) {
      const account = await binanceSignedSpotGet<BinanceSpotAccountInfo>(
        "/api/v3/account",
      );

      return (
        account.balances.find(
          (balance) => balance.asset.toUpperCase() === asset.toUpperCase(),
        ) ?? null
      );
    },

    async getSymbolPrice(symbol: string) {
      const ticker = await binanceSpotPublicGet<BinanceTickerPrice>(
        "/api/v3/ticker/price",
        { symbol },
      );

      return Number(ticker.price);
    },

    async getExchangeSymbolInfo(symbol: string) {
      const exchangeInfo = await binanceSpotPublicGet<BinanceExchangeInfo>(
        "/api/v3/exchangeInfo",
        { symbol },
      );

      return (
        exchangeInfo.symbols.find((item) => item.symbol === symbol) ?? null
      );
    },

    marketBuy(params: { symbol: string; quoteOrderQty: number | string }) {
      return binanceSignedSpotPost<BinanceSpotOrderResponse>("/api/v3/order", {
        symbol: params.symbol,
        side: "BUY",
        type: "MARKET",
        quoteOrderQty: params.quoteOrderQty,
      });
    },

    marketSell(params: {
      symbol: string;
      quantity: number | string;
      stepSize?: string;
    }) {
      const quantity =
        typeof params.quantity === "number"
          ? formatQuantity(params.quantity, params.stepSize)
          : params.quantity;

      return binanceSignedSpotPost<BinanceSpotOrderResponse>("/api/v3/order", {
        symbol: params.symbol,
        side: "SELL",
        type: "MARKET",
        quantity,
      });
    },
  };
}
