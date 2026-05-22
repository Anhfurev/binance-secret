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

export function readWickDropPct(symbol: string): number | null {
  const sym = String(symbol ?? "").toUpperCase();
  const key = `WICK_WAKE_DROP_PCT_${sym}`;
  const raw = (Deno.env.get(key) ?? Deno.env.get("WICK_WAKE_DROP_PCT") ?? "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    return Math.min(25, Math.max(0.2, n));
  }
  if (sym.includes("PEPE")) return 2.5;
  return null;
}
