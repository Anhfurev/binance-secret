// @ts-nocheck
import { normalizeLlmApiKeySecret } from "./ai-keys.ts";
import { getAiCacheClient } from "./ai-db.ts";
import { isLlmHttpError, LlmHttpError } from "./llm-http-error.ts";
import { isSoftQuotaOrRateLimit } from "./llm-key-backoff.ts";
import type { LlmApiKeyRow, LlmProvider } from "./llm-api-keys-types.ts";
import { filterEligibleLlmApiKeyRows } from "./llm-key-eligibility.ts";
import {
  markLocalLlmKeyCooldown,
  readUtcIsoNow,
} from "./llm-local-cooldown-registry.ts";
import {
  canPersistLlmKeyDbFailure,
  consumeLlmKeyDbFailureBudget,
} from "./llm-key-failure-budget.ts";
import {
  hasLlmKeyFailureBeenPersisted,
  isValidLlmApiKeyRowId,
  markLlmKeyFailurePersisted,
} from "./llm-key-failure-persist.ts";
import {
  releaseLlmKeyErrorIncrementReservation,
  tryReserveLlmKeyErrorIncrement,
} from "./llm-key-error-count.ts";
import { isAbortOrTimeoutError } from "./ai-gemini-timeout.ts";
import { evictCronLlmKeyPoolState } from "./llm-key-pool.ts";

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

/** 0 = unlimited (fetch all eligible rows). Default 64 — never cap at 5. */
export function readLlmApiKeysFetchMax(): number {
  const raw = String(Deno.env.get("LLM_API_KEYS_FETCH_MAX") ?? "64").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 64;
  if (n === 0) return 0;
  return Math.min(256, Math.floor(n));
}

function mapLlmApiKeyRows(
  provider: LlmProvider,
  rows: Record<string, unknown>[],
): LlmApiKeyRow[] {
  return rows.map((r) => ({
    id: String(r.id ?? ""),
    provider: String(r.provider ?? provider) as LlmProvider,
    api_key: normalizeLlmApiKeySecret(r.api_key),
    status: String(r.status ?? "active") as LlmApiKeyRow["status"],
    cooldown_until: typeof r.cooldown_until === "string" ? r.cooldown_until : null,
    error_count: Number(r.error_count ?? 0),
    last_used_at: typeof r.last_used_at === "string" ? r.last_used_at : null,
  })).filter((r: LlmApiKeyRow) => r.id.length && r.api_key.length);
}

/** PostgREST OR: cooldown_until IS NULL OR cooldown_until < UTC now (strict ISO). */
export function buildLlmApiKeysCooldownOrFilter(utcIso = readUtcIsoNow()): string {
  return `cooldown_until.is.null,cooldown_until.lt.${utcIso}`;
}

async function fetchAvailableLlmApiKeysDirect(
  provider: LlmProvider,
): Promise<LlmApiKeyRow[]> {
  const supabase = getAiCacheClient();
  if (!supabase) return [];
  const utcNow = readUtcIsoNow();
  let q = supabase
    .from("llm_api_keys")
    .select("id,provider,api_key,status,cooldown_until,error_count,last_used_at")
    .eq("provider", provider)
    .neq("status", "blocked")
    .or(buildLlmApiKeysCooldownOrFilter(utcNow))
    .order("cooldown_until", { ascending: true, nullsFirst: true })
    .order("last_used_at", { ascending: true, nullsFirst: true });
  const max = readLlmApiKeysFetchMax();
  if (max > 0) q = q.limit(max);
  const { data, error } = await q;
  if (error) {
    console.warn(`${COOLDOWN_LOG_PREFIX} direct_fetch failed provider=${provider}: ${error.message}`);
    return [];
  }
  const mapped = mapLlmApiKeyRows(provider, (data ?? []) as Record<string, unknown>[]);
  return filterEligibleLlmApiKeyRows(mapped);
}

export async function fetchAvailableLlmApiKeys(
  provider: LlmProvider,
): Promise<LlmApiKeyRow[]> {
  const supabase = getAiCacheClient();
  if (!supabase) return [];
  const { data, error } = await supabase.rpc("llm_api_keys_fetch_available", {
    p_provider: provider,
  });
  let rows: Record<string, unknown>[] = [];
  if (error) {
    console.warn(`${COOLDOWN_LOG_PREFIX} fetch_available rpc failed provider=${provider}: ${error.message} — direct query`);
    rows = [];
  } else {
    rows = Array.isArray(data) ? data : [];
  }
  let mapped = filterEligibleLlmApiKeyRows(mapLlmApiKeyRows(provider, rows));
  if (!mapped.length) {
    mapped = await fetchAvailableLlmApiKeysDirect(provider);
  }
  const max = readLlmApiKeysFetchMax();
  if (max > 0 && mapped.length > max) {
    console.warn(
      `${COOLDOWN_LOG_PREFIX} truncating ${provider} pool ${mapped.length}→${max} (set LLM_API_KEYS_FETCH_MAX=0 for unlimited)`,
    );
    mapped = mapped.slice(0, max);
  }
  if (mapped.length) {
    console.log(`${COOLDOWN_LOG_PREFIX} loaded ${mapped.length} eligible ${provider} key(s)`);
  } else if (readLlmApiKeysDbEnabled()) {
    const { count: total } = await supabase
      .from("llm_api_keys")
      .select("id", { count: "exact", head: true })
      .eq("provider", provider);
    if ((total ?? 0) > 0) {
      console.warn(
        `${COOLDOWN_LOG_PREFIX} zero eligible ${provider} rows (pool has ${total} — all cooldown/blocked; run scripts/sql/reactivate_llm_groq_pool.sql)`,
      );
    }
  }
  return mapped;
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
  context: {
    provider: LlmProvider;
    keyIndex: number;
    symbol?: string;
    lockId?: string;
    rowErrorCount?: number;
  },
): Promise<boolean> {
  const supabase = getAiCacheClient();
  const id = String(rowId ?? "").trim();
  if (!supabase || !id) return false;
  if (!isValidLlmApiKeyRowId(id)) {
    console.warn(
      `${COOLDOWN_LOG_PREFIX} skip_persist invalid_row_id=${id.slice(0, 8)}… provider=${context.provider}`,
    );
    return false;
  }
  if (hasLlmKeyFailureBeenPersisted(id)) {
    console.warn(
      `${COOLDOWN_LOG_PREFIX} skip_duplicate_persist id=${id} provider=${context.provider} symbol=${context.symbol ?? "—"}`,
    );
    return false;
  }
  if (!tryReserveLlmKeyErrorIncrement(id, context.rowErrorCount ?? 0)) {
    console.warn(
      `[KEY ISOLATION] skip_persist error_count cap id=${id} provider=${context.provider} symbol=${context.symbol ?? "—"}`,
    );
    return false;
  }
  if (!canPersistLlmKeyDbFailure(context.symbol, context.provider)) {
    releaseLlmKeyErrorIncrementReservation(id);
    console.warn(
      `${COOLDOWN_LOG_PREFIX} skip_budget_cap id=${id} provider=${context.provider} symbol=${context.symbol ?? "—"}`,
    );
    return false;
  }
  if (isAbortOrTimeoutError(err)) {
    releaseLlmKeyErrorIncrementReservation(id);
    console.warn(
      `${COOLDOWN_LOG_PREFIX} skip_timeout_no_db_cooldown id=${id} provider=${context.provider} symbol=${context.symbol ?? "—"}`,
    );
    return false;
  }

  let reservationCommitted = false;
  try {
    let status = 0;
    let bodySnippet = "";
    if (isLlmHttpError(err)) {
      status = err.status;
      bodySnippet = err.bodySnippet;
    } else {
      const m = String((err as Error)?.message ?? err);
      bodySnippet = m.slice(0, 200);
      if (isSoftQuotaOrRateLimit(m)) status = 429;
    }

    const sym = context.symbol ? ` symbol=${context.symbol}` : "";
    const lockId = String(context.lockId ?? "").trim();

    if (status === 401 || status === 403) {
      markLocalLlmKeyCooldown({
        dbRowId: id,
        untilMs: Date.now() + 365 * 24 * 60 * 60 * 1000,
      });
      const { error } = await supabase.rpc("llm_api_key_record_blocked", { p_id: id });
      if (!error) {
        reservationCommitted = true;
        markLlmKeyFailurePersisted(id);
        consumeLlmKeyDbFailureBudget(context.symbol, context.provider);
        if (lockId) evictCronLlmKeyPoolState(lockId);
        console.warn(
          `[KEY ISOLATION] llm_api_keys id=${id} BLOCKED (single row) provider=${context.provider} idx=${context.keyIndex + 1}${sym}`,
        );
        return true;
      }
      console.warn(
        `${COOLDOWN_LOG_PREFIX} BLOCKED id=${id} failed: ${error.message}${sym}`,
      );
      return false;
    }

    if (status === 429) {
      const untilMs = markLocalLlmKeyCooldown({ dbRowId: id });
      const { error } = await supabase.rpc("llm_api_key_record_429", { p_id: id });
      if (!error) {
        reservationCommitted = true;
        markLlmKeyFailurePersisted(id);
        consumeLlmKeyDbFailureBudget(context.symbol, context.provider);
        if (lockId) evictCronLlmKeyPoolState(lockId);
        console.warn(
          `[KEY ISOLATION] llm_api_keys id=${id} COOLDOWN until ${new Date(untilMs).toISOString()} (single row) provider=${context.provider} idx=${context.keyIndex + 1}${sym}`,
        );
        return true;
      }
      console.warn(
        `${COOLDOWN_LOG_PREFIX} COOLDOWN_15m id=${id} failed: ${error.message}${sym}`,
      );
      return false;
    }

    console.warn(
      `${COOLDOWN_LOG_PREFIX} no_db_action id=${id} provider=${context.provider} idx=${
        context.keyIndex + 1
      } http=${status}${sym} detail=${bodySnippet.slice(0, 120)}`,
    );
    return false;
  } catch (rpcError) {
    console.warn(
      `${COOLDOWN_LOG_PREFIX} rpc_throw id=${id} provider=${context.provider} symbol=${context.symbol ?? "—"}: ${
        rpcError instanceof Error ? rpcError.message : String(rpcError)
      }`,
    );
    throw rpcError;
  } finally {
    if (!reservationCommitted) {
      releaseLlmKeyErrorIncrementReservation(id);
    }
  }
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
