// @ts-nocheck
/** Shared Supabase JS client options — reuse TCP/TLS via HTTP keep-alive on edge ticks. */
import type { SupabaseClientOptions } from "npm:@supabase/supabase-js@2";

export const SUPABASE_CLIENT_OPTIONS: SupabaseClientOptions<"public"> = {
  auth: { autoRefreshToken: false, persistSession: false },
  global: {
    headers: {
      Connection: "keep-alive",
    },
  },
};
