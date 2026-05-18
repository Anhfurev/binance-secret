// @ts-nocheck
/** Pre-emptive per-symbol API key assignment (round-robin by cron symbol index). */

import { dedupeGeminiKeySlotsByValue, type GeminiKeySlot } from "./ai-keys.ts";
import {
  resolveGeminiSlotsForRuntime,
  resolveGroqKeyPlanForRuntime,
} from "./llm-api-keys-resolve.ts";
import type { GroqKeyPlan } from "./llm-api-keys-types.ts";
import { readAiProviderMatrixEnabled } from "./ai-provider-matrix.ts";
import {
  bindActiveCronBatch,
  clearCronPoolRecoverySnapshot,
  commitCronLlmKeyPool,
  resetCronLlmKeyPool,
  stashCronPoolRecoverySnapshot,
  tryGetCronLlmKeyPool,
} from "./llm-key-pool.ts";

export type CronBatchLlmKeyPools = {
  groqPlan: GroqKeyPlan;
  geminiSlots: GeminiKeySlot[];
  fetchedAtMs: number;
};

let cronBatchPools: CronBatchLlmKeyPools | null = null;
let cronBatchPoolsBatchId: string | null = null;
/** Shifts preferred slot each cron publish so parallel lanes do not align on the same index forever. */
let cronBatchLlmPoolEpochOffset = 0;
/** Per-symbol claim inside a cron isolate — spreads parallel lanes across the pool. */
let cronLaneClaimSeq = 0;

export function readPreemptiveLlmKeyRoutingEnabled(): boolean {
  const raw = String(Deno.env.get("LLM_PREEMPTIVE_KEY_ROUTING") ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "no" && raw !== "off";
}

/** True when cron should pin keys by `symbolMatrixIndex` before the first LLM HTTP call. */
export function shouldPreemptiveRouteForSymbolIndex(symbolMatrixIndex: number | undefined): boolean {
  if (!readPreemptiveLlmKeyRoutingEnabled()) return false;
  if (!readAiProviderMatrixEnabled()) return false;
  if (symbolMatrixIndex == null || !Number.isFinite(symbolMatrixIndex) || symbolMatrixIndex < 0) {
    return false;
  }
  return true;
}

export function readCronBatchLlmPoolEpochOffset(): number {
  return cronBatchLlmPoolEpochOffset;
}

/** Atomic lane salt — call once per symbol before the first LLM slot pick in a cycle. */
export function claimCronLlmLaneOffset(): number {
  const salt = cronLaneClaimSeq;
  cronLaneClaimSeq += 1;
  return salt;
}

export function resolvePreemptiveKeyIndex(symbolIndex: number, poolLength: number): number {
  if (poolLength <= 0) return 0;
  const idx = Math.max(0, Math.floor(symbolIndex));
  const combined = idx + cronBatchLlmPoolEpochOffset;
  return ((combined % poolLength) + poolLength) % poolLength;
}

/** Symbol matrix index + per-lane claim — use when parallel symbols enter LLM in the same cron tick. */
export function resolvePreemptiveKeyIndexForLane(
  symbolIndex: number,
  poolLength: number,
  laneSalt: number,
): number {
  if (poolLength <= 0) return 0;
  const idx = Math.max(0, Math.floor(symbolIndex));
  const combined = idx + cronBatchLlmPoolEpochOffset + Math.max(0, Math.floor(laneSalt));
  return ((combined % poolLength) + poolLength) % poolLength;
}

/** Primary key first, then siblings — used as fallback after a failed attempt. */
export function buildPreemptiveRotationOrder(
  preferredIndex: number,
  poolLength: number,
): number[] {
  if (poolLength <= 0) return [];
  const start = ((preferredIndex % poolLength) + poolLength) % poolLength;
  const order: number[] = [];
  for (let step = 0; step < poolLength; step += 1) {
    order.push((start + step) % poolLength);
  }
  return order;
}

/** Legacy fail-then-rotate: `(quotaIndex + 1 + step) % n`. */
export function buildQuotaRotationOrder(quotaIndex: number, poolLength: number): number[] {
  if (poolLength <= 0) return [];
  const base = Number.isFinite(quotaIndex) ? Math.floor(quotaIndex) : 0;
  const order: number[] = [];
  for (let step = 0; step < poolLength; step += 1) {
    order.push((base + 1 + step) % poolLength);
  }
  return order;
}

export async function fetchCronBatchLlmKeyPools(): Promise<CronBatchLlmKeyPools> {
  const [groqPlan, geminiSlotsRaw] = await Promise.all([
    resolveGroqKeyPlanForRuntime(),
    resolveGeminiSlotsForRuntime(),
  ]);
  const geminiSlots = dedupeGeminiKeySlotsByValue(geminiSlotsRaw);
  if (geminiSlots.length !== geminiSlotsRaw.length) {
    console.log(
      `[llm_pool] gemini_slots deduped raw=${geminiSlotsRaw.length} unique=${geminiSlots.length}`,
    );
  }
  return freezeCronBatchLlmKeyPools({ groqPlan, geminiSlots, fetchedAtMs: Date.now() });
}

/** Deep-freeze pools so parallel symbol work cannot mutate shared cycle state. */
export function freezeCronBatchLlmKeyPools(pools: CronBatchLlmKeyPools): Readonly<CronBatchLlmKeyPools> {
  const groqPlan = Object.freeze({
    ...pools.groqPlan,
    scanKeys: Object.freeze([...pools.groqPlan.scanKeys]),
    vetoKeys: Object.freeze([...pools.groqPlan.vetoKeys]),
    scanDbIds: Object.freeze([...pools.groqPlan.scanDbIds]),
    vetoDbIds: Object.freeze([...pools.groqPlan.vetoDbIds]),
    scanDbErrorCounts: Object.freeze([...pools.groqPlan.scanDbErrorCounts]),
    vetoDbErrorCounts: Object.freeze([...pools.groqPlan.vetoDbErrorCounts]),
    scanDbStatuses: Object.freeze([...pools.groqPlan.scanDbStatuses]),
    vetoDbStatuses: Object.freeze([...pools.groqPlan.vetoDbStatuses]),
    scanDbCooldownUntils: Object.freeze([...pools.groqPlan.scanDbCooldownUntils]),
    vetoDbCooldownUntils: Object.freeze([...pools.groqPlan.vetoDbCooldownUntils]),
  });
  const geminiSlots = Object.freeze(
    pools.geminiSlots.map((slot) => Object.freeze({ ...slot })),
  );
  return Object.freeze({
    groqPlan,
    geminiSlots,
    fetchedAtMs: pools.fetchedAtMs,
  });
}

export type CronLlmPoolPublishResult = {
  pools: Readonly<CronBatchLlmKeyPools>;
  hydrated: boolean;
  geminiRegistered: number;
  groqRegistered: number;
};

/** Publish read-only LLM pools + commit checkout registry (atomic swap, no null window). */
export function publishCronBatchLlmKeyPools(
  pools: CronBatchLlmKeyPools,
  batchId: string,
): CronLlmPoolPublishResult {
  const bid = String(batchId ?? "").trim();
  if (!bid) {
    return {
      pools: freezeCronBatchLlmKeyPools(pools),
      hydrated: false,
      geminiRegistered: 0,
      groqRegistered: 0,
    };
  }
  cronLaneClaimSeq = 0;
  const poolN = Math.max(pools.geminiSlots.length, pools.groqPlan.scanKeys.length, 1);
  cronBatchLlmPoolEpochOffset = (cronBatchLlmPoolEpochOffset + 1) % poolN;
  const frozen = freezeCronBatchLlmKeyPools(pools);
  cronBatchPools = frozen;
  cronBatchPoolsBatchId = bid;
  bindActiveCronBatch(bid);
  const hydrated = commitCronLlmKeyPool(frozen, bid);
  if (hydrated) stashCronPoolRecoverySnapshot(bid, frozen);
  const keyPool = tryGetCronLlmKeyPool(bid);
  const gem = keyPool?.getStats("gemini") ?? { total: 0, available: 0 };
  const groq = keyPool?.getStats("groq") ?? { total: 0, available: 0 };
  console.log(
    `[llm_key_pool] hydrated=${hydrated ? 1 : 0} groq=${groq.total} gemini=${gem.total} available groq=${groq.available} gemini=${gem.available}`,
  );
  return {
    pools: frozen,
    hydrated,
    geminiRegistered: gem.total,
    groqRegistered: groq.total,
  };
}

/** Sequential gate: fetch pools from DB/env, then hydrate registry before lanes start. */
export async function hydrateCronLlmKeyPools(
  batchId: string,
): Promise<CronLlmPoolPublishResult> {
  const raw = await fetchCronBatchLlmKeyPools();
  return publishCronBatchLlmKeyPools(raw, batchId);
}

/** @deprecated use publishCronBatchLlmKeyPools */
export function setCronBatchLlmKeyPools(pools: CronBatchLlmKeyPools | null): void {
  cronBatchPools = pools ? freezeCronBatchLlmKeyPools(pools) : null;
}

export function getCronBatchLlmKeyPools(): Readonly<CronBatchLlmKeyPools> | null {
  return cronBatchPools;
}

export function clearCronBatchLlmKeyPools(expectedBatchId?: string): void {
  if (expectedBatchId) {
    const want = String(expectedBatchId).trim();
    if (cronBatchPoolsBatchId && cronBatchPoolsBatchId !== want) {
      console.log(
        `[llm_key_pool] skip stale batch cleanup want=${want.slice(0, 8)} active=${cronBatchPoolsBatchId.slice(0, 8)}`,
      );
      return;
    }
  }
  cronBatchPools = null;
  cronBatchPoolsBatchId = null;
  cronLaneClaimSeq = 0;
  clearCronPoolRecoverySnapshot(expectedBatchId);
  resetCronLlmKeyPool(expectedBatchId);
}
