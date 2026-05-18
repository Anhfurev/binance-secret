// @ts-nocheck
import type { LlmProvider } from "./llm-api-keys-types.ts";
import { canPersistLlmKeyDbFailure } from "./llm-key-failure-budget.ts";
import { applyLlmKeyRuntimeFailure } from "./llm-key-runtime-failure.ts";
import type { LlmKeyReleaseOutcome } from "./llm-key-failure-classify.ts";
import {
  consumeRotationFailureAttempt,
  markRotationHardAbort,
  type SymbolRotationBudget,
} from "./llm-symbol-rotation-budget.ts";
import {
  isLlmSymbolRotationCapError,
  LlmSymbolRotationCapError,
} from "./llm-symbol-rotation-cap.ts";

export type RotationCircuitAction = "continue" | "stop_miss";

const CIRCUIT_LOG = "[CIRCUIT BREAKER]";

/**
 * Await DB/local isolation, then decide: hard-abort (403/blocked) or budget stop — never rotate on terminal ban.
 */
export async function applyRotationCircuitAfterHttpFailure(opts: {
  budget: SymbolRotationBudget;
  keyId: string;
  dbRowId?: string | null;
  rowErrorCount?: number;
  error: unknown;
  context: { provider: LlmProvider; keyIndex: number; symbol?: string };
}): Promise<{ action: RotationCircuitAction; outcome: LlmKeyReleaseOutcome }> {
  const outcome = await applyLlmKeyRuntimeFailure({
    keyId: opts.keyId,
    dbRowId: opts.dbRowId,
    rowErrorCount: opts.rowErrorCount,
    error: opts.error,
    context: opts.context,
  });
  const sym = opts.context.symbol ?? opts.budget.symbol;
  const provider = opts.context.provider;

  if (outcome === "blocked") {
    markRotationHardAbort(opts.budget);
    console.warn(
      `${CIRCUIT_LOG} ${opts.budget.lane} symbol=${sym} STOP_MISS — terminal auth/suspended (no idx+1)`,
    );
    return { action: "stop_miss", outcome };
  }

  if (outcome === "client_error") {
    markRotationHardAbort(opts.budget);
    console.warn(
      `${CIRCUIT_LOG} ${opts.budget.lane} symbol=${sym} STOP_MISS — client payload 400 (no key bench)`,
    );
    return { action: "stop_miss", outcome };
  }

  consumeRotationFailureAttempt(opts.budget);

  if (!canPersistLlmKeyDbFailure(sym, provider)) {
    markRotationHardAbort(opts.budget);
    console.warn(
      `${CIRCUIT_LOG} ${opts.budget.lane} symbol=${sym} STOP_MISS — DB failure mark budget exhausted`,
    );
    return { action: "stop_miss", outcome };
  }

  if (opts.budget.attemptsUsed >= opts.budget.maxAttempts) {
    const cap = new LlmSymbolRotationCapError(
      sym,
      opts.budget.lane,
      opts.budget.attemptsUsed,
      opts.budget.maxAttempts,
    );
    console.warn(cap.message);
    markRotationHardAbort(opts.budget);
    return { action: "stop_miss", outcome };
  }

  if (outcome === "rate_limit") {
    console.warn(
      `${CIRCUIT_LOG} ${opts.budget.lane} symbol=${sym} continue — 429 isolated (${opts.budget.attemptsUsed}/${opts.budget.maxAttempts})`,
    );
  }

  return { action: "continue", outcome };
}

/** Safe for catch blocks — never throws rotation cap (bounded stop_miss). */
export async function applyRotationCircuitAfterHttpFailureBounded(
  opts: Parameters<typeof applyRotationCircuitAfterHttpFailure>[0],
): Promise<{ action: RotationCircuitAction; outcome: LlmKeyReleaseOutcome }> {
  try {
    return await applyRotationCircuitAfterHttpFailure(opts);
  } catch (error) {
    if (isLlmSymbolRotationCapError(error)) {
      markRotationHardAbort(opts.budget);
      console.warn(error.message);
      return { action: "stop_miss", outcome: "error" };
    }
    throw error;
  }
}
