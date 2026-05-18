// @ts-nocheck
import { getAiCacheClient, patchAiQuotaState } from "./ai-db.ts";

const DEFAULT_SCOPE = "global";

function isLeaseRpcUnavailable(message: string): boolean {
  const msg = message.toLowerCase();
  return (
    msg.includes("try_claim_edge_cycle_lease")
    || msg.includes("edge_cycle_lease_until")
    || (msg.includes("function") && msg.includes("does not exist"))
    || msg.includes("could not find the function")
  );
}

export async function tryClaimEdgeCycleLease(ttlSec = 120): Promise<boolean> {
  const supabase = getAiCacheClient();
  if (!supabase) {
    console.warn("[edge_cycle_lease] no_supabase_client_fail_open");
    return true;
  }
  const ttl = Math.max(30, Math.floor(Number(ttlSec) || 120));
  const { data, error } = await supabase.rpc("try_claim_edge_cycle_lease", {
    p_scope: DEFAULT_SCOPE,
    p_ttl_seconds: ttl,
  });
  if (error) {
    if (isLeaseRpcUnavailable(error.message ?? "")) {
      console.warn(`[edge_cycle_lease] rpc_unavailable_fail_open: ${error.message}`);
      return true;
    }
    console.warn(`[edge_cycle_lease] claim_rpc_failed: ${error.message}`);
    return false;
  }
  return data === true;
}

export async function releaseEdgeCycleLease(scope = DEFAULT_SCOPE): Promise<void> {
  const supabase = getAiCacheClient();
  if (!supabase) return;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("ai_quota_state")
    .update({ edge_cycle_lease_until: null, updated_at: nowIso })
    .eq("id", scope);
  if (!error) return;
  const msg = error.message ?? "";
  if (isLeaseRpcUnavailable(msg)) return;
  await patchAiQuotaState({ edge_cycle_lease_until: null }, scope);
}
