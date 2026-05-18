// @ts-nocheck
import type { BotSettingsRow } from "./types.ts";
import { toNumber } from "./utils.ts";

/**
 * MASTER SWITCHBOARD (The Control Room)
 * Edge env + in-process defaults live in `GLOBAL_BOT_CONFIG`. Per-bot Postgres tunables
 * live in `public.bot_settings` — see `BOT_SETTINGS_CONTROL_ROOM_KEYS` and `resolveStrategyBuyRsiMax`.
 * `IS_TEST_MODE === true` relaxes AI/veto/cache gates from this module only — still use paper/sandbox for execution safety.
 * Flip to `false` before production deploy.
 */
export const IS_TEST_MODE = false;

function finiteEnvInt(
  key: string,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const raw = Deno.env.get(key)?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let v = Math.floor(n);
  if (min != null) v = Math.max(min, v);
  if (max != null) v = Math.min(max, v);
  return v;
}

function finiteEnvNumber(
  key: string,
  fallback: number,
  min?: number,
  max?: number,
): number {
  const raw = Deno.env.get(key)?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  let v = n;
  if (min != null) v = Math.max(min, v);
  if (max != null) v = Math.min(max, v);
  return v;
}

function finiteEnvFloat(
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = Deno.env.get(key)?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseMemeStrategySymbols(): readonly string[] {
  const raw = Deno.env.get("MEME_STRATEGY_SYMBOLS")?.trim();
  if (!raw) return ["PEPEUSDT"];
  return raw
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

export const GLOBAL_BOT_CONFIG = {
  get AI_CACHE_WINDOW_MS(): number {
    if (IS_TEST_MODE) return 0;
    return finiteEnvInt("AI_CACHE_WINDOW_MS", 600_000, 30_000, 900_000);
  },

  get GEMINI_MAX_KEY_ATTEMPTS_PER_CALL(): number {
    if (IS_TEST_MODE) return 2;
    return finiteEnvInt("GEMINI_MAX_KEY_ATTEMPTS_PER_CALL", 3, 1, 3);
  },

  get AI_BUY_CONVICTION_THRESHOLD(): number {
    if (IS_TEST_MODE) return 10;
    return finiteEnvInt("AI_BUY_CONVICTION_THRESHOLD", 65, 0, 100);
  },

  get STRATEGY_BUY_RSI_THRESHOLD(): number {
    if (IS_TEST_MODE) return 60;
    /** Default 53: uptrend grinds (e.g. RSI ~52) can still see strategy BUY when tape agrees (override via `rsi_buy_threshold` / env). */
    return finiteEnvInt("STRATEGY_BUY_RSI_THRESHOLD", 53, 0, 100);
  },

  /** % move vs last AI price to allow skipping a fresh LLM read (`index-ai` / `shouldRunAiCheck`). */
  get AI_PRICE_MOVE_THRESHOLD_PCT(): number {
    if (IS_TEST_MODE) return 0.05;
    return finiteEnvFloat("AI_PRICE_MOVE_THRESHOLD_PCT", 0.5, 0.05, 2);
  },

  /** When 1m RSI exceeds this, always consider a fresh AI read (see `shouldRunAiCheck`). */
  get AI_RUN_TRIGGER_RSI_HIGH(): number {
    return finiteEnvInt("AI_RUN_TRIGGER_RSI_HIGH", 70, 50, 95);
  },

  /** When 1m RSI is below this, always consider a fresh AI read. */
  get AI_RUN_TRIGGER_RSI_LOW(): number {
    return finiteEnvInt("AI_RUN_TRIGGER_RSI_LOW", 30, 5, 50);
  },

  /** Symbols (USDT pairs) that use meme-style strategy hints for LLM payloads. Env: comma list `MEME_STRATEGY_SYMBOLS`. */
  get MEME_STRATEGY_SYMBOLS(): readonly string[] {
    return parseMemeStrategySymbols();
  },

  get VETO_STALE_SIGNAL(): boolean {
    if (IS_TEST_MODE) return false;
    return Deno.env.get("VETO_STALE_SIGNAL") !== "0";
  },

  get GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE(): number {
    if (IS_TEST_MODE) return 0;
    const raw = Deno.env.get("GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE")?.trim();
    if (!raw) return 90;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 90;
    return Math.min(100, Math.max(70, Math.floor(n)));
  },

  get GROQ_VETO_ON_CACHE_HIT(): boolean {
    if (IS_TEST_MODE) return false;
    const raw = (Deno.env.get("GROQ_VETO_ON_CACHE_HIT") ?? "0")
      .trim()
      .toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes";
  },

  get VETO_FAST_1M_5BAR_RETURN_PCT(): number {
    if (IS_TEST_MODE) return -1e9;
    return finiteEnvNumber("VETO_FAST_1M_5BAR_RETURN_PCT", -0.08, -100, 0);
  },

  get VETO_FAST_GAP_FROM_LAST_1M_CLOSE_PCT(): number {
    if (IS_TEST_MODE) return -1e9;
    return finiteEnvNumber(
      "VETO_FAST_GAP_FROM_LAST_1M_CLOSE_PCT",
      -0.08,
      -100,
      0,
    );
  },
};

/** `public.bot_settings` columns tuned alongside `GLOBAL_BOT_CONFIG` in Edge (not exhaustive for the whole app). */
export const BOT_SETTINGS_CONTROL_ROOM_KEYS = [
  "min_ai_confidence",
  "min_ai_confidence_trending",
  "min_ai_confidence_ranging",
  "min_tech_score",
  "rsi_buy_threshold",
  "ai_cache_invalidate_until",
] as const;

/**
 * BB+RSI-style entry oversold line: `bot_settings.rsi_buy_threshold` when set, else `STRATEGY_BUY_RSI_THRESHOLD` / env default.
 * Clamped 5–100.
 */
export function resolveStrategyBuyRsiMax(row?: BotSettingsRow | null): number {
  if (IS_TEST_MODE) return 60;
  const db = toNumber(row?.rsi_buy_threshold, NaN);
  if (Number.isFinite(db) && db > 0) {
    return Math.min(100, Math.max(5, Math.floor(db)));
  }
  return GLOBAL_BOT_CONFIG.STRATEGY_BUY_RSI_THRESHOLD;
}
