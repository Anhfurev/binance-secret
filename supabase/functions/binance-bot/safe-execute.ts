// @ts-nocheck
/**
 * Safe execution wrappers — one failing subsystem (DB, CCXT, AI) returns a
 * fallback instead of unwinding the whole Edge invocation.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./constants.ts";
import { describeThrownValue, formatUnknownError, normalizeGatewayOrHtmlError } from "./utils.ts";
import { readTelegramNotifyErrorsAllowsSend } from "./telegram-super-detailed-trace.ts";

function errorMessage(error: unknown): string {
  return normalizeGatewayOrHtmlError(formatUnknownError(error));
}

const safeExecuteLogClient = SUPABASE_URL && SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  : null;

async function persistSafeExecuteError(taskName: string, error: unknown) {
  if (!safeExecuteLogClient) return;
  const detail = errorMessage(error);
  const result = await safeExecuteLogClient.from("logs").insert([{
    level: "error",
    source: "safe-execute",
    message: `safe_execute_caught:${taskName}`.slice(0, 500),
    meta: {
      event: "safe_execute_caught",
      task_name: taskName,
      detail,
    },
    created_at: new Date().toISOString(),
  }]);
  if (result.error) {
    console.error(`[safe-execute] failed to persist safe execute log: ${result.error.message}`);
  }
}

/**
 * Drop-in “debugger” style wrapper: logs start + crash-prevented on failure.
 * Argument order matches the common manual snippet: (taskName, fallback, fn).
 */
export async function safeRun<T>(
  taskName: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  console.log(`🔍 [DEBUG] Starting: ${taskName}`);
  try {
    return await fn();
  } catch (error) {
    const msg = describeThrownValue(error);
    console.error(`❌ [SYSTEM CRASH PREVENTED] ${taskName}:`, msg);
    try {
      await persistSafeExecuteError(taskName, error);
    } catch (persistErr) {
      console.error(
        `[safe-execute] persistSafeExecuteError failed for ${taskName}:`,
        describeThrownValue(persistErr),
      );
    }
    if (taskName.includes("db_load_open_trade")) {
      throw error === null || error === undefined ? new Error(msg) : error;
    }
    return fallback;
  }
}

/**
 * Same behavior as {@link safeRun}, with `(name, fn, fallback)` argument order
 * for existing call sites.
 */
export async function safeExecute<T>(
  name: string,
  fn: () => Promise<T>,
  fallback: T,
): Promise<T> {
  return safeRun(name, fallback, fn);
}

/**
 * Fire-and-forget `safeExecute` with a terminal `.catch()` so null/primitive rejections
 * or post-catch bugs never become unhandled promise rejections on the Deno event loop.
 */
type EdgeRuntimeGlobal = {
  EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
};

/** Non-blocking side work: `EdgeRuntime.waitUntil` when present, else fire-and-forget. */
export function safeExecuteBackground(
  name: string,
  fn: () => Promise<unknown>,
  fallback: unknown = undefined,
): void {
  const task = safeExecute(name, fn, fallback);
  const waitUntil = (globalThis as EdgeRuntimeGlobal).EdgeRuntime?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil(task);
    return;
  }
  void task.catch((err) => {
    console.error(
      `[safe-execute] background_surprise_rejection name=${name}:`,
      describeThrownValue(err),
    );
  });
}

export function safeExecuteDetached(
  name: string,
  fn: () => Promise<unknown>,
  fallback: unknown,
): void {
  const task = safeExecute(name, fn, fallback);
  const waitUntil = (globalThis as EdgeRuntimeGlobal).EdgeRuntime?.waitUntil;
  if (typeof waitUntil === "function") {
    waitUntil(
      task.catch((err) => {
        if (name.startsWith("super_detailed_trace_") && !readTelegramNotifyErrorsAllowsSend()) {
          console.log(
            `[TELEGRAM MUTE] Skipped super trace error log for ${name} (TELEGRAM_NOTIFY_ERRORS is false)`,
          );
          return;
        }
        console.error(
          `[safe-execute] detached_surprise_rejection name=${name}:`,
          describeThrownValue(err),
        );
      }),
    );
    return;
  }
  void task.catch((err) => {
    if (name.startsWith("super_detailed_trace_") && !readTelegramNotifyErrorsAllowsSend()) {
      console.log(
        `[TELEGRAM MUTE] Skipped super trace error log for ${name} (TELEGRAM_NOTIFY_ERRORS is false)`,
      );
      return;
    }
    console.error(
      `[safe-execute] detached_surprise_rejection name=${name}:`,
      describeThrownValue(err),
    );
  });
}
