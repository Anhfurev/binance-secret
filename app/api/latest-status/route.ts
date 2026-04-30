import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

export async function GET() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json(
      { ok: false, status: null, reason: null, error: "Supabase admin not configured" },
      { status: 200 },
    );
  }

  const { data, error } = await supabaseAdmin
    .from("logs")
    .select("message, meta, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { ok: false, status: null, reason: null, error: error.message },
      { status: 200 },
    );
  }

  const row = (data ?? {}) as { message?: unknown; meta?: Record<string, unknown> };
  const status = String(row.message ?? "UNKNOWN");
  const reason = String(row.meta?.reason ?? row.meta?.detail ?? "").trim() || null;

  return NextResponse.json(
    {
      ok: true,
      status,
      reason,
    },
    { status: 200 },
  );
}
