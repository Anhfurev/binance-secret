// @ts-nocheck
import { formatUnknownError } from "./utils.ts";

const TRANSIENT_PGREST_CODES = new Set([
  "PGRST002",
  "PGRST003",
  "PGRST108",
  "PGRST504",
]);

export function extractPostgrestErrorCode(error: unknown): string | null {
  if (error && typeof error === "object") {
    const code = (error as Record<string, unknown>).code;
    if (typeof code === "string" && code.trim().length > 0) return code.trim();
  }
  return null;
}

/** PostgREST / Supabase outages that should retry and must not page Sentry as fatals. */
export function isTransientPostgrestError(error: unknown): boolean {
  const code = extractPostgrestErrorCode(error);
  if (code && TRANSIENT_PGREST_CODES.has(code)) return true;
  const msg = formatUnknownError(error).toLowerCase();
  return (
    msg.includes("schema cache") ||
    msg.includes("pgrst002") ||
    msg.includes("cloudflare_522") ||
    msg.includes("cloudflare_524") ||
    msg.includes("cloudflare_502") ||
    msg.includes("cloudflare_503") ||
    msg.includes("connection timed out")
  );
}

export async function withPostgrestRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options?: { attempts?: number; baseDelayMs?: number },
): Promise<T> {
  const attempts = Math.max(1, Math.min(5, options?.attempts ?? 3));
  const baseDelayMs = options?.baseDelayMs ?? 200;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientPostgrestError(error) || i >= attempts - 1) throw error;
      const delay = baseDelayMs * (i + 1);
      console.warn(
        `[postgrest-retry] ${label} attempt ${i + 1}/${attempts} transient: ${formatUnknownError(error)}; wait ${delay}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
