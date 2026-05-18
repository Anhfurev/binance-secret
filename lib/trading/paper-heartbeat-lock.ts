/**
 * Single-flight gate for /api/automation/paper/run (one PM2 / Node process).
 * Prevents cron pile-ups; enforces minimum interval between successful ticks.
 */

/** Default 2m — matches aggressive cron + `PAPER_HEARTBEAT_INTERVAL_MS=120000`. */
const DEFAULT_INTERVAL_MS = 120_000;

let isProcessing = false;
let lastCompletedAtMs = 0;
let lastStartedAtMs = 0;

function resolveIntervalMs(): number {
  const raw = String(process.env.PAPER_HEARTBEAT_INTERVAL_MS ?? "").trim();
  const n = raw ? Number(raw) : DEFAULT_INTERVAL_MS;
  if (!Number.isFinite(n) || n < 60_000) return DEFAULT_INTERVAL_MS;
  return Math.min(n, 24 * 3_600_000);
}

export type PaperHeartbeatGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: "already_processing" | "interval_not_elapsed";
      retryAfterMs: number;
      lastCompletedAtMs: number;
    };

export function tryAcquirePaperHeartbeat(options?: {
  /** WebSocket velocity wake — skip interval gate, keep single-flight. */
  skipIntervalGate?: boolean;
}): PaperHeartbeatGateResult {
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

  if (
    !options?.skipIntervalGate &&
    lastCompletedAtMs > 0 &&
    now - lastCompletedAtMs < intervalMs
  ) {
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

export function releasePaperHeartbeatWithoutComplete(): void {
  isProcessing = false;
}

export function releasePaperHeartbeatSuccess(): void {
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
