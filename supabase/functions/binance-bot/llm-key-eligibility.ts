// @ts-nocheck
import type { LlmApiKeyRow } from "./llm-api-keys-types.ts";
import { isLlmKeyLocallyCooling } from "./llm-local-cooldown-registry.ts";
import {
  getEffectiveLlmKeyErrorCount,
  isLlmErrorCountExhausted,
} from "./llm-key-error-count.ts";

/** Row from `llm_api_keys` is eligible for HTTP (UTC cooldown + not blocked + not local ledger). */
export function isLlmApiKeyRowEligible(
  row: LlmApiKeyRow,
  nowMs = Date.now(),
): boolean {
  if (row.status === "blocked") return false;
  if (
    isLlmErrorCountExhausted(getEffectiveLlmKeyErrorCount(row.id, row.error_count))
  ) {
    return false;
  }
  if (isLlmKeyLocallyCooling(row.id)) return false;
  const untilMs = row.cooldown_until ? Date.parse(row.cooldown_until) : NaN;
  if (Number.isFinite(untilMs) && untilMs > nowMs) return false;
  if (row.status === "cooldown") {
    return Number.isFinite(untilMs) && untilMs <= nowMs;
  }
  return row.status === "active";
}

export function filterEligibleLlmApiKeyRows(
  rows: LlmApiKeyRow[],
  nowMs = Date.now(),
): LlmApiKeyRow[] {
  return rows.filter((r) => isLlmApiKeyRowEligible(r, nowMs));
}
