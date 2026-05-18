// @ts-nocheck
import { getAiCacheClient } from "./ai-db.ts";
import { tryGetCronLlmKeyPool } from "./llm-key-pool.ts";
import { hasLlmKeyFailureBeenPersisted } from "./llm-key-failure-persist.ts";

const SYNC_LOG = "[llm_batch_key_sync]";

export type LlmBatchKeyFlushResult = {
  cooldownApplied: number;
  blockedApplied: number;
  cooldownIds: string[];
  blockedIds: string[];
  errors: string[];
};

/** Persist pool-marked keys — never the whole loaded pool. */
export async function flushLlmBatchKeyRegistryToDatabase(): Promise<LlmBatchKeyFlushResult> {
  const supabase = getAiCacheClient();
  const pool = tryGetCronLlmKeyPool();
  const failedAll = pool?.listDbRowIdsByStatus("cooldown") ?? [];
  const blockedAll = pool?.listDbRowIdsByStatus("disabled") ?? [];
  const cooldownIds = failedAll.filter((id) => !hasLlmKeyFailureBeenPersisted(id));
  const blockedIds = blockedAll.filter((id) => !hasLlmKeyFailureBeenPersisted(id));
  const skippedDupes =
    failedAll.length + blockedAll.length - cooldownIds.length - blockedIds.length;
  const result: LlmBatchKeyFlushResult = {
    cooldownApplied: 0,
    blockedApplied: 0,
    cooldownIds: [...cooldownIds],
    blockedIds: [...blockedIds],
    errors: [],
  };

  if (!supabase) {
    if (cooldownIds.length || blockedIds.length) {
      result.errors.push("no_supabase_client");
    }
    return result;
  }

  for (const id of cooldownIds) {
    const { error } = await supabase.rpc("llm_api_key_record_429", { p_id: id });
    if (error) {
      result.errors.push(`429:${id}:${error.message}`);
      continue;
    }
    result.cooldownApplied += 1;
  }

  for (const id of blockedIds) {
    const { error } = await supabase.rpc("llm_api_key_record_blocked", { p_id: id });
    if (error) {
      result.errors.push(`blocked:${id}:${error.message}`);
      continue;
    }
    result.blockedApplied += 1;
  }

  const stats = pool?.readPoolLogStats() ?? { inFlight: 0, cooldown: 0, disabled: 0 };
  if (result.cooldownApplied || result.blockedApplied || skippedDupes > 0) {
    console.log(
      `${SYNC_LOG} flushed cooldown=${result.cooldownApplied}/${cooldownIds.length} blocked=${result.blockedApplied}/${blockedIds.length} skipped_already_persisted=${skippedDupes} in_flight=${stats.inFlight} pool_cooldown=${stats.cooldown} pool_blocked=${stats.disabled}`,
    );
  }

  return result;
}
