import crypto from "node:crypto";

const BINANCE_SPOT_BASE = "https://api.binance.com";
const BINANCE_FUTURES_BASE = "https://fapi.binance.com";

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
  const url = `${BINANCE_SPOT_BASE}${path}?${query}&signature=${signature}`;

  const res = await fetch(url, {
    headers: {
      "X-MBX-APIKEY": apiKey,
    },
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Binance signed request failed: ${res.status} ${text}`);
  }

  return (await res.json()) as T;
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
