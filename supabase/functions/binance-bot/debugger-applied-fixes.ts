// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { getAiQuotaState, patchAiQuotaState } from "./ai-db.ts";
import { readPaperStartingBalanceResyncEnabled } from "./paper-balance.ts";
import {
  readPaperWalletReconcileEnabled,
  reconcilePaperDemoBalanceForUser,
} from "./paper-wallet-reconcile.ts";
import type { DebuggerFix } from "./health-debugger.ts";

export async function runDebuggerAppliedFixes(params: {
  supabase: ReturnType<typeof createClient>;
  applyFixes: boolean;
  staleLockIso: string;
  staleLockCount: number;
}): Promise<DebuggerFix[]> {
  const { supabase, applyFixes, staleLockIso, staleLockCount } = params;
  const fixes: DebuggerFix[] = [];
  if (!applyFixes) return fixes;

  if (staleLockCount > 0) {
    const staleDelete = await supabase
      .from("capital_reservations")
      .delete({ count: "exact" })
      .lt("created_at", staleLockIso);
    fixes.push({
      code: "PURGE_STALE_CAPITAL_RESERVATIONS",
      applied: !staleDelete.error,
      note: staleDelete.error ? staleDelete.error.message : "Removed stale reservation locks",
      detail: { deleted: staleDelete.count ?? 0 },
    });
  }

  const disabledPaperBots = await supabase
    .from("bot_settings")
    .select("id,user_id,symbol,is_autopilot_enabled,is_live_trading_enabled,is_ghost_execution")
    .eq("is_autopilot_enabled", false)
    .eq("is_live_trading_enabled", false);
  const paperBotsToReenable = Array.isArray(disabledPaperBots.data)
    ? disabledPaperBots.data.filter((r: { is_ghost_execution?: boolean }) =>
      r && !r.is_ghost_execution
    )
    : [];
  if (paperBotsToReenable.length > 0) {
    const ids = paperBotsToReenable.map((r: { id?: string }) => r.id).filter(Boolean);
    const update = await supabase
      .from("bot_settings")
      .update({ is_autopilot_enabled: true, updated_at: new Date().toISOString() } as Record<
        string,
        unknown
      >)
      .in("id", ids);
    fixes.push({
      code: "REENABLE_PAPER_AUTOPILOT",
      applied: !update.error,
      note: update.error
        ? update.error.message
        : "Re-enabled autopilot for paper / demo bots (no real capital at risk)",
      detail: { reenabled_ids_count: ids.length },
    });
  }

  if (readPaperStartingBalanceResyncEnabled()) {
    const driftedProfiles = await supabase
      .from("profiles")
      .select("id,demo_balance,starting_balance")
      .filter("demo_balance", "lt", "starting_balance");
    const driftRows = Array.isArray(driftedProfiles.data) ? driftedProfiles.data : [];
    if (driftRows.length > 0) {
      const now = new Date().toISOString();
      let failed = 0;
      for (const row of driftRows) {
        const u = await supabase
          .from("profiles")
          .update({ starting_balance: row.demo_balance, updated_at: now } as Record<string, unknown>)
          .eq("id", row.id);
        if (u.error) failed += 1;
      }
      fixes.push({
        code: "RESYNC_PAPER_STARTING_BALANCE",
        applied: failed === 0,
        note: failed === 0
          ? "Re-synced profiles.starting_balance to current demo_balance for paper drawdown reset"
          : `${failed} updates failed`,
        detail: { rows_resynced: driftRows.length - failed },
      });
    }
  }

  if (readPaperWalletReconcileEnabled()) {
    const profileRows = await supabase.from("profiles").select("id");
    const ids = Array.isArray(profileRows.data)
      ? profileRows.data.map((r: { id?: string }) => r.id).filter(Boolean)
      : [];
    let reconciled = 0;
    let reconcileFailed = 0;
    for (const userId of ids) {
      try {
        const r = await reconcilePaperDemoBalanceForUser(supabase, String(userId));
        if (r.applied) reconciled += 1;
      } catch {
        reconcileFailed += 1;
      }
    }
    if (reconciled > 0 || reconcileFailed > 0) {
      fixes.push({
        code: "RECONCILE_PAPER_DEMO_BALANCE",
        applied: reconcileFailed === 0,
        note: reconcileFailed === 0
          ? "Rebased profiles.demo_balance from starting_balance + paper PnL − open notionals"
          : `${reconcileFailed} profile reconcile(s) failed`,
        detail: {
          profiles_checked: ids.length,
          profiles_rebased: reconciled,
          failed: reconcileFailed,
        },
      });
    }
  }

  const quota = await getAiQuotaState("global");
  const cooldownMs = Date.parse(String(quota?.gemini_cooldown_until ?? ""));
  if (quota && Number.isFinite(cooldownMs) && cooldownMs < Date.now()) {
    await patchAiQuotaState({
      consecutive_gemini_failures: 0,
      gemini_cooldown_until: null,
      last_failure_at: null,
    }, "global");
    fixes.push({
      code: "RESET_STALE_AI_COOLDOWN",
      applied: true,
      note: "AI cooldown had expired and was reset",
      detail: {
        previous_failures: quota.consecutive_gemini_failures,
        previous_cooldown_until: quota.gemini_cooldown_until,
      },
    });
  }

  return fixes;
}
