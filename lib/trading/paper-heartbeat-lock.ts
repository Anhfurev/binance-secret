/**
 * Single-flight gate for /api/automation/paper/run (one PM2 / Node process).
 * Prevents same-millisecond cron pile-ups and enforces 1-hour minimum interval.
 */

const HOUR_MS = 3_600_000;

let isProcessing = false;
let lastCompletedAtMs = 0;
let lastStartedAtMs = 0;

function resolveIntervalMs(): number {
  const raw = String(process.env.PAPER_HEARTBEAT_INTERVAL_MS ?? "").trim();
  const n = raw ? Number(raw) : HOUR_MS;
  if (!Number.isFinite(n) || n < 60_000) return HOUR_MS;
  return Math.min(n, 24 * HOUR_MS);
}

export type PaperHeartbeatGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: "already_processing" | "interval_not_elapsed";
      retryAfterMs: number;
      lastCompletedAtMs: number;
    };

export function tryAcquirePaperHeartbeat(): PaperHeartbeatGateResult {
  const now = Date.now();
  const intervalMs = resolveIntervalMs();

  if (isProcessing) {
    return {
      ok: false,
      reason: "already_processing",
      retryAfterMs: Math.max(0, intervalMs - (now - lastStartedAtMs)),
      lastCompletedAtMs,
    };
  }

  if (lastCompletedAtMs > 0 && now - lastCompletedAtMs < intervalMs) {
    return {
      ok: false,
      reason: "interval_not_elapsed",
      retryAfterMs: intervalMs - (now - lastCompletedAtMs),
      lastCompletedAtMs,
    };
  }

  isProcessing = true;
  lastStartedAtMs = now;
  return { ok: true };
}

export function releasePaperHeartbeat(): void {
  isProcessing = false;
  lastCompletedAtMs = Date.now();
}

export function readPaperHeartbeatState() {
  return {
    isProcessing,
    lastCompletedAtMs,
    lastStartedAtMs,
    intervalMs: resolveIntervalMs(),
  };
}
