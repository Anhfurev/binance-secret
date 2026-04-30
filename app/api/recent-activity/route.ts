import { NextResponse } from "next/server";
import { supabaseAdmin, isSupabaseAdminConfigured } from "@/lib/supabase-admin";

type ActivityItem = {
  id: string;
  symbol: string;
  price: number;
  aiConfidence: number;
  createdAt: string;
};

export async function GET() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ activities: [] }, { status: 200 });
  }

  const { data, error } = await supabaseAdmin
    .from("logs")
    .select("id, symbol, meta, created_at")
    .or("message.eq.buy_intent_dry_run,meta->>event.eq.buy_intent_dry_run")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { activities: [], error: error.message },
      { status: 200 },
    );
  }

  const activities: ActivityItem[] = (data ?? [])
    .map((row: any) => ({
      id: String(row.id ?? crypto.randomUUID()),
      symbol: String(row.meta?.symbol ?? row.symbol ?? "UNKNOWN"),
      price: Number(row.meta?.price ?? 0),
      aiConfidence: Number(row.meta?.ai_confidence ?? 0),
      createdAt: String(row.created_at ?? new Date().toISOString()),
    }))
    .filter((item) => Number.isFinite(item.price) && item.price > 0);

  return NextResponse.json({ activities }, { status: 200 });
}
