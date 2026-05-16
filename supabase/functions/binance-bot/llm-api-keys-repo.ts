// @ts-nocheck
import { getAiCacheClient } from "./ai-db.ts";
import { isLlmHttpError, LlmHttpError } from "./llm-http-error.ts";
import type { LlmApiKeyRow, LlmProvider } from "./llm-api-keys-types.ts";

const COOLDOWN_LOG_PREFIX = "[llm_api_keys]";

export function readLlmApiKeysDbEnabled(): boolean {
  const v = String(Deno.env.get("LLM_API_KEYS_DB") ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Per-attempt ceiling when DB pool is active (`LLM_API_KEYS_DB_HARD_TIMEOUT_MS`, default 5000). */
export function readLlmApiKeysDbHardTimeoutMs(): number {
  const n = Number(Deno.env.get("LLM_API_KEYS_DB_HARD_TIMEOUT_MS") ?? "5000");
  if (!Number.isFinite(n) || n < 1000) return 5000;
  return Math.min(30_000, Math.floor(n));
}

export async function fetchAvailableLlmApiKeys(
  provider: LlmProvider,
): Promise<LlmApiKeyRow[]> {
  const supabase = getAiCacheClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("llm_api_keys_fetch_available", {
    p_provider: provider,
  });
  if (error) {
    console.warn(`${COOLDOWN_LOG_PREFIX} fetch_available failed provider=${provider}: ${error.message}`);
    return [];
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.map((r: Record<string, unknown>) => ({
    id: String(r.id ?? ""),
    provider: String(r.provider ?? provider) as LlmProvider,
    api_key: String(r.api_key ?? "").trim(),
    status: String(r.status ?? "active") as LlmApiKeyRow["status"],
    cooldown_until: typeof r.cooldown_until === "string" ? r.cooldown_until : null,
    error_count: Number(r.error_count ?? 0),
    last_used_at: typeof r.last_used_at === "string" ? r.last_used_at : null,
  })).filter((r: LlmApiKeyRow) => r.id.length && r.api_key.length);
}

export async function touchLlmApiKeyUsed(rowId: string): Promise<void> {
  const supabase = getAiCacheClient();
  if (!supabase || !rowId) return;
  const { error } = await supabase.rpc("llm_api_key_touch_used", { p_id: rowId });
  if (error) {
    console.warn(`${COOLDOWN_LOG_PREFIX} touch_used id=${rowId} failed: ${error.message}`);
  }
}

export async function recordLlmApiKeyHttpFailure(
  rowId: string,
  err: unknown,
  context: { provider: LlmProvider; keyIndex: number; symbol?: string },
): Promise<void> {
  const supabase = getAiCacheClient();
  if (!supabase || !rowId) return;

  let status = 0;
  let bodySnippet = "";
  if (isLlmHttpError(err)) {
    status = err.status;
    bodySnippet = err.bodySnippet;
  } else {
    const m = String((err as Error)?.message ?? err);
    if (/LLM_HARD_TIMEOUT|timeout|abort/i.test(m)) status = 408;
    bodySnippet = m.slice(0, 200);
  }

  const sym = context.symbol ? ` symbol=${context.symbol}` : "";
  if (status === 401 || status === 403) {
    const { error } = await supabase.rpc("llm_api_key_record_blocked", { p_id: rowId });
    console.warn(
      `${COOLDOWN_LOG_PREFIX} BLOCKED id=${rowId} provider=${context.provider} idx=${
        context.keyIndex + 1
      } http=${status}${sym} body=${bodySnippet.slice(0, 120)} err=${error?.message ?? "ok"}`,
    );
    return;
  }

  if (status === 429 || status === 408) {
    const { error } = await supabase.rpc("llm_api_key_record_429", { p_id: rowId });
    console.warn(
      `${COOLDOWN_LOG_PREFIX} COOLDOWN_15m id=${rowId} provider=${context.provider} idx=${
        context.keyIndex + 1
      } http=${status} cooldown_until=now+15m${sym} err=${error?.message ?? "ok"}`,
    );
    return;
  }

  console.warn(
    `${COOLDOWN_LOG_PREFIX} no_db_action id=${rowId} provider=${context.provider} idx=${
      context.keyIndex + 1
    } http=${status}${sym} detail=${bodySnippet.slice(0, 120)}`,
  );
}

/** Map non-2xx responses to `LlmHttpError` for uniform handling. */
export async function responseToLlmHttpError(
  label: string,
  response: Response,
): Promise<LlmHttpError> {
  let body = "";
  try {
    body = await response.text();
  } catch {
    body = "<<body_unreadable>>";
  }
  return new LlmHttpError(
    `${label}: ${response.status} ${body.slice(0, 200)}`,
    response.status,
    body,
  );
}
