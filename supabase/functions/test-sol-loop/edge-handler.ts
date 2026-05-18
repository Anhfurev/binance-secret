// @ts-nocheck
import { finalizeEdgeJsonResponse } from "../binance-bot/edge-runtime.ts";
import { jsonResponse } from "../binance-bot/utils.ts";

export type TestSolLoopTiming = {
  startedAtMs: number;
  batchDoneAtMs?: number;
};

export async function respondTestSolLoop(
  body: unknown,
  status = 200,
  timing?: TestSolLoopTiming,
): Promise<Response> {
  const payload = typeof body === "object" && body !== null
    ? {
      ...(body as Record<string, unknown>),
      ...(timing
        ? {
          elapsed_ms: Date.now() - timing.startedAtMs,
          batch_elapsed_ms: timing.batchDoneAtMs != null
            ? timing.batchDoneAtMs - timing.startedAtMs
            : undefined,
        }
        : {}),
    }
    : body;
  return await finalizeEdgeJsonResponse(jsonResponse(payload, status));
}
