// @ts-nocheck
import type { LlmProvider } from "./llm-api-keys-types.ts";
import { recordLlmApiKeyHttpFailure } from "./llm-api-keys-repo.ts";
import {
  classifyLlmKeyReleaseOutcome,
  type LlmKeyReleaseOutcome,
} from "./llm-key-failure-classify.ts";

/** Persist classified HTTP failure to DB (pool checkout wrapper already updated local pool). */
export async function applyLlmKeyRuntimeFailure(opts: {
  keyId: string;
  dbRowId?: string | null;
  rowErrorCount?: number;
  error: unknown;
  context: { provider: LlmProvider; keyIndex: number; symbol?: string };
}): Promise<LlmKeyReleaseOutcome> {
  const rowId = String(opts.dbRowId ?? "").trim();
  const outcome = classifyLlmKeyReleaseOutcome(opts.error);
  if (outcome === "client_error") return outcome;
  if (rowId && (outcome === "rate_limit" || outcome === "blocked")) {
    await recordLlmApiKeyHttpFailure(rowId, opts.error, {
      ...opts.context,
      lockId: opts.keyId,
      rowErrorCount: opts.rowErrorCount,
    });
  }
  return outcome;
}
