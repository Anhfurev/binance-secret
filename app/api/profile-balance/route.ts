import { NextResponse } from "next/server";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

type ProfileBalanceRow = {
  id: string;
  demo_balance: number | string | null;
  starting_balance: number | string | null;
  updated_at: string | null;
};

function toNullableNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function GET(req: Request) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json(
      { ok: false, error: "Supabase admin not configured" },
      { status: 200 },
    );
  }

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId")?.trim();

  const query = userId
    ? supabaseAdmin
      .from("profiles")
      .select("id, demo_balance, starting_balance, updated_at")
      .eq("id", userId)
      .single()
    : supabaseAdmin
      .from("profiles")
      .select("id, demo_balance, starting_balance, updated_at")
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST116") {
      return NextResponse.json({ ok: true, profile: null }, { status: 200 });
    }
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 200 },
    );
  }

  const row = (data as ProfileBalanceRow | null) ?? null;
  if (!row) {
    return NextResponse.json({ ok: true, profile: null }, { status: 200 });
  }

  const profile = {
    id: String(row.id),
    demo_balance: toNullableNumber(row.demo_balance),
    starting_balance: toNullableNumber(row.starting_balance),
    updated_at: row.updated_at,
  };

  return NextResponse.json({ ok: true, profile }, { status: 200 });
}
