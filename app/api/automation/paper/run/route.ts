export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import { after, NextRequest, NextResponse } from "next/server";
import {
  readPaperHeartbeatState,
  releasePaperHeartbeatSuccess,
  releasePaperHeartbeatWithoutComplete,
  tryAcquirePaperHeartbeat,
} from "@/lib/trading/paper-heartbeat-lock";
import { resolvePaperEngineMode } from "@/lib/trading/paper-scalp-engine-mode";
import { flushPendingManifestTelegram } from "@/lib/trading/paper-scalp-engine-manifest";
import { PAPER_SNAPSHOT_MODULE_TAG } from "@/lib/trading/paper-portfolio-snapshot";
import { runPaperScalpOrchestrator } from "@/lib/trading/paper-run-orchestrator";
import { warnPaperTelegramEnvOnce } from "@/lib/trading/paper-telegram-env";
import {
  writeServerLogAsync,
  writeServerLogFromError,
} from "@/lib/server-logs";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
};

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

function logFatalRouteException(error: unknown, phase?: string): void {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error("❌ [FATAL ROUTE EXCEPTION]:", err.message, err.stack);
  writeServerLogFromError("paper-scalp-route", err, {
    phase: phase ?? "fatal_route_exception",
  });
}

async function handlePaperRun(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    writeServerLogAsync({
      level: "warn",
      source: "paper-scalp-route",
      message: "unauthorized_cron_request",
    });
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const engineMode = resolvePaperEngineMode();
  warnPaperTelegramEnvOnce();
  console.log(
    `[paper-scalp-route] tick start mode=${engineMode} snapshot=${PAPER_SNAPSHOT_MODULE_TAG} PAPER_ENGINE_MODE=${String(process.env.PAPER_ENGINE_MODE ?? "(default micro)")}`,
  );

  const velocityWake =
    request.headers.get("x-paper-velocity-wake") === "1";
  const gate = tryAcquirePaperHeartbeat({ skipIntervalGate: velocityWake });
  if (!gate.ok) {
    const state = readPaperHeartbeatState();
    if (!velocityWake) {
      console.log(
        `[paper-scalp] heartbeat rejected: ${gate.reason} retryAfterMs=${gate.retryAfterMs}`,
      );
    }
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        reason: gate.reason,
        retryAfterMs: gate.retryAfterMs,
        lastCompletedAtMs: gate.lastCompletedAtMs,
        intervalMs: state.intervalMs,
        engineMode,
      },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  let heartbeatCompleted = false;
  try {
    const outcome = await runPaperScalpOrchestrator();
    if (!outcome.ok) {
      return NextResponse.json(outcome.body, {
        status: outcome.status,
        headers: NO_STORE_HEADERS,
      });
    }
    heartbeatCompleted = true;
    const body = {
      ...outcome,
      engineMode,
      partial: outcome.partial ?? false,
      persistAsync: outcome.persistAsync ?? false,
      persistQueued: outcome.persistQueued ?? 0,
      executedAt: new Date().toISOString(),
    };
    after(() => {
      void flushPendingManifestTelegram();
    });
    console.log(
      `[paper-scalp-route] tick done scanned=${outcome.scanned} updated=${outcome.updated} persistQueued=${body.persistQueued}`,
    );
    return NextResponse.json(body, { headers: NO_STORE_HEADERS });
  } catch (error: unknown) {
    logFatalRouteException(error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Internal execution failure",
        details: message,
        phase: "fatal_route_exception",
        engineMode,
      },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  } finally {
    if (heartbeatCompleted) {
      releasePaperHeartbeatSuccess();
    } else {
      releasePaperHeartbeatWithoutComplete();
    }
  }
}

export async function GET(request: NextRequest) {
  return handlePaperRun(request);
}

export async function POST(request: NextRequest) {
  return handlePaperRun(request);
}
