const DEFAULT_SYMBOLS = [
  "ADAUSDT",
  "AVAXUSDT",
  "BNBUSDT",
  "BTCUSDT",
  "DOGEUSDT",
  "ETHUSDT",
  "LINKUSDT",
  "PEPEUSDT",
  "SOLUSDT",
  "XRPUSDT",
];

export function readGatewaySecret(): string {
  return (Deno.env.get("BINANCE_GATEWAY_SECRET") ?? "").trim();
}

export function readListenPort(): number {
  const raw = (Deno.env.get("STREAM_HUB_PORT") ?? "8787").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 8787;
  return Math.min(65535, Math.max(1024, Math.floor(n)));
}

export function readSymbols(): string[] {
  const raw = (Deno.env.get("STREAM_SYMBOLS") ?? "").trim();
  if (!raw) return [...DEFAULT_SYMBOLS];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw.split(/[,\s]+/)) {
    const sym = part.trim().toUpperCase();
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    out.push(sym);
  }
  return out.length ? out : [...DEFAULT_SYMBOLS];
}

export function readWakeUrl(): string {
  return (Deno.env.get("BINANCE_BOT_WAKE_URL") ?? "").trim();
}

export function readWakeSecret(): string {
  return (
    (Deno.env.get("BOT_WAKE_SECRET") ?? Deno.env.get("BOT_SECRET") ?? "").trim()
  );
}

export function readWakeCooldownMs(): number {
  const raw = (Deno.env.get("WICK_WAKE_COOLDOWN_MS") ?? "45000").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 45_000;
  return Math.min(10 * 60_000, Math.max(10_000, Math.floor(n)));
}

/** Default fast-drop % from ~90s rolling high (aggTrade wick). Override per symbol via env. */
const DEFAULT_WICK_DROP_PCT: Record<string, number> = {
  BTCUSDT: 0.35,
  ETHUSDT: 0.35,
  BNBUSDT: 0.45,
  SOLUSDT: 0.55,
  XRPUSDT: 0.65,
  ADAUSDT: 0.75,
  LINKUSDT: 0.75,
  AVAXUSDT: 0.8,
  DOGEUSDT: 1.2,
  PEPEUSDT: 2.5,
};

/** Default |move| % vs last wake price (bidirectional pump/dump). */
const DEFAULT_MOVE_WAKE_PCT: Record<string, number> = {
  BTCUSDT: 0.25,
  ETHUSDT: 0.25,
  BNBUSDT: 0.3,
  SOLUSDT: 0.4,
  XRPUSDT: 0.45,
  ADAUSDT: 0.5,
  LINKUSDT: 0.5,
  AVAXUSDT: 0.55,
  DOGEUSDT: 0.9,
  PEPEUSDT: 1.8,
};

function readPctFromEnv(
  sym: string,
  perSymbolKey: string,
  globalKey: string,
  defaults: Record<string, number>,
  fallback: number,
): number | null {
  const raw = (Deno.env.get(perSymbolKey) ?? Deno.env.get(globalKey) ?? "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(25, Math.max(0.15, n));
  }
  const tier = defaults[sym];
  if (tier != null) return tier;
  return fallback;
}

export function readMoveWakeEnabled(): boolean {
  return String(Deno.env.get("MOVE_WAKE_ENABLED") ?? "1").trim() !== "0";
}

export function readWickDropPct(symbol: string): number | null {
  const sym = String(symbol ?? "").toUpperCase();
  if (String(Deno.env.get("WICK_WAKE_ENABLED") ?? "1").trim() === "0") return null;
  return readPctFromEnv(
    sym,
    `WICK_WAKE_DROP_PCT_${sym}`,
    "WICK_WAKE_DROP_PCT",
    DEFAULT_WICK_DROP_PCT,
    0.8,
  );
}

export function readMoveWakePct(symbol: string): number | null {
  const sym = String(symbol ?? "").toUpperCase();
  if (!readMoveWakeEnabled()) return null;
  return readPctFromEnv(
    sym,
    `MOVE_WAKE_PCT_${sym}`,
    "MOVE_WAKE_PCT",
    DEFAULT_MOVE_WAKE_PCT,
    0.5,
  );
}
