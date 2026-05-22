// @ts-nocheck
/**
 * binance-bot Edge entry — hoisted isolate globals MUST load before `Deno.serve`.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./constants.ts";
import { cachedTimeOffset, lastSyncTime } from "./server-hoisted-state.ts";
import { marketCache } from "./market-cache-ws.ts";
import { readEdgeGlobalTimeoutMs, withFatalBoundary } from "./middleware-factory.ts";
import { routeRequest } from "./router.ts";
import { SUPABASE_CLIENT_OPTIONS } from "./supabase-client-options.ts";

/** Warm-isolate market rows (also imported by WS manager / prefetch). */
void marketCache;

/** Warm-isolate Binance clock offset (see `binance-time-cache.ts`). */
void cachedTimeOffset;
void lastSyncTime;

const lastAiPriceBySymbol = new Map<string, number>();
const sharedSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, SUPABASE_CLIENT_OPTIONS);
const EDGE_GLOBAL_TIMEOUT_MS = readEdgeGlobalTimeoutMs();

export { marketCache, cachedTimeOffset, lastSyncTime };

const botPortRaw = (Deno.env.get("BOT_HTTP_PORT") ?? Deno.env.get("PORT") ?? "").trim();
const botPort = botPortRaw ? Number(botPortRaw) : NaN;
const serveOpts =
  Number.isFinite(botPort) && botPort > 0
    ? { port: Math.floor(botPort), hostname: "0.0.0.0" as const }
    : undefined;

Deno.serve(serveOpts ?? {}, async (req: Request) =>
  await withFatalBoundary(sharedSupabase, () =>
    routeRequest({
      req,
      sharedSupabase,
      lastAiPriceBySymbol,
      EDGE_GLOBAL_TIMEOUT_MS,
    })
  ));
