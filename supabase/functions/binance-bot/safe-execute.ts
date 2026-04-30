// @ts-nocheck
/**
 * Safe execution wrappers — one failing subsystem (DB, CCXT, AI) returns a
 * fallback instead of unwinding the whole Edge invocation.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./constants.ts";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
    const msg = errorMessage(error);
    console.error(`❌ [SYSTEM CRASH PREVENTED] ${taskName}:`, msg);
    await persistSafeExecuteError(taskName, error);
    if (taskName.includes("db_load_open_trade")) {
      throw error;
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
