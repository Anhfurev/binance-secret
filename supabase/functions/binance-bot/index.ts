// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { SERVICE_ROLE_KEY, SUPABASE_URL } from "./constants.ts";
import { readEdgeGlobalTimeoutMs, withFatalBoundary } from "./middleware-factory.ts";
import { routeRequest } from "./router.ts";

const lastAiPriceBySymbol = new Map<string, number>();
const sharedSupabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const EDGE_GLOBAL_TIMEOUT_MS = readEdgeGlobalTimeoutMs();
let inFlightCycleStartedAt: number | null = null;

Deno.serve(async (req: Request) =>
  await withFatalBoundary(sharedSupabase, () =>
    routeRequest({
      req,
      sharedSupabase,
      lastAiPriceBySymbol,
      inFlightCycleStartedAt,
      setInFlightCycleStartedAt: (value) => {
        inFlightCycleStartedAt = value;
      },
      EDGE_GLOBAL_TIMEOUT_MS,
    })
  ));
