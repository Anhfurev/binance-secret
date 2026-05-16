// @ts-nocheck
/** Pre-emptive per-symbol API key assignment (round-robin by cron symbol index). */

import type { GeminiKeySlot } from "./ai-keys.ts";
import {
  resolveGeminiSlotsForRuntime,
  resolveGroqKeyPlanForRuntime,
} from "./llm-api-keys-resolve.ts";
import type { GroqKeyPlan } from "./llm-api-keys-types.ts";
import { readAiProviderMatrixEnabled } from "./ai-provider-matrix.ts";

export type CronBatchLlmKeyPools = {
  groqPlan: GroqKeyPlan;
  geminiSlots: GeminiKeySlot[];
  fetchedAtMs: number;
};

let cronBatchPools: CronBatchLlmKeyPools | null = null;

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

export function resolvePreemptiveKeyIndex(symbolIndex: number, poolLength: number): number {
  if (poolLength <= 0) return 0;
  const idx = Math.max(0, Math.floor(symbolIndex));
  return idx % poolLength;
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
  const [groqPlan, geminiSlots] = await Promise.all([
    resolveGroqKeyPlanForRuntime(),
    resolveGeminiSlotsForRuntime(),
  ]);
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

/** Publish read-only LLM pools for the current cron isolate. */
export function publishCronBatchLlmKeyPools(pools: CronBatchLlmKeyPools): Readonly<CronBatchLlmKeyPools> {
  const frozen = freezeCronBatchLlmKeyPools(pools);
  cronBatchPools = frozen;
  return frozen;
}

/** @deprecated use publishCronBatchLlmKeyPools */
export function setCronBatchLlmKeyPools(pools: CronBatchLlmKeyPools | null): void {
  cronBatchPools = pools ? freezeCronBatchLlmKeyPools(pools) : null;
}

export function getCronBatchLlmKeyPools(): Readonly<CronBatchLlmKeyPools> | null {
  return cronBatchPools;
}

export function clearCronBatchLlmKeyPools(): void {
  cronBatchPools = null;
}
