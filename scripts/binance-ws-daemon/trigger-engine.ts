const DEFAULT_URL = "http://127.0.0.1:3000/api/automation/paper/run";
const SYMBOL_COOLDOWN_MS = 45_000;
const GLOBAL_COOLDOWN_MS = 8_000;

let inFlight = false;
let lastGlobalTriggerMs = 0;
const lastSymbolTriggerMs = new Map<string, number>();

function resolvePaperRunUrl(): string {
  return String(process.env.PAPER_RUN_URL ?? DEFAULT_URL).trim() || DEFAULT_URL;
}

function resolveCronSecret(): string {
  return String(process.env.CRON_SECRET ?? "").trim();
}

export async function firePaperRunTrigger(reason: string): Promise<void> {
  const now = Date.now();
  if (inFlight) return;
  if (now - lastGlobalTriggerMs < GLOBAL_COOLDOWN_MS) return;

  inFlight = true;
  lastGlobalTriggerMs = now;

  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-paper-velocity-wake": "1",
  };
  const secret = resolveCronSecret();
  if (secret) headers.Authorization = `Bearer ${secret}`;

  try {
    const res = await fetch(resolvePaperRunUrl(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn(`[ws-daemon] paper/run HTTP ${res.status} (${reason})`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[ws-daemon] paper/run failed (${reason}): ${msg}`);
  } finally {
    inFlight = false;
  }
}

export function shouldThrottleSymbol(symbol: string): boolean {
  const key = symbol.toUpperCase();
  const prev = lastSymbolTriggerMs.get(key) ?? 0;
  if (Date.now() - prev < SYMBOL_COOLDOWN_MS) return true;
  lastSymbolTriggerMs.set(key, Date.now());
  return false;
}
