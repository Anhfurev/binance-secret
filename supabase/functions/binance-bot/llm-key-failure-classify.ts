// @ts-nocheck
import {
  isPermanentCredentialOrSuspension,
  isSoftQuotaOrRateLimit,
} from "./llm-key-backoff.ts";
import { isLlmHttpError } from "./llm-http-error.ts";
import { isAbortOrTimeoutError } from "./ai-gemini-timeout.ts";
import { isGeminiCachePayloadClientError } from "./gemini-token-estimate.ts";

export type LlmKeyReleaseOutcome =
  | "success"
  | "error"
  | "rate_limit"
  | "blocked"
  | "client_error";

/** 400 INVALID_ARGUMENT / cache-too-small — payload defect, not a dead key. */
export function isLlmClientPayloadHttpFailure(err: unknown): boolean {
  if (isLlmHttpError(err)) {
    if (err.status !== 400) return false;
    const blob = `${err.message} ${err.bodySnippet}`;
    return isGeminiCachePayloadClientError(blob) ||
      blob.toLowerCase().includes("invalid");
  }
  const msg = err instanceof Error ? err.message : String(err);
  return isGeminiCachePayloadClientError(msg);
}

/** True HTTP 429 / quota exhaustion — eligible for DB cooldown via batch flush. */
export function isLlmRateLimitHttpFailure(err: unknown): boolean {
  if (isLlmHttpError(err)) {
    return err.status === 429;
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (isAbortOrTimeoutError(err)) return false;
  return isSoftQuotaOrRateLimit(msg);
}

/** 401/403/suspended — blocked in DB, must not share 429 cooldown pool logic. */
export function isLlmBlockedHttpFailure(err: unknown): boolean {
  if (isLlmHttpError(err)) {
    return err.status === 401 || err.status === 403;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return isPermanentCredentialOrSuspension(msg);
}

export function classifyLlmKeyReleaseOutcome(err: unknown): LlmKeyReleaseOutcome {
  if (isLlmClientPayloadHttpFailure(err)) return "client_error";
  if (isLlmBlockedHttpFailure(err)) return "blocked";
  if (isLlmRateLimitHttpFailure(err)) return "rate_limit";
  return "error";
}
