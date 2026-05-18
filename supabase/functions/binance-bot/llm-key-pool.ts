// @ts-nocheck
/** Cron-scoped `APIKeyManager` — batch-bound; hydrated before symbol lanes start. */

import type { GeminiKeySlot } from "./ai-keys.ts";
import { APIKeyManager, type ManagedApiKey } from "./api-key-manager.ts";
import type { CronBatchLlmKeyPools } from "./llm-key-preemptive-route.ts";

type CronPoolState = {
  batchId: string;
  manager: APIKeyManager;
  registeredCount: number;
};

let currentPoolState: CronPoolState | null = null;
let activeCronBatchId: string | null = null;
let frozenPoolsForRecovery: {
  batchId: string;
  pools: CronBatchLlmKeyPools;
} | null = null;

export function geminiPoolKeyId(index: number): string {
  return `gemini:${index}`;
}

export function groqScanPoolKeyId(index: number): string {
  return `groq_scan:${index}`;
}

export function groqVetoPoolKeyId(index: number): string {
  return `groq_veto:${index}`;
}

export function buildManagedKeysFromCronPools(
  pools: CronBatchLlmKeyPools,
): ManagedApiKey[] {
  const keys: ManagedApiKey[] = [];
  pools.geminiSlots.forEach((slot: GeminiKeySlot, index) => {
    const secret = String(slot.value ?? "").trim();
    if (!secret) return;
    keys.push({
      id: geminiPoolKeyId(index),
      provider: "gemini",
      secret,
      dbRowId: slot.llmDbKeyId,
    });
  });
  pools.groqPlan.scanKeys.forEach((secret, index) => {
    const s = String(secret ?? "").trim();
    if (!s) return;
    keys.push({
      id: groqScanPoolKeyId(index),
      provider: "groq",
      secret: s,
      dbRowId: pools.groqPlan.scanDbIds[index],
    });
  });
  pools.groqPlan.vetoKeys.forEach((secret, index) => {
    const s = String(secret ?? "").trim();
    if (!s) return;
    keys.push({
      id: groqVetoPoolKeyId(index),
      provider: "groq",
      secret: s,
      dbRowId: pools.groqPlan.vetoDbIds[index],
    });
  });
  return keys;
}

function poolsNeedGeminiKeys(pools: CronBatchLlmKeyPools): boolean {
  return pools.geminiSlots.some((s) => String(s.value ?? "").trim().length > 0);
}

function poolStateMatchesBatch(batchId: string): boolean {
  const bid = String(batchId ?? "").trim();
  if (!bid || !currentPoolState) return false;
  return currentPoolState.batchId === bid;
}

function poolStateIsReady(
  state: CronPoolState,
  requireGemini: boolean,
): boolean {
  return state.registeredCount > 0 &&
    state.manager.isHydrated({ requireGemini }) &&
    state.manager.countEligibleKeys() > 0;
}

export function bindActiveCronBatch(batchId: string): void {
  const bid = String(batchId ?? "").trim();
  activeCronBatchId = bid || null;
}

export function getActiveCronBatchId(): string | null {
  return activeCronBatchId;
}

export function stashCronPoolRecoverySnapshot(
  batchId: string,
  pools: CronBatchLlmKeyPools,
): void {
  const bid = String(batchId ?? "").trim();
  if (!bid) return;
  frozenPoolsForRecovery = { batchId: bid, pools };
}

export function clearCronPoolRecoverySnapshot(expectedBatchId?: string): void {
  if (expectedBatchId) {
    const want = String(expectedBatchId).trim();
    if (frozenPoolsForRecovery?.batchId !== want) {
      console.log(
        `[llm_key_pool] skip stale recovery clear want=${want.slice(0, 8)} have=${frozenPoolsForRecovery?.batchId?.slice(0, 8) ?? "none"}`,
      );
      return;
    }
  }
  frozenPoolsForRecovery = null;
}

function tryMicroHydrateCronLlmKeyPool(batchId: string): boolean {
  const bid = String(batchId ?? "").trim();
  if (!bid) return false;
  const snap = frozenPoolsForRecovery;
  if (!snap || snap.batchId !== bid) return false;
  console.log(`[llm_key_pool] micro-hydrate batch=${bid.slice(0, 8)}`);
  return commitCronLlmKeyPool(snap.pools, bid);
}

/**
 * Build + register on a fresh manager, then atomically swap — never leaves a null window
 * for in-flight lanes from the previous cycle (same batchId only).
 */
export function commitCronLlmKeyPool(
  pools: CronBatchLlmKeyPools,
  batchId: string,
): boolean {
  const bid = String(batchId ?? "").trim();
  if (!bid) {
    console.warn("[llm_key_pool] commit rejected — missing batchId");
    return false;
  }
  const keys = buildManagedKeysFromCronPools(pools);
  if (keys.length === 0) {
    console.warn(`[llm_key_pool] zero eligible keys batch=${bid.slice(0, 8)}`);
    return false;
  }
  const next = new APIKeyManager();
  next.registerKeys(keys);
  const requireGemini = poolsNeedGeminiKeys(pools);
  if (!next.isHydrated({ requireGemini })) {
    console.warn(
      `[llm_key_pool] hydration failed keys=${keys.length} require_gemini=${requireGemini ? 1 : 0} batch=${bid.slice(0, 8)}`,
    );
    return false;
  }
  const retiring = currentPoolState;
  if (retiring && retiring.batchId !== bid) {
    retiring.manager.reset();
  }
  currentPoolState = {
    batchId: bid,
    manager: next,
    registeredCount: keys.length,
  };
  bindActiveCronBatch(bid);
  if (retiring?.batchId === bid) retiring.manager.reset();
  return true;
}

export function isCronLlmKeyPoolHydrated(batchId?: string): boolean {
  const bid = String(batchId ?? activeCronBatchId ?? "").trim();
  if (!bid || !poolStateMatchesBatch(bid)) return false;
  const state = currentPoolState!;
  const requireGemini = state.manager.getStats("gemini").total > 0;
  return poolStateIsReady(state, requireGemini);
}

export function resolveCronLlmKeyPool(batchId?: string): APIKeyManager | null {
  const bid = String(batchId ?? activeCronBatchId ?? "").trim();
  if (!bid) return null;
  const state = currentPoolState;
  if (state?.batchId === bid) {
    const requireGemini = state.manager.getStats("gemini").total > 0;
    if (poolStateIsReady(state, requireGemini)) return state.manager;
  }
  if (tryMicroHydrateCronLlmKeyPool(bid)) {
    const restored = currentPoolState;
    if (restored?.batchId === bid) return restored.manager;
  }
  return null;
}

export function initCronLlmKeyPool(
  pools: CronBatchLlmKeyPools,
  batchId: string,
): APIKeyManager {
  if (!commitCronLlmKeyPool(pools, batchId)) {
    throw new Error("[llm_key_pool] commit failed — no eligible keys registered");
  }
  return currentPoolState!.manager;
}

export function getCronLlmKeyPool(batchId?: string): APIKeyManager {
  const pool = resolveCronLlmKeyPool(batchId);
  if (!pool) {
    const bid = String(batchId ?? activeCronBatchId ?? "").trim();
    throw new Error(
      `[llm_key_pool] not ready for batch=${bid || "unknown"} — hydrateCronLlmKeyPools(batchId) before symbol lanes`,
    );
  }
  return pool;
}

export function tryGetCronLlmKeyPool(batchId?: string): APIKeyManager | null {
  return resolveCronLlmKeyPool(batchId);
}

export function setCronLlmKeyPoolForTest(
  pool: APIKeyManager,
  batchId = "test-batch",
): void {
  const bid = String(batchId).trim() || "test-batch";
  currentPoolState = {
    batchId: bid,
    manager: pool,
    registeredCount: pool.registeredKeyCount(),
  };
  bindActiveCronBatch(bid);
}

export function resetCronLlmKeyPool(expectedBatchId?: string): void {
  if (expectedBatchId) {
    const want = String(expectedBatchId).trim();
    if (!poolStateMatchesBatch(want)) {
      console.log(
        `[llm_key_pool] skip stale pool reset want=${want.slice(0, 8)} have=${currentPoolState?.batchId?.slice(0, 8) ?? "none"}`,
      );
      return;
    }
  }
  currentPoolState?.manager.reset();
  currentPoolState = null;
  if (!expectedBatchId || activeCronBatchId === expectedBatchId) {
    activeCronBatchId = null;
  }
}

export function evictCronLlmKeyPoolState(keyId: string, batchId?: string): void {
  const id = String(keyId ?? "").trim();
  if (!id) return;
  tryGetCronLlmKeyPool(batchId)?.markAvailable(id);
}

export function readLlmCheckoutTimeoutMs(): number {
  const raw = Number(Deno.env.get("LLM_KEY_CHECKOUT_TIMEOUT_MS") ?? "15000");
  if (!Number.isFinite(raw)) return 15_000;
  return Math.min(60_000, Math.max(2000, Math.floor(raw)));
}
