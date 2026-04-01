/**
 * Supabase Edge Function: binance-bot
 *
 * This is the "cloud heartbeat." It is triggered every minute by Supabase
 * pg_cron (see supabase/setup-cron.sql) and calls your Next.js paper-trading
 * automation API route, which contains all the trading logic.
 *
 * Required Supabase secrets (set via Dashboard > Edge Functions > Secrets
 * OR run: supabase secrets set KEY=value):
 *
 *   SITE_URL    — your Vercel deployment URL, e.g. https://your-app.vercel.app
 *   CRON_SECRET — a random string, must match CRON_SECRET in Vercel env vars
 */

Deno.serve(async (req) => {
  // Protect the function so only your pg_cron job can call it.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (cronSecret) {
    const incoming =
      req.headers.get("x-cron-secret") ??
      req.headers.get("authorization")?.replace("Bearer ", "") ??
      "";
    if (incoming !== cronSecret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const siteUrl = Deno.env.get("SITE_URL");
  if (!siteUrl) {
    console.error("[binance-bot] SITE_URL secret is not configured");
    return new Response(
      JSON.stringify({ error: "SITE_URL secret is not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const url = `${siteUrl.replace(/\/$/, "")}/api/automation/paper/run`;
  console.log(`[binance-bot] Cloud Heartbeat → ${url}`);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (cronSecret) {
      headers["Authorization"] = `Bearer ${cronSecret}`;
    }

    const response = await fetch(url, { method: "GET", headers });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[binance-bot] API returned ${response.status}: ${text}`);
      return new Response(
        JSON.stringify({ error: `Upstream ${response.status}`, detail: text }),
        { status: response.status, headers: { "Content-Type": "application/json" } },
      );
    }

    const body = await response.json();
    console.log(
      `[binance-bot] Tick done — scanned: ${body.scanned ?? "?"}, updated: ${body.updated ?? "?"}`,
    );

    return new Response(JSON.stringify({ ok: true, ...body }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[binance-bot] Heartbeat failed: ${message}`);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});

