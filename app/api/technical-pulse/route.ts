import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

type TechnicalPulseRow = {
  id: string;
  createdAt: string;
  symbol: string;
  techScore: number | null;
  rsi: number | null;
  aiConfidence: number | null;
  note: string;
};

function firstString(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function truncate(text: string, max = 42) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function GET() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ traces: [] }, { status: 200 });
  }

  const { data, error } = await supabaseAdmin
    .from("bot_debug_traces")
    .select("id, created_at, symbol, tech_score, rsi, gemini_conf, groq_conf, final_decision, raw_ai_response")
    .order("created_at", { ascending: false })
    .limit(5);

  if (error) {
    return NextResponse.json(
      { traces: [], error: error.message },
      { status: 200 },
    );
  }

  const traces: TechnicalPulseRow[] = (data ?? []).map((row: any) => {
    const geminiConf = Number(row.gemini_conf);
    const groqConf = Number(row.groq_conf);
    const aiConfidence = [geminiConf, groqConf]
      .filter((value) => Number.isFinite(value))
      .reduce<number | null>((max, value) => {
        if (max === null || value > max) return value;
        return max;
      }, null);
    const raw = row.raw_ai_response as Record<string, unknown> | null;
    const modelResponse = (raw?.model_response as Record<string, unknown> | null) ?? null;
    const reason = firstString([
      raw?.force_buy_reason,
      modelResponse?.reason,
      raw?.reason,
      raw?.groq_veto && typeof raw.groq_veto === "object"
        ? (raw.groq_veto as Record<string, unknown>).reason
        : null,
    ]);
    const finalDecision = typeof row.final_decision === "string"
      ? row.final_decision.toUpperCase()
      : null;
    const noteSource = reason ?? finalDecision ?? "n/a";

    return {
      id: String(row.id ?? crypto.randomUUID()),
      createdAt: String(row.created_at ?? new Date().toISOString()),
      symbol: String(row.symbol ?? "UNKNOWN"),
      techScore: Number.isFinite(Number(row.tech_score))
        ? Number(row.tech_score)
        : null,
      rsi: Number.isFinite(Number(row.rsi)) ? Number(row.rsi) : null,
      aiConfidence,
      note: truncate(noteSource),
    };
  });

  return NextResponse.json({ traces }, { status: 200 });
}
