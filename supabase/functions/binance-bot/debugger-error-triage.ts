// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

const RESOLVED_ERROR_PATTERNS = [
  /buildPaperScenarioAiStub is not defined/i,
  /withLlmConcurrency is not defined/i,
  /gtWithTolerance is not defined/i,
  /gteWithTolerance is not defined/i,
  /cannot access ['"]?isPaperTrading['"]? before initialization/i,
  /cannot access ['"]?liveStylePractice['"]? before initialization/i,
];

export function isResolvedOperationalError(message: string): boolean {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return RESOLVED_ERROR_PATTERNS.some((pattern) => pattern.test(text));
}

export async function summarizeRecentErrors(params: {
  supabase: ReturnType<typeof createClient>;
  sinceIso: string;
  sampleLimit?: number;
}): Promise<{
  total: number;
  actionable: number;
  resolved: number;
  breakdown: Record<string, number>;
}> {
  const { supabase, sinceIso, sampleLimit = 500 } = params;
  const { data, error } = await supabase
    .from("logs")
    .select("message,meta")
    .eq("level", "error")
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(sampleLimit);
  if (error) {
    return { total: 0, actionable: 0, resolved: 0, breakdown: {} };
  }
  const breakdown: Record<string, number> = {};
  let actionable = 0;
  let resolved = 0;
  for (const row of data ?? []) {
    const message = String((row as { message?: string }).message ?? "unknown");
    const detail = String((row as { meta?: { detail?: string } }).meta?.detail ?? "");
    breakdown[message] = (breakdown[message] ?? 0) + 1;
    if (isResolvedOperationalError(message) || isResolvedOperationalError(detail)) resolved += 1;
    else actionable += 1;
  }
  return {
    total: data?.length ?? 0,
    actionable,
    resolved,
    breakdown,
  };
}

export function readGroqRotationWarnThreshold(): number {
  const raw = String(Deno.env.get("DEBUGGER_GROQ_ROTATION_WARN_THRESHOLD") ?? "40").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 40;
  return Math.min(200, Math.floor(n));
}

/** Min rotation logs per key per 2h before GROQ_LIMIT_ROTATION_HIGH (multi-symbol crons exceed tiny budgets). */
export function readGroqRotationPerKey2hBudget(): number {
  const raw = String(Deno.env.get("DEBUGGER_GROQ_PER_KEY_2H_BUDGET") ?? "120").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 20) return 120;
  return Math.min(500, Math.floor(n));
}

export function readGeminiRotationPerKey2hBudget(): number {
  const raw = String(Deno.env.get("DEBUGGER_GEMINI_PER_KEY_2H_BUDGET") ?? "120").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 20) return 120;
  return Math.min(500, Math.floor(n));
}

export function readGeminiRotationWarnThreshold(): number {
  const raw = String(Deno.env.get("DEBUGGER_GEMINI_ROTATION_WARN_THRESHOLD") ?? "40").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 40;
  return Math.min(200, Math.floor(n));
}
