import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const isSupabaseAdminConfigured = Boolean(
  supabaseUrl && supabaseServiceRoleKey,
);

if (isSupabaseAdminConfigured) {
  const host = (() => {
    try {
      return new URL(supabaseUrl!).hostname.slice(0, 16);
    } catch {
      return "unknown";
    }
  })();
  console.log("[supabase-admin] service client ready", {
    host: `${host}…`,
    urlEnv: "NEXT_PUBLIC_SUPABASE_URL",
    keyEnv: "SUPABASE_SERVICE_ROLE_KEY",
  });
}

export const supabaseAdmin = isSupabaseAdminConfigured
  ? createClient(supabaseUrl!, supabaseServiceRoleKey!, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: { Connection: "keep-alive" },
      },
    })
  : null;
