// @ts-nocheck
/** Telegram / ops side-effects that must not block the cron HTTP response. */
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { BotActionResult } from "./types.ts";
import { flushCycleLogs } from "./cycle-log-buffer.ts";
import { maybeSendCronDigestTelegram } from "./cron-telegram-digest.ts";
import {
  emitLatencyTelemetry,
  maybeSendFourHourOpsHeartbeat,
  resolveAnyLiveAutopilot,
} from "./cron-runner-telemetry.ts";
import { maybeRunScheduledDebugger } from "./debugger-auto-run.ts";
import { safeExecuteBackground } from "./safe-execute.ts";
import { maybeHandleTelegramWalletStatusCommand } from "./telegram-wallet-status.ts";
import {
  readSuperDetailedTraceTelegramEnabled,
  readTelegramNotifyErrorsAllowsSend,
  sendSuperDetailedTraceTelegram,
} from "./telegram-super-detailed-trace.ts";

export function detachCronTailSideEffects(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
  totalScanned: number;
  totalExecutionMs: number;
  allActions: BotActionResult[];
  /** When omitted, resolved in background before the 4h heartbeat. */
  hasLiveTrading?: boolean;
  functionHealth: unknown;
}): void {
  const {
    supabase,
    batchId,
    totalScanned,
    totalExecutionMs,
    allActions,
    hasLiveTrading,
    functionHealth,
  } = params;

  safeExecuteBackground(
    "emit_latency_telemetry",
    async () => {
      emitLatencyTelemetry({ batchId, totalExecutionMs });
    },
    undefined,
  );
  safeExecuteBackground(
    "flush_cycle_logs",
    () => flushCycleLogs(supabase),
    undefined,
  );
  safeExecuteBackground(
    "telegram_wallet_status_side_effects",
    () => maybeHandleTelegramWalletStatusCommand(supabase),
    undefined,
  );
  safeExecuteBackground(
    "cron_digest_telegram",
    () => maybeSendCronDigestTelegram({ supabase, batchId, totalScanned, totalExecutionMs, allActions }),
    undefined,
  );
  safeExecuteBackground(
    "four_hour_ops_heartbeat",
    async () => {
      const live = hasLiveTrading ?? await resolveAnyLiveAutopilot(supabase);
      await maybeSendFourHourOpsHeartbeat(supabase, { hasLiveTrading: live });
    },
    undefined,
  );
  safeExecuteBackground(
    "scheduled_debugger",
    () => maybeRunScheduledDebugger(supabase, batchId),
    null,
  );

  if (!readSuperDetailedTraceTelegramEnabled() || !readTelegramNotifyErrorsAllowsSend()) return;
  const fh = (functionHealth ?? {}) as Record<string, unknown>;
  safeExecuteBackground(
    "super_detailed_trace_batch",
    () =>
      Promise.allSettled(
        allActions.map((action) => sendSuperDetailedTraceTelegram(action, fh, batchId)),
      ),
    undefined,
  );
}
