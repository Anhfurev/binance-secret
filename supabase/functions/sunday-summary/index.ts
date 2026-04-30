// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  try {
    const botSecret = Deno.env.get("BOT_SECRET") ?? "";
    const providedSecret = req.headers.get("x-binance-bot-secret") ?? "";
    if (!botSecret.trim() || providedSecret !== botSecret) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: symbolRows, error: symbolErr } = await supabase
      .from("trades")
      .select("symbol,pnl")
      .gte("created_at", new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString())
      .order("created_at", { ascending: false });
    if (symbolErr) throw symbolErr;

    const symbolTotals = new Map<string, number>();
    for (const row of symbolRows ?? []) {
      const symbol = typeof row.symbol === "string" ? row.symbol : "unknown";
      const pnl = Number(row.pnl ?? 0);
      if (!Number.isFinite(pnl)) continue;
      symbolTotals.set(symbol, (symbolTotals.get(symbol) ?? 0) + pnl);
    }
    let starSymbol = "none";
    let starPnl = Number.NEGATIVE_INFINITY;
    for (const [symbol, pnl] of symbolTotals.entries()) {
      if (pnl > starPnl) {
        starPnl = pnl;
        starSymbol = symbol;
      }
    }
    if (!Number.isFinite(starPnl)) starPnl = 0;

    const { data: totals, error: totalsErr } = await supabase
      .from("trades")
      .select("pnl")
      .gte("created_at", new Date(Date.now() - (7 * 24 * 60 * 60 * 1000)).toISOString());
    if (totalsErr) throw totalsErr;

    let totalPnl = 0;
    for (const row of totals ?? []) {
      const pnl = Number(row.pnl ?? 0);
      if (Number.isFinite(pnl)) totalPnl += pnl;
    }
    const tradeCount = (totals ?? []).length;

    const nowIso = new Date().toISOString();
    const insertPayload = {
      week_ending_at: nowIso,
      total_pnl: Number(totalPnl.toFixed(8)),
      total_trades: tradeCount,
      star_symbol: starSymbol,
      star_symbol_pnl: Number(starPnl.toFixed(8)),
      meta: {
        generated_by: "sunday-summary",
        lookback_days: 7,
      },
      created_at: nowIso,
    };
    const { error: insertErr } = await supabase.from("sunday_summaries").insert([insertPayload]);
    if (insertErr) throw insertErr;

    await supabase.from("logs").insert([{
      level: "info",
      source: "sunday-summary",
      symbol: starSymbol === "none" ? null : starSymbol,
      message: "weekly_summary_generated",
      meta: {
        event: "weekly_summary_generated",
        total_pnl: insertPayload.total_pnl,
        total_trades: tradeCount,
        star_symbol: starSymbol,
        star_symbol_pnl: insertPayload.star_symbol_pnl,
      },
      created_at: nowIso,
    }]);

    return jsonResponse({
      ok: true,
      summary: {
        total_pnl: insertPayload.total_pnl,
        total_trades: tradeCount,
        star_symbol: starSymbol,
        star_symbol_pnl: insertPayload.star_symbol_pnl,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
