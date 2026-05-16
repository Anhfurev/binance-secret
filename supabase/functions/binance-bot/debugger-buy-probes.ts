// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

/** Mirrors `DebuggerIssue` from `health-debugger.ts` (avoid circular import). */
export type BuyPathProbeIssue = {
  code: string;
  severity: "info" | "warn" | "critical";
  message: string;
  detail?: Record<string, unknown>;
};

export function readDebuggerBuyLookbackHours(): number {
  const raw = String(Deno.env.get("DEBUGGER_BUY_LOOKBACK_HOURS") ?? "24").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.min(168, Math.floor(n));
}

export function readDebuggerBuyMinAuditsForRate(): number {
  const raw = String(Deno.env.get("DEBUGGER_BUY_MIN_AUDITS_FOR_RATE") ?? "48").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 8) return 48;
  return Math.min(500, Math.floor(n));
}

function parseVetoDetails(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw === "string" && raw.trim()) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/** Extract primary matrix / cycle reason from `war_room_audits.veto_details`. */
export function extractWarRoomHoldReason(vetoDetails: unknown): string {
  const o = parseVetoDetails(vetoDetails);
  const r = o?.reason != null ? String(o.reason) : "";
  return r.trim() || "unknown_hold";
}

/** First path segment before `|` for stable bucketing. */
export function bucketHoldReason(reason: string): string {
  const s = String(reason ?? "").trim() || "unknown_hold";
  const pipe = s.indexOf("|");
  return pipe === -1 ? s : s.slice(0, pipe).trim() || "unknown_hold";
}

export function summarizeWarRoomBuyAudits(
  rows: Array<{ final_decision?: string; veto_details?: unknown }>,
): {
  total: number;
  buy: number;
  hold: number;
  sell: number;
  hold_no_strategy: number;
  top_hold_buckets: Array<{ bucket: string; count: number }>;
} {
  let buy = 0;
  let hold = 0;
  let sell = 0;
  let hold_no_strategy = 0;
  const bucketCounts: Record<string, number> = {};
  for (const row of rows) {
    const d = String(row?.final_decision ?? "").toUpperCase();
    if (d === "BUY") buy += 1;
    else if (d === "SELL") sell += 1;
    else hold += 1;
    if (d !== "HOLD") continue;
    const reason = extractWarRoomHoldReason(row?.veto_details).toLowerCase();
    if (reason.includes("hold_no_strategy_buy")) hold_no_strategy += 1;
    const b = bucketHoldReason(extractWarRoomHoldReason(row?.veto_details));
    bucketCounts[b] = (bucketCounts[b] ?? 0) + 1;
  }
  const top_hold_buckets = Object.entries(bucketCounts)
    .map(([bucket, count]) => ({ bucket, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  return {
    total: rows.length,
    buy,
    hold,
    sell,
    hold_no_strategy,
    top_hold_buckets,
  };
}

function classifyBuyPathIssues(stats: ReturnType<typeof summarizeWarRoomBuyAudits>, minAudits: number): BuyPathProbeIssue[] {
  const issues: BuyPathProbeIssue[] = [];
  const { total, buy, hold, hold_no_strategy } = stats;
  if (total < minAudits) return issues;

  const buyRate = buy / total;
  const absent = buy === 0 && hold >= minAudits * 0.85;
  if (absent) {
    issues.push({
      code: "BUY_DECISIONS_ABSENT",
      severity: "warn",
      message: `No BUY decisions in last war_room sample (${total} rows) — check strategy + hybrid matrix + AI floors`,
      detail: {
        buy,
        hold,
        hold_no_strategy_buy: hold_no_strategy,
        hold_no_strategy_ratio: Number((hold_no_strategy / Math.max(1, hold)).toFixed(3)),
        top_hold_buckets: stats.top_hold_buckets.slice(0, 5),
      },
    });
  } else if (buyRate < 0.02 && buy < 3) {
    issues.push({
      code: "BUY_DECISION_RATE_VERY_LOW",
      severity: "info",
      message: `BUY rate very low (${(buyRate * 100).toFixed(1)}% over ${total} audits)`,
      detail: { buy, total, buy_rate: Number(buyRate.toFixed(4)), top_hold_buckets: stats.top_hold_buckets.slice(0, 5) },
    });
  }

  if (buy >= 1 && hold_no_strategy >= 28 && hold_no_strategy / Math.max(1, hold) >= 0.65) {
    issues.push({
      code: "BUY_DOMINATED_BY_NO_STRATEGY",
      severity: "warn",
      message: "Most HOLDs are hold_no_strategy_buy — strategy layer rarely confirms BUY before AI/matrix",
      detail: {
        hold_no_strategy_buy: hold_no_strategy,
        hold_total: hold,
        buy_cycles: buy,
        ratio: Number((hold_no_strategy / Math.max(1, hold)).toFixed(3)),
      },
    });
  }
  return issues;
}

/**
 * Debugger-only probes for BUY path health: war_room distribution, execution BUY
 * outcomes vs skip, bot-skip volume.
 */
export async function runBuyPathProbes(
  supabase: ReturnType<typeof createClient>,
): Promise<{ issues: BuyPathProbeIssue[]; summary: Record<string, unknown> }> {
  const issues: BuyPathProbeIssue[] = [];
  const lookbackH = readDebuggerBuyLookbackHours();
  const minAudits = readDebuggerBuyMinAuditsForRate();
  const sinceIso = new Date(Date.now() - lookbackH * 60 * 60 * 1000).toISOString();

  const [auditsRes, intendedBuyRes, botSkipRes] = await Promise.all([
    supabase
      .from("war_room_audits")
      .select("final_decision,veto_details,symbol,created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(220),
    supabase
      .from("logs")
      .select("meta,message")
      .eq("source", "execution-outcome")
      .eq("meta->>intended_decision", "BUY")
      .gte("created_at", sinceIso)
      .limit(400),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("source", "bot-skip")
      .gte("created_at", sinceIso),
  ]);

  const auditRows = Array.isArray(auditsRes.data) ? auditsRes.data : [];
  const stats = summarizeWarRoomBuyAudits(auditRows);
  issues.push(...classifyBuyPathIssues(stats, minAudits));

  const execRows = Array.isArray(intendedBuyRes.data) ? intendedBuyRes.data : [];
  let intendedBuy = 0;
  let intendedBuyExecuted = 0;
  let intendedBuySkipped = 0;
  let intendedBuyHold = 0;
  for (const row of execRows) {
    const meta = row?.meta && typeof row.meta === "object" ? row.meta as Record<string, unknown> : {};
    if (String(meta?.intended_decision ?? "").toUpperCase() !== "BUY") continue;
    intendedBuy += 1;
    const action = String(meta?.action ?? "").toLowerCase();
    if (action === "buy") intendedBuyExecuted += 1;
    else if (action === "skip") intendedBuySkipped += 1;
    else if (action === "hold") intendedBuyHold += 1;
  }

  const skipDominatesHold = intendedBuySkipped >= 15 && intendedBuySkipped > Math.max(3, intendedBuyHold);
  if (
    intendedBuy >= 18 &&
    intendedBuyExecuted === 0 &&
    skipDominatesHold
  ) {
    issues.push({
      code: "BUY_INTENT_NEVER_EXECUTED",
      severity: "warn",
      message:
        "Many matrix BUYs ended in execution-outcome skip (not hold) — buy flow is rejecting (context, war room, capital lock, etc.)",
      detail: {
        intended_buy_logs: intendedBuy,
        skipped: intendedBuySkipped,
        holds: intendedBuyHold,
        executed: intendedBuyExecuted,
        lookback_hours: lookbackH,
      },
    });
  } else if (intendedBuy >= 25 && intendedBuyHold >= 15 && intendedBuyHold > intendedBuySkipped * 2 && intendedBuyExecuted === 0) {
    issues.push({
      code: "BUY_INTENT_MOSTLY_HELD",
      severity: "info",
      message:
        "Many BUY intents logged as hold — usually an open position on that symbol or max-position guard (not a buy-flow skip bug)",
      detail: {
        intended_buy_logs: intendedBuy,
        holds: intendedBuyHold,
        skips: intendedBuySkipped,
        lookback_hours: lookbackH,
      },
    });
  }

  const botSkipCount = Number(botSkipRes.count ?? 0);
  const summary: Record<string, unknown> = {
    lookback_hours: lookbackH,
    war_room_audits_sampled: stats.total,
    war_room_buy: stats.buy,
    war_room_hold: stats.hold,
    war_room_sell: stats.sell,
    war_room_hold_no_strategy_buy: stats.hold_no_strategy,
    war_room_top_hold_buckets: stats.top_hold_buckets,
    execution_logs_intended_buy: intendedBuy,
    execution_logs_intended_buy_action_buy: intendedBuyExecuted,
    execution_logs_intended_buy_action_skip: intendedBuySkipped,
    execution_logs_intended_buy_action_hold: intendedBuyHold,
    bot_skip_logs: botSkipCount,
  };

  if (botSkipCount >= 30) {
    issues.push({
      code: "BOT_SKIP_VOLUME_HIGH",
      severity: "info",
      message: `High bot-skip volume (${botSkipCount} in ${lookbackH}h) — review skip reasons in logs`,
      detail: { count: botSkipCount, lookback_hours: lookbackH },
    });
  }

  return { issues, summary };
}
