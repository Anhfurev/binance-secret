// @ts-nocheck
/** Safe extraction + one-line console telemetry for Groq / Gemini usage. */

function safeTok(n: unknown): number {
  const x = Number(n);
  return Number.isFinite(x) ? Math.max(0, Math.floor(x)) : 0;
}

export function logAiTelemetryLine(params: {
  symbol: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}): void {
  console.log(
    `[📊 AI TELEMETRY] Symbol: ${params.symbol} | Provider: ${params.provider} | Prompt: ${params.promptTokens} | Completion: ${params.completionTokens} | Total: ${params.totalTokens}`,
  );
}

export function tryParseGroqUsage(json: unknown): {
  prompt: number;
  completion: number;
  total: number;
} | null {
  try {
    const u = (json as Record<string, unknown>)?.usage;
    if (!u || typeof u !== "object") return null;
    const o = u as Record<string, unknown>;
    const prompt = safeTok(o.prompt_tokens);
    const completion = safeTok(o.completion_tokens);
    const totalRaw = safeTok(o.total_tokens);
    const total = totalRaw > 0 ? totalRaw : prompt + completion;
    return { prompt, completion, total };
  } catch {
    return null;
  }
}

export function tryParseGeminiUsage(json: unknown): {
  prompt: number;
  completion: number;
  total: number;
} | null {
  try {
    const m = (json as Record<string, unknown>)?.usageMetadata;
    if (!m || typeof m !== "object") return null;
    const o = m as Record<string, unknown>;
    const prompt = safeTok(o.promptTokenCount);
    const completion = safeTok(o.candidatesTokenCount);
    const totalRaw = safeTok(o.totalTokenCount);
    const total = totalRaw > 0 ? totalRaw : prompt + completion;
    return { prompt, completion, total };
  } catch {
    return null;
  }
}

export function emitGroqTelemetry(
  symbol: string,
  provider: string,
  json: unknown,
): void {
  try {
    const t = tryParseGroqUsage(json);
    if (!t) return;
    logAiTelemetryLine({
      symbol,
      provider,
      promptTokens: t.prompt,
      completionTokens: t.completion,
      totalTokens: t.total,
    });
  } catch {
    /* never break trading flow */
  }
}

export function emitGeminiTelemetry(
  symbol: string,
  provider: string,
  json: unknown,
): void {
  try {
    const t = tryParseGeminiUsage(json);
    if (!t) return;
    logAiTelemetryLine({
      symbol,
      provider,
      promptTokens: t.prompt,
      completionTokens: t.completion,
      totalTokens: t.total,
    });
  } catch {
    /* never break trading flow */
  }
}
