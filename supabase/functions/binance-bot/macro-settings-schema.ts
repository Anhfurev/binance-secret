// @ts-nocheck
/** Parse + validate hourly macro LLM JSON → `bot_global_settings` row. */

import type { BotGlobalSettingsRow } from "./bot-global-settings.ts";
import { SAFE_MACRO_DEFAULTS } from "./bot-global-settings.ts";

export const MACRO_REGIMES = [
  "TRENDING_BULL",
  "RANGE_BOUND",
  "HIGH_RISK_CRASH",
] as const;

export type MacroRegime = (typeof MACRO_REGIMES)[number];

export function readMacroGeminiModelId(): string {
  const m = String(
    Deno.env.get("MACRO_GEMINI_MODEL") ??
      Deno.env.get("GEMINI_MACRO_MODEL") ??
      "gemini-1.5-pro",
  ).trim();
  return m.startsWith("models/") ? m : `models/${m}`;
}

export function parseMacroSettingsJson(raw: string): BotGlobalSettingsRow | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    const stripped = trimmed.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const o = parsed as Record<string, unknown>;
  const regimeRaw = String(o.market_regime ?? "").trim().toUpperCase();
  const regime = MACRO_REGIMES.includes(regimeRaw as MacroRegime)
    ? regimeRaw
    : null;
  if (!regime) return null;

  let leverage = Math.floor(Number(o.allowed_leverage));
  if (!Number.isFinite(leverage)) leverage = SAFE_MACRO_DEFAULTS.allowed_leverage;
  leverage = Math.min(50, Math.max(1, leverage));

  let mult = Number(o.global_trade_multiplier);
  if (!Number.isFinite(mult)) mult = SAFE_MACRO_DEFAULTS.global_trade_multiplier;
  mult = Math.min(1.2, Math.max(0, mult));

  return {
    market_regime: regime,
    allowed_leverage: leverage,
    global_trade_multiplier: Number(mult.toFixed(4)),
  };
}

export function extractJsonFromGeminiText(text: string): string {
  const t = String(text ?? "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start >= 0 && end > start) return t.slice(start, end + 1);
  return t;
}
