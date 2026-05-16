import { NextResponse } from "next/server";
import { binanceSignedSpotGet, getBinanceCredentials } from "@/lib/binance";

type FunctionHealthPayload = {
  ok?: boolean;
  function_health?: {
    status?: "alive" | "degraded" | "broken";
    alive?: boolean;
    headline?: string;
    snapshot?: Record<string, unknown>;
    debugger?: {
      ok?: boolean;
      issues?: Array<{ code?: string; message?: string; severity?: string }>;
      summary?: Record<string, unknown>;
    };
  };
};

export async function GET() {
  const supabaseUrl = (
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    ""
  ).trim();
  const botSecret = (process.env.BOT_SECRET ?? "").trim();
  const { configured: binanceConfigured } = getBinanceCredentials();

  let edge: FunctionHealthPayload | null = null;
  let edgeError: string | null = null;
  if (supabaseUrl && botSecret) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/binance-bot`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-binance-bot-secret": botSecret,
        },
        body: JSON.stringify({
          function_health: true,
          debugger_apply_fixes: false,
        }),
        cache: "no-store",
      });
      const body = (await res.json().catch(() => ({}))) as FunctionHealthPayload & {
        error?: string;
      };
      if (!res.ok) {
        edgeError = body?.error ?? `Edge function health failed (${res.status})`;
      } else {
        edge = body;
      }
    } catch (error) {
      edgeError =
        error instanceof Error ? error.message : "Edge debugger request failed";
    }
  } else {
    edgeError = "NEXT_PUBLIC_SUPABASE_URL or BOT_SECRET is not configured.";
  }

  let account: {
    canTrade?: boolean;
    usdtFree?: number;
    error?: string;
  } | null = null;
  if (binanceConfigured) {
    try {
      const info = await binanceSignedSpotGet<{
        canTrade: boolean;
        balances: Array<{ asset: string; free: string; locked: string }>;
      }>("/api/v3/account");
      const usdt = info.balances.find((b) => b.asset === "USDT");
      account = {
        canTrade: info.canTrade,
        usdtFree: usdt ? Number(usdt.free) : 0,
      };
    } catch (error) {
      account = {
        error:
          error instanceof Error ? error.message : "Binance account probe failed",
      };
    }
  }

  const edgeOk = Boolean(edge?.ok && edge?.function_health?.alive);
  const accountOk = Boolean(account?.canTrade) && !account?.error;
  const readyForLiveToggle = edgeOk && accountOk;

  return NextResponse.json({
    ready_for_live_toggle: readyForLiveToggle,
    edge: {
      ok: edgeOk,
      status: edge?.function_health?.status ?? null,
      alive: edge?.function_health?.alive ?? null,
      headline: edge?.function_health?.headline ?? null,
      error: edgeError,
      snapshot: edge?.function_health?.snapshot ?? null,
      issues: edge?.function_health?.debugger?.issues ?? [],
      summary: edge?.function_health?.debugger?.summary ?? null,
    },
    binance: {
      configured: binanceConfigured,
      account,
      gateway:
        Boolean(process.env.BINANCE_REST_GATEWAY_URL?.trim()) ||
        Boolean(process.env.BINANCE_API_GATEWAY_URL?.trim()),
    },
    note:
      "Live orders still require is_live_trading_enabled=true on the target bot_settings row.",
  });
}
