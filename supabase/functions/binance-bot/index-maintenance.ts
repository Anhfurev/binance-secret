// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { safeExecute } from "./safe-execute.ts";
import {
  runRetentionCleanup,
  runStaleTradeGuard,
  type RetentionRunResult,
  type StaleTradeGuardResult,
} from "./health-check.ts";

export async function handleMaintenanceOnly(
  supabase: ReturnType<typeof createClient>,
): Promise<{
  batch_id: string;
  stale_trade_guard: StaleTradeGuardResult | null;
  retention_cleanup: RetentionRunResult | null;
  capital_reservations_pruned: number | null;
}> {
  const startedAtMs = Date.now();
  const batchId = `maint-${crypto.randomUUID().slice(0, 8)}`;
  const staleResCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const [staleResult, retentionResult, capitalDel] = await Promise.all([
    safeExecute(
      "maintenance_stale_guard",
      () => runStaleTradeGuard({ supabase, batchId }),
      null,
    ),
    safeExecute(
      "maintenance_retention",
      () => runRetentionCleanup({ supabase, batchId, force: true }),
      null,
    ),
    safeExecute(
      "maintenance_capital_reservations",
      async () => {
        const result = await supabase
          .from("capital_reservations")
          .delete({ count: "exact" })
          .lt("created_at", staleResCutoff);
        if (result.error) throw result.error;
        return Number(result.count ?? 0);
      },
      null,
    ),
  ]);

  console.log("[MAINTENANCE] finished", {
    batchId,
    elapsed_ms: Date.now() - startedAtMs,
    stale: staleResult != null,
    retention: retentionResult?.ran ?? false,
    capital_reservations_pruned: capitalDel,
  });

  return {
    batch_id: batchId,
    stale_trade_guard: staleResult,
    retention_cleanup: retentionResult,
    capital_reservations_pruned: capitalDel,
  };
}
