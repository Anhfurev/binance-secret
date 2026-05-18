// @ts-nocheck
/** Hourly macro strategist — premium Gemini via LLM key pool (latency-tolerant). */

import {
  extractGeminiText,
  geminiGenerateContent,
} from "./gemini-http.ts";
import { geminiPoolKeyId } from "./llm-key-pool.ts";
import { withLlmKeyCheckout } from "./llm-key-checkout.ts";
import { hydrateCronLlmKeyPools } from "./llm-key-preemptive-route.ts";
import { isCronLlmKeyPoolHydrated } from "./llm-key-pool.ts";
import type { MacroOhlcvBundle } from "./macro-ohlcv-bundle.ts";
import {
  extractJsonFromGeminiText,
  parseMacroSettingsJson,
  readMacroGeminiModelId,
} from "./macro-settings-schema.ts";
import type { BotGlobalSettingsRow } from "./bot-global-settings.ts";
import { formatUnknownError } from "./utils.ts";

const MACRO_SYSTEM = `You are the macro risk officer for an automated crypto futures desk.
Analyze the supplied 15-minute OHLCV streams (24 hours) for structure, volatility expansion, and liquidation cascade risk.

Return ONLY one strictly valid JSON object. No markdown, no prose, no code fences.

Schema (exact keys):
{
  "market_regime": "TRENDING_BULL" | "RANGE_BOUND" | "HIGH_RISK_CRASH",
  "allowed_leverage": number,
  "global_trade_multiplier": number
}

Rules:
- HIGH_RISK_CRASH: sharp sell-offs, volatility explosion, broken support, liquidation risk.
- TRENDING_BULL: sustained higher highs / higher lows with controlled pullbacks.
- RANGE_BOUND: chop, mean reversion, no clear directional edge.
- allowed_leverage: integer 5-10 (use 5 when volatile, 10 when stable).
- global_trade_multiplier: float 0.0 to 1.2 (scale down size in stress).`;

function buildMacroUserPayload(bundle: MacroOhlcvBundle): string {
  const summary = bundle.symbols.map((s) => {
    const last = s.candles.at(-1);
    const first = s.candles[0];
    const chg = last && first && first.close > 0
      ? (((last.close - first.close) / first.close) * 100).toFixed(2)
      : "0";
    return `${s.symbol}: bars=${s.candles.length} 24h_chg_pct=${chg} last=${last?.close ?? 0}`;
  }).join("; ");
  return `MACRO_SCAN_UTC=${new Date(bundle.fetchedAtMs).toISOString()}\nSUMMARY=${summary}\n\nOHLCV_CSV(time_ms,o,h,l,c,vol):\n${bundle.payloadText}`;
}

export async function analyzeMacroSettingsWithPro(
  bundle: MacroOhlcvBundle,
  batchId: string,
): Promise<{ settings: BotGlobalSettingsRow | null; model: string; rawText: string }> {
  const model = readMacroGeminiModelId();
  const publish = await hydrateCronLlmKeyPools(batchId);
  if (!publish.hydrated || !isCronLlmKeyPoolHydrated(batchId)) {
    throw new Error("macro_llm: key pool not hydrated");
  }

  const userText = buildMacroUserPayload(bundle);
  const keyIndex = 0;
  const keyId = geminiPoolKeyId(keyIndex);

  const rawText = await withLlmKeyCheckout(
    {
      provider: "gemini",
      preferredKeyId: keyId,
      providerLabel: "Macro hourly Gemini Pro",
      timeoutMs: readMacroLlmTimeoutMs(),
      batchId,
    },
    async (handle) => {
      const response = await geminiGenerateContent({
        apiKey: handle.secret,
        userText,
        systemInstruction: MACRO_SYSTEM,
        modelId: model,
        temperature: 0.15,
        maxOutputTokens: 256,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`macro_gemini ${response.status}: ${body.slice(0, 300)}`);
      }
      const json = await response.json();
      return extractGeminiText(json);
    },
  );

  if (!rawText) {
    return { settings: null, model, rawText: "" };
  }

  const parsed = parseMacroSettingsJson(extractJsonFromGeminiText(rawText));
  return { settings: parsed, model, rawText };
}

export function readMacroLlmTimeoutMs(): number {
  const raw = Number(Deno.env.get("MACRO_LLM_TIMEOUT_MS") ?? "120000");
  if (!Number.isFinite(raw)) return 120_000;
  return Math.min(180_000, Math.max(30_000, Math.floor(raw)));
}

export async function safeAnalyzeMacroSettings(
  bundle: MacroOhlcvBundle,
  batchId: string,
): Promise<{ settings: BotGlobalSettingsRow | null; model: string; error?: string }> {
  try {
    const result = await analyzeMacroSettingsWithPro(bundle, batchId);
    return { settings: result.settings, model: result.model };
  } catch (error) {
    return {
      settings: null,
      model: readMacroGeminiModelId(),
      error: formatUnknownError(error),
    };
  }
}
