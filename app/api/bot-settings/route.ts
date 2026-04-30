import { NextRequest, NextResponse } from "next/server";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

type BotSettingsSnapshot = {
  user_id: string | null;
  is_autopilot_enabled: boolean;
  is_live_trading_enabled: boolean;
  is_aggressive_mode: boolean;
  symbols: string[];
};

const DEFAULT_SYMBOLS = ["BTCUSDT", "PEPEUSDT", "SOLUSDT"] as const;

/** Read optional numeric field from POST body; omit key → no change. */
function readBodyNumber(
  body: Record<string, unknown>,
  key: string,
  opts?: { min?: number; max?: number; int?: boolean },
): number | undefined {
  if (!Object.prototype.hasOwnProperty.call(body, key)) return undefined;
  const v = body[key];
  if (v === null || v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  let x = opts?.int ? Math.trunc(n) : n;
  if (opts?.min !== undefined) x = Math.max(opts.min, x);
  if (opts?.max !== undefined) x = Math.min(opts.max, x);
  return x;
}

function buildTunablePatchFromBody(body: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const mic = readBodyNumber(body, "min_ai_confidence", { min: 1, max: 100, int: true });
  if (mic !== undefined) patch.min_ai_confidence = mic;
  const micTrend = readBodyNumber(body, "min_ai_confidence_trending", { min: 1, max: 100, int: true });
  if (micTrend !== undefined) patch.min_ai_confidence_trending = micTrend;
  const micRange = readBodyNumber(body, "min_ai_confidence_ranging", { min: 1, max: 100, int: true });
  if (micRange !== undefined) patch.min_ai_confidence_ranging = micRange;
  const mot = readBodyNumber(body, "max_open_trades", { min: 0, max: 100, int: true });
  if (mot !== undefined) patch.max_open_trades = mot;
  const rp = readBodyNumber(body, "risk_percent", { min: 0.1, max: 100 });
  if (rp !== undefined) patch.risk_percent = rp;
  const slp = readBodyNumber(body, "stop_loss_pct", { min: 0.1, max: 50 });
  if (slp !== undefined) patch.stop_loss_pct = slp;
  const tpp = readBodyNumber(body, "take_profit_pct", { min: 0.1, max: 100 });
  if (tpp !== undefined) patch.take_profit_pct = tpp;
  const tsp = readBodyNumber(body, "trailing_stop_pct", { min: 0.0001, max: 100 });
  if (tsp !== undefined) patch.trailing_stop_pct = tsp;
  const rsiBuy = readBodyNumber(body, "rsi_buy_threshold", { min: 1, max: 50 });
  if (rsiBuy !== undefined) patch.rsi_buy_threshold = rsiBuy;
  const rsiSell = readBodyNumber(body, "rsi_sell_threshold", { min: 50, max: 99 });
  if (rsiSell !== undefined) patch.rsi_sell_threshold = rsiSell;
  return patch;
}

async function getLatestUserId() {
  if (!supabaseAdmin) return null;
  const fromBotSettings = await supabaseAdmin
    .from("bot_settings")
    .select("user_id, updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const userFromBotSettings = fromBotSettings.data?.user_id
    ? String(fromBotSettings.data.user_id)
    : null;
  if (userFromBotSettings) return userFromBotSettings;

  const fromStatus = await supabaseAdmin
    .from("latest_account_status")
    .select("user_id, last_sync")
    .order("last_sync", { ascending: false })
    .limit(1)
    .maybeSingle();

  const userFromStatus = (fromStatus.data as any)?.user_id
    ? String((fromStatus.data as any).user_id)
    : null;
  if (userFromStatus) return userFromStatus;

  const fromBalance = await supabaseAdmin
    .from("account_balances")
    .select("user_id, timestamp")
    .order("timestamp", { ascending: false })
    .limit(1)
    .maybeSingle();

  return fromBalance.data?.user_id ? String(fromBalance.data.user_id) : null;
}

async function buildSnapshot(userId: string): Promise<BotSettingsSnapshot> {
  if (!supabaseAdmin) {
    return {
      user_id: null,
      is_autopilot_enabled: false,
      is_live_trading_enabled: false,
      is_aggressive_mode: false,
      symbols: [],
    };
  }

  const { data } = await supabaseAdmin
    .from("bot_settings")
    .select("symbol, is_autopilot_enabled, is_live_trading_enabled, is_aggressive_mode")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  const rows = Array.isArray(data) ? data : [];
  return {
    user_id: userId,
    is_autopilot_enabled: rows.some((r: any) => r?.is_autopilot_enabled === true),
    is_live_trading_enabled: rows.some((r: any) => r?.is_live_trading_enabled === true),
    is_aggressive_mode: rows.some((r: any) => r?.is_aggressive_mode === true),
    symbols: rows
      .map((r: any) => String(r?.symbol ?? ""))
      .filter((s: string) => s.length > 0),
  };
}

export async function GET() {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: "Supabase admin is not configured." }, {
      status: 500,
    });
  }

  const userId = await getLatestUserId();
  if (!userId) {
    return NextResponse.json({
      user_id: null,
      is_autopilot_enabled: false,
      is_live_trading_enabled: false,
      is_aggressive_mode: false,
      symbols: [],
    });
  }

  const snapshot = await buildSnapshot(userId);
  return NextResponse.json(snapshot);
}

export async function POST(req: NextRequest) {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return NextResponse.json({ error: "Supabase admin is not configured." }, {
      status: 500,
    });
  }

  const body = await req.json().catch(() => ({}));
  const explicitUserId = body?.user_id ? String(body.user_id) : null;
  const userId = explicitUserId ?? await getLatestUserId();
  if (!userId) {
    return NextResponse.json({ error: "No user found for bot settings update." }, {
      status: 400,
    });
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body?.is_autopilot_enabled === "boolean") {
    updatePayload.is_autopilot_enabled = body.is_autopilot_enabled;
  }
  if (typeof body?.is_live_trading_enabled === "boolean") {
    updatePayload.is_live_trading_enabled = body.is_live_trading_enabled;
  }
  if (typeof body?.is_ghost_execution === "boolean") {
    updatePayload.is_ghost_execution = body.is_ghost_execution;
  }
  if (typeof body?.is_aggressive_mode === "boolean") {
    updatePayload.is_aggressive_mode = body.is_aggressive_mode;
  }

  const tunablePatch = buildTunablePatchFromBody(body as Record<string, unknown>);
  Object.assign(updatePayload, tunablePatch);

  const updateResult = await supabaseAdmin
    .from("bot_settings")
    .update(updatePayload)
    .eq("user_id", userId);

  if (updateResult.error) {
    const upsertRows = DEFAULT_SYMBOLS.map((symbol) => ({
      user_id: userId,
      symbol,
      is_autopilot_enabled: Boolean(body?.is_autopilot_enabled ?? false),
      is_live_trading_enabled: Boolean(body?.is_live_trading_enabled ?? false),
      is_ghost_execution: Boolean(body?.is_ghost_execution ?? false),
      is_aggressive_mode: Boolean(body?.is_aggressive_mode ?? false),
      updated_at: new Date().toISOString(),
      ...tunablePatch,
    }));
    const upsert = await supabaseAdmin
      .from("bot_settings")
      .upsert(upsertRows, { onConflict: "user_id,symbol" });
    if (upsert.error) {
      return NextResponse.json({ error: upsert.error.message }, { status: 500 });
    }
  }

  const snapshot = await buildSnapshot(userId);
  return NextResponse.json(snapshot);
}
