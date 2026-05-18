// @ts-nocheck
/** Checkout/checkin wrapper around `APIKeyManager` for LLM HTTP lanes. */

import {
  APIKeyCheckoutTimeoutError,
  type CheckoutHandle,
  type LlmProvider,
} from "./api-key-manager.ts";
import {
  getActiveCronBatchId,
  readLlmCheckoutTimeoutMs,
  resolveCronLlmKeyPool,
} from "./llm-key-pool.ts";
import {
  shouldSkipLlmKeyForRotation,
  type LlmKeyRotationGateOpts,
} from "./llm-key-rotation-guard.ts";

export type LlmKeyCheckoutOpts = LlmKeyRotationGateOpts & {
  provider: LlmProvider;
  preferredKeyId: string;
  timeoutMs?: number;
  /** Cron batch that owns the pool; defaults to active cron batch. */
  batchId?: string;
};

/**
 * Per-lane: bump offset → optional guard skip → checkout → fn → recordError → checkin.
 * Returns `null` when guard blocks or checkout times out (caller may try next slot).
 */
export async function withLlmKeyCheckout<T>(
  opts: LlmKeyCheckoutOpts,
  fn: (handle: CheckoutHandle) => Promise<T>,
): Promise<T | null> {
  const pool = resolveCronLlmKeyPool(opts.batchId ?? getActiveCronBatchId() ?? undefined);
  if (!pool) return null;
  pool.bumpLaneOffset();
  if (shouldSkipLlmKeyForRotation(opts)) return null;
  if (!pool.isKeyEligible(opts.preferredKeyId)) return null;

  let handle: CheckoutHandle;
  try {
    handle = await pool.checkoutKey(opts.provider, {
      preferredKeyId: opts.preferredKeyId,
      timeoutMs: opts.timeoutMs ?? readLlmCheckoutTimeoutMs(),
    });
  } catch (error) {
    if (error instanceof APIKeyCheckoutTimeoutError) return null;
    throw error;
  }

  try {
    return await fn(handle);
  } catch (error) {
    pool.recordExecutionError(handle.keyId, error);
    throw error;
  } finally {
    pool.checkinKey(handle.keyId);
  }
}

export function countPoolKeysEligible(
  keyIds: string[],
  skipKeyId?: (keyId: string) => boolean,
): number {
  const pool = resolveCronLlmKeyPool();
  if (!pool) return 0;
  let n = 0;
  for (const id of keyIds) {
    if (skipKeyId?.(id)) continue;
    if (!pool.isKeyEligible(id)) continue;
    n += 1;
  }
  return n;
}

export function countLanePoolKeysEligible(
  rotationOrder: number[],
  keyIdForIndex: (keyIndex: number) => string,
  shouldSkip: (keyIndex: number) => boolean,
  excludeKeyIndex?: number,
): number {
  const pool = resolveCronLlmKeyPool();
  if (!pool) return 0;
  let n = 0;
  for (const keyIndex of rotationOrder) {
    if (excludeKeyIndex != null && keyIndex === excludeKeyIndex) continue;
    if (shouldSkip(keyIndex)) continue;
    if (!pool.isKeyEligible(keyIdForIndex(keyIndex))) continue;
    n += 1;
  }
  return n;
}
