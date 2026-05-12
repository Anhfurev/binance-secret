import { createClient } from "@supabase/supabase-js";
import { optionalEnv, requireEnv } from "./env.mjs";

export function createAuditSupabase() {
  const url = requireEnv("SUPABASE_URL");
  const key =
    optionalEnv("SUPABASE_SERVICE_ROLE_KEY") ||
    optionalEnv("DB_SERVICE_ROLE_KEY") ||
    requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function auditWindowIso(hours) {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 60 * 60 * 1000);
  return {
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    labelUtc: end.toISOString().slice(0, 10),
  };
}
