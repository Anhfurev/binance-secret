// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import type { AiAnalysis, BotActionResult } from "./types.ts";
import { escapeHtml } from "./bot-shared.ts";
import { formatIndicatorForLog } from "./indicator-precision.ts";
import { formatCycleReason } from "./index-decision-format.ts";
import { getWsMarketCacheEntry } from "./market-cache-ws.ts";
import { sendTelegramAlert } from "./notifier.ts";
import {
  formatWalletDigestSection,
  loadWalletSummary,
} from "./telegram-wallet-summary.ts";

let lastCronDigestTelegramAt = 0;

function readCronDigestEnabled(): boolean {
  return String(Deno.env.get("TELEGRAM_CRON_DIGEST") ?? "1").trim() !== "0";
}

/** 0 = send every cron. Vultr default in ecosystem: 120000 (2 min). Max 1 h. */
function readCronDigestThrottleMs(): number {
  const raw = String(Deno.env.get("TELEGRAM_CRON_DIGEST_MS") ?? "").trim();
  if (raw === "") return 0;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, 60 * 60 * 1000);
}

function readCronDigestWalletEnabled(): boolean {
  return String(Deno.env.get("TELEGRAM_CRON_DIGEST_WALLET") ?? "1").trim() !== "0";
}

const FALLBACK_DIGEST_AI: AiAnalysis = {
  action: "HOLD",
  ai_confidence: 0,
  trend: "neutral",
  trend_alignment: false,
  reasoning: "",
};

function extractHoldReasonCode(strategyReason: string): string {
  const parts = String(strategyReason ?? "").split("|").map((part) => part.trim());
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (!part || part === "no_reason") continue;
    if (part.startsWith("execution_usd_scale=")) continue;
    if (part.startsWith("ai_quota_fallback")) continue;
    return part;
  }
  return "";
}

function formatDigestLivePrice(symbol: string): string {
  const entry = getWsMarketCacheEntry(symbol);
  const px = entry?.tick.last ?? 0;
  if (!(px > 0)) return "";
  return `$${formatIndicatorForLog(px, px)}`;
}

function formatDigestWsAge(symbol: string): string {
  const entry = getWsMarketCacheEntry(symbol);
  if (!entry?.ready) return "WS—";
  const ageSec = Math.round((Date.now() - entry.updatedAtMs) / 1000);
  if (ageSec <= 45) return `WS ${ageSec}s`;
  return `WS ${ageSec}s old`;
}

function formatDigestAiChip(action: BotActionResult): string {
  const ai = action.ai ?? FALLBACK_DIGEST_AI;
  const conf = Number(ai.ai_confidence);
  const confStr = Number.isFinite(conf) ? `${conf.toFixed(0)}%` : "—";
  return `AI ${String(ai.action ?? "HOLD")} ${confStr}`;
}

function formatDigestRsiChip(action: BotActionResult): string {
  const rsi = Number(action.indicators?.rsi);
  if (!Number.isFinite(rsi)) return "";
  return `RSI ${rsi.toFixed(0)}`;
}

export function formatCronDigestSymbolLine(action: BotActionResult): string {
  const sym = escapeHtml(action.symbol);
  const decision = escapeHtml(String(action.decision ?? "HOLD"));
  const act = escapeHtml(action.action);
  const chips = [
    formatDigestLivePrice(action.symbol),
    formatDigestWsAge(action.symbol),
    formatDigestAiChip(action),
    formatDigestRsiChip(action),
    escapeHtml(formatCronDigestActionDetail(action)),
  ].filter(Boolean);
  const chipStr = chips.length ? ` — ${chips.join(" · ")}` : "";
  return `• <b>${sym}</b> <b>${decision}</b>/${act}${chipStr}`;
}

export function formatCronDigestActionDetail(action: BotActionResult): string {
  const detail = String(action.detail ?? "").trim();
  if (action.action !== "hold") {
    return detail.slice(0, 80);
  }
  const holdReason = extractHoldReasonCode(String(action.strategy_reason ?? ""));
  if (!holdReason) {
    return detail.slice(0, 80);
  }
  const ai = action.ai ?? FALLBACK_DIGEST_AI;
  return formatCycleReason(
    holdReason,
    ai,
    action.decision ?? "HOLD",
  ).slice(0, 96);
}

/** One Telegram summarizing this cron’s bot outcomes (default: every cron, one message). */
export async function maybeSendCronDigestTelegram(params: {
  supabase: ReturnType<typeof createClient>;
  batchId: string;
  totalScanned: number;
  totalExecutionMs: number;
  allActions: BotActionResult[];
}) {
  const { supabase, batchId, totalScanned, totalExecutionMs, allActions } = params;
  if (!readCronDigestEnabled() || totalScanned <= 0 || !allActions.length) return;

  const now = Date.now();
  const throttleMs = readCronDigestThrottleMs();
  if (throttleMs > 0 && now - lastCronDigestTelegramAt < throttleMs) return;
  lastCronDigestTelegramAt = now;

  const walletSection = readCronDigestWalletEnabled()
    ? formatWalletDigestSection(await loadWalletSummary(supabase))
    : "";

  const lines = allActions.slice(0, 14).map((a) => formatCronDigestSymbolLine(a));
  const more =
    allActions.length > 14 ? `\n… +${allActions.length - 14} more` : "";
  const walletPrefix = walletSection ? `${walletSection}\n\n` : "";
  const liveNote =
    "⚡ <i>WS prices · wakes on moves (stream_wick/move) + 1m cron backup · digest every 2m</i>\n\n";
  await sendTelegramAlert(
    `📋 <b>Cron digest</b> <code>${escapeHtml(batchId.slice(0, 8))}</code>\n` +
      `${walletPrefix}${liveNote}${lines.join("\n")}${more}\n` +
      `<i>${totalScanned} bot(s) scanned · ${totalExecutionMs}ms</i>`,
  );
}
