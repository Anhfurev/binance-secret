// @ts-nocheck
import {
  corsHeaders,
  DEFAULT_MIN_AI_CONFIDENCE,
  DEFAULT_MIN_TECH_SCORE,
} from "./constants.ts";

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

export async function safeReadJsonBody(req: Request) {
  try {
    const text = await req.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      return {
        _invalidJson: true,
        _error: error instanceof Error ? error.message : String(error),
        _raw: text.slice(0, 2000),
      };
    }
  } catch (error) {
    return {
      _invalidJson: true,
      _bodyReadError: String(error),
    };
  }
}

export function toNumber(value: unknown, fallback = 0): number {
  // Explicitly treat null/undefined as "missing" so the caller-provided fallback
  // wins instead of being silently coerced to 0 by Number(null). Historical
  // behaviour collapsed e.g. `row.stop_loss_pct = null` to `0`, which then got
  // clamped to 0.1% — producing paper-thin stops/targets.
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

/**
 * Preserve tiny decimal precision without scientific notation for logs/JSON/DB text payloads.
 */
export function toFixedNoExponents(value: number, maxFractionDigits = 20): string {
  if (!Number.isFinite(value)) return "0";
  const normalized = value.toLocaleString("fullwide", {
    useGrouping: false,
    maximumFractionDigits: Math.max(0, Math.min(20, Math.floor(maxFractionDigits))),
  });
  // Remove trailing zeros in fractional tail while keeping at least one integer digit.
  if (!normalized.includes(".")) return normalized;
  return normalized.replace(/\.?0+$/, "");
}

/** BUY floor: optional per-regime overrides on `bot_settings`; null column → global `min_ai_confidence`. */
export function resolveMinAiConfidenceForRegime(
  row: Record<string, unknown>,
  marketRegime: string,
): number {
  const base = Math.max(
    1,
    Math.min(100, toNumber(row.min_ai_confidence, DEFAULT_MIN_AI_CONFIDENCE)),
  );
  if (marketRegime === "TRENDING") {
    const t = row.min_ai_confidence_trending;
    if (t === null || t === undefined) return base;
    return Math.max(1, Math.min(100, toNumber(t, base)));
  }
  if (marketRegime === "RANGING") {
    const r = row.min_ai_confidence_ranging;
    if (r === null || r === undefined) return base;
    return Math.max(1, Math.min(100, toNumber(r, base)));
  }
  return base;
}

/**
 * Inclusive minimum technical score (1–10) from `bot_settings.min_tech_score`.
 * Used for strategy BUY gate, AI invoke when not aggressive, and preflight FAIL_TECH_SCORE.
 */
export function resolveMinTechScore(row: Record<string, unknown>): number {
  const raw = row.min_tech_score;
  if (raw === null || raw === undefined) {
    return Math.max(1, Math.min(10, DEFAULT_MIN_TECH_SCORE));
  }
  return Math.max(1, Math.min(10, Math.round(toNumber(raw, DEFAULT_MIN_TECH_SCORE))));
}

/** Optional 24h quote-volume floor from `bot_settings.min_volume_24h_quote`; <=0 disables the gate. */
export function resolveMinVolume24hQuote(row: Record<string, unknown>): number {
  const raw = toNumber(row.min_volume_24h_quote, NaN);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(0, raw);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeSymbol(raw: unknown, defaultSymbol: string): string {
  const next = toStringValue(raw)?.toUpperCase() ?? defaultSymbol;
  if (next.endsWith("USDT")) return next;
  return `${next}USDT`;
}

export function coinIdFromSymbol(symbol: string): string {
  return symbol.replace(/USDT$/i, "").toLowerCase();
}

export function safeJsonParseFromText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

/** PostgREST sometimes returns Cloudflare HTML (522/524) as `message` — never log the full body. */
export function normalizeGatewayOrHtmlError(text: string): string {
  const s = String(text ?? "");
  const looksHtml = /<!DOCTYPE/i.test(s) || /<html[\s>]/i.test(s);
  if (!looksHtml) {
    return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
  }
  if (/522|Connection timed out/i.test(s)) {
    return "cloudflare_522_supabase_origin_timeout";
  }
  if (/524/i.test(s)) return "cloudflare_524_origin_timeout";
  if (/502|Bad Gateway/i.test(s)) return "cloudflare_502_bad_gateway";
  if (/503|Service (?:Unavailable|Temporarily)/i.test(s)) {
    return "cloudflare_503_unavailable";
  }
  return "non_json_upstream_html_error";
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Unknown Error";
  }
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const obj = error as Record<string, unknown>;

    // Supabase PostgrestError shape: { message, details, hint, code, name }
    // We compose the full picture so we never hide the real Postgres error
    // (e.g. `null value in column "price" ...`) behind a bare "[object Object]".
    const msg = typeof obj.message === "string" ? obj.message.trim() : "";
    const details = typeof obj.details === "string" ? obj.details.trim() : "";
    const hint = typeof obj.hint === "string" ? obj.hint.trim() : "";
    const code = typeof obj.code === "string" ? obj.code.trim() : "";
    const hasPostgrestFields = Boolean(msg || details || hint || code);
    if (hasPostgrestFields) {
      const parts: string[] = [];
      if (code) parts.push(`[${code}]`);
      if (msg) parts.push(msg);
      if (details) parts.push(`details=${details}`);
      if (hint) parts.push(`hint=${hint}`);
      return parts.join(" ") || JSON.stringify(error);
    }

    // Some errors nest the real payload under `.error` or `.cause`.
    const nestedError = obj.error;
    if (nestedError && nestedError !== error) {
      const nested = formatUnknownError(nestedError);
      if (nested && nested !== "[object Object]") return nested;
    }
    const cause = obj.cause;
    if (cause && cause !== error) {
      const nested = formatUnknownError(cause);
      if (nested && nested !== "[object Object]") return nested;
    }

    try {
      const serialized = JSON.stringify(error);
      if (serialized && serialized !== "{}") return serialized;
    } catch {
      return "[unserializable_error_object]";
    }
  }
  return String(error);
}

