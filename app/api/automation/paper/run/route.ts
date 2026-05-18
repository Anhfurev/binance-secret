export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  readPaperHeartbeatState,
  releasePaperHeartbeatSuccess,
  releasePaperHeartbeatWithoutComplete,
  tryAcquirePaperHeartbeat,
} from "@/lib/trading/paper-heartbeat-lock";
import { runPaperScalpOrchestrator } from "@/lib/trading/paper-run-orchestrator";
import {
  writeServerLogAsync,
  writeServerLogFromError,
} from "@/lib/server-logs";

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

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    writeServerLogAsync({
      level: "warn",
      source: "paper-scalp-route",
      message: "unauthorized_cron_request",
    });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const gate = tryAcquirePaperHeartbeat();
  if (!gate.ok) {
    const state = readPaperHeartbeatState();
    console.log(
      `[paper-scalp] heartbeat rejected: ${gate.reason} retryAfterMs=${gate.retryAfterMs}`,
    );
    return NextResponse.json(
      {
        ok: false,
        skipped: true,
        reason: gate.reason,
        retryAfterMs: gate.retryAfterMs,
        lastCompletedAtMs: gate.lastCompletedAtMs,
        intervalMs: state.intervalMs,
      },
      { status: 429 },
    );
  }

  let heartbeatCompleted = false;
  try {
    const outcome = await runPaperScalpOrchestrator();
    if (!outcome.ok) {
      return NextResponse.json(outcome.body, { status: outcome.status });
    }
    heartbeatCompleted = true;
    return NextResponse.json({
      ...outcome,
      partial: outcome.partial ?? false,
    });
  } catch (error: unknown) {
    logFatalRouteException(error);
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      {
        error: "Internal execution failure",
        details: message,
        phase: "fatal_route_exception",
      },
      { status: 500 },
    );
  } finally {
    if (heartbeatCompleted) {
      releasePaperHeartbeatSuccess();
    } else {
      releasePaperHeartbeatWithoutComplete();
    }
  }
}
