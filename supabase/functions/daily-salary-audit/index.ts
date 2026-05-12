// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2";
import { runDailySalaryAudit } from "./audit.ts";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sendTelegram(text: string) {
  const token = (Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "").trim();
  const chatId = (
    (Deno.env.get("TELEGRAM_CHAT_ID") ?? "").trim() ||
    (Deno.env.get("TELEGRAM_BOT_CHAT_ID") ?? "").trim()
  );
  if (!token || !chatId) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
  }
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });
  const body = await response.json();
  if (!response.ok || body.ok !== true) {
    throw new Error(`Telegram send failed: ${response.status}`);
  }
}

Deno.serve(async (req: Request) => {
  try {
    const botSecret = (Deno.env.get("BOT_SECRET") ?? "").trim();
    const providedSecret = (req.headers.get("x-binance-bot-secret") ?? "").trim();
    if (!botSecret || providedSecret !== botSecret) {
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
    const audit = await runDailySalaryAudit(supabase);
    if (Deno.env.get("DAILY_SALARY_DRY_RUN") !== "1") {
      await sendTelegram(audit.text);
    }

    await supabase.from("logs").insert([{
      level: "info",
      source: "daily-salary-audit",
      message: "daily_salary_audit_sent",
      meta: {
        event: "daily_salary_audit_sent",
        ...audit.metrics,
        dry_run: Deno.env.get("DAILY_SALARY_DRY_RUN") === "1",
      },
      created_at: new Date().toISOString(),
    }]);

    return jsonResponse({ ok: true, ...audit.metrics, dry_run: Deno.env.get("DAILY_SALARY_DRY_RUN") === "1" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
