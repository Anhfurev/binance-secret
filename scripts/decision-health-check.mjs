#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = process.env.ENV_FILE ?? resolve(root, ".env.local");
loadEnvFile(envPath);

const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
const botSecret = requiredEnv("BOT_SECRET");
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";

const symbols = ["BTCUSDT", "SOLUSDT", "PEPEUSDT"];
const scenarios = ["momentum_buy", "oversold_buy", "force_paper_buy"];

const report = {
  checked_at: new Date().toISOString(),
  open_positions: [],
  decision_mix: { last_24h: null, prior_12h: null },
  paper_scenarios: [],
  edge_health: null,
  live_readiness: null,
};

if (serviceKey) {
  report.open_positions = await fetchOpenPositions(supabaseUrl, serviceKey);
  report.decision_mix = await fetchDecisionMix(supabaseUrl, serviceKey);
}
report.edge_health = await fetchEdgeHealth(supabaseUrl, botSecret);
for (const symbol of symbols) {
  for (const scenario of scenarios) {
    report.paper_scenarios.push(
      await runPaperScenario(supabaseUrl, botSecret, symbol, scenario),
    );
  }
}

report.live_readiness = buildLiveReadiness(report);
console.log(JSON.stringify(report, null, 2));
console.log("");
console.log(formatLiveReadinessSummary(report.live_readiness));

function loadEnvFile(path) {
  try {
    const raw = readFileSync(path, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const idx = trimmed.indexOf("=");
      if (idx <= 0) continue;
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // optional local env
  }
}

function requiredEnv(...keys) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  throw new Error(`Missing env: ${keys.join(" or ")}`);
}

async function fetchOpenPositions(url, key) {
  const query = new URL(`${url}/rest/v1/trades`);
  query.searchParams.set("select", "symbol,status,type,entryPrice,stopLoss,takeProfit,amount,value,opened_at,extra");
  query.searchParams.set("status", "ilike.open");
  query.searchParams.set("order", "opened_at.desc");
  query.searchParams.set("limit", "5");
  const res = await fetch(query, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!res.ok) return [{ error: `open trades query failed (${res.status})` }];
  const rows = await res.json();
  return Promise.all(
    rows.map(async (row) => {
      const entry = Number(row.entryPrice);
      const amount = Number(row.amount);
      const value = Number(row.value);
      const mark = await fetchMarkPrice(row.symbol);
      const unrealizedUsd =
        Number.isFinite(entry) && Number.isFinite(amount) && Number.isFinite(mark)
          ? amount * (mark - entry)
          : null;
      const unrealizedPct =
        Number.isFinite(entry) && entry > 0 && Number.isFinite(mark)
          ? ((mark / entry) - 1) * 100
          : null;
      return {
        symbol: row.symbol,
        entry,
        mark,
        stop: Number(row.stopLoss),
        take_profit: Number(row.takeProfit),
        notional_usd: value,
        unrealized_usd: unrealizedUsd == null ? null : Number(unrealizedUsd.toFixed(4)),
        unrealized_pct: unrealizedPct == null ? null : Number(unrealizedPct.toFixed(3)),
        opened_at: row.opened_at,
        is_paper: row.extra?.is_paper === true,
      };
    }),
  );
}

async function fetchMarkPrice(symbol) {
  const res = await fetch(
    `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(symbol)}`,
  );
  if (!res.ok) return null;
  const body = await res.json();
  const price = Number(body?.price);
  return Number.isFinite(price) ? price : null;
}

async function fetchDecisionMix(url, key) {
  const [last24h, prior12h] = await Promise.all([
    countDecisions(url, key, hoursAgoIso(24), new Date().toISOString()),
    countDecisions(url, key, hoursAgoIso(36), hoursAgoIso(12)),
  ]);
  return { last_24h: last24h, prior_12h: prior12h };
}

async function countDecisions(url, key, startIso, endIso) {
  const query = new URL(`${url}/rest/v1/war_room_audits`);
  query.searchParams.set("select", "final_decision,created_at");
  query.searchParams.set(
    "and",
    `(created_at.gte.${startIso},created_at.lt.${endIso})`,
  );
  query.searchParams.set("limit", "10000");
  const res = await fetch(query, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "count=exact",
    },
  });
  if (!res.ok) return { error: `war_room_audits query failed (${res.status})` };
  const rows = await res.json();
  const counts = {};
  for (const row of rows) {
    const keyName = String(row.final_decision ?? "unknown");
    counts[keyName] = (counts[keyName] ?? 0) + 1;
  }
  return { window_start: startIso, window_end: endIso, counts, sampled: rows.length };
}

function hoursAgoIso(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

async function fetchEdgeHealth(url, secret) {
  const res = await fetch(`${url}/functions/v1/binance-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-binance-bot-secret": secret,
    },
    body: JSON.stringify({ function_health: true, debugger_apply_fixes: false }),
  });
  const body = await res.json().catch(() => ({}));
  return {
    ok: Boolean(res.ok && body?.ok),
    status: body?.function_health?.status ?? null,
    headline: body?.function_health?.headline ?? null,
    issues: body?.function_health?.debugger?.issues?.length ?? null,
  };
}

async function runPaperScenario(url, secret, symbol, scenario) {
  const res = await fetch(`${url}/functions/v1/binance-bot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-binance-bot-secret": secret,
    },
    body: JSON.stringify({
      paper_scenario: scenario,
      symbol,
      paper_scenario_execute: false,
    }),
  });
  const body = await res.json().catch(() => ({}));
  const action = Array.isArray(body?.actions) ? body.actions[0] : null;
  return {
    symbol,
    scenario,
    ok: Boolean(body?.ok),
    decision: action?.decision ?? null,
    action: action?.action ?? null,
    detail: action?.detail ?? body?.error ?? null,
    dry_run: String(action?.detail ?? "").includes("paper_scenario_dry_run"),
  };
}

function buildLiveReadiness(report) {
  const edgeOk = report.edge_health?.ok === true;
  const scenarioErrors = report.paper_scenarios.filter(
    (row) => row.ok !== true || row.action === "error",
  );
  const scenarioBuy = report.paper_scenarios.filter((row) => row.decision === "BUY").length;
  const openLoss = report.open_positions.find(
    (row) => Number(row.unrealized_usd) < -5,
  );
  const holdHeavy = Number(report.decision_mix?.last_24h?.counts?.HOLD ?? 0) >
    Number(report.decision_mix?.last_24h?.counts?.BUY ?? 0) * 4;
  const checks = [
    { id: "edge_alive", ok: edgeOk, note: edgeOk ? "edge health ok" : "edge health not green yet" },
    {
      id: "synthetic_path",
      ok: scenarioErrors.length === 0,
      note: scenarioErrors.length
        ? `${scenarioErrors.length} synthetic scenario errors`
        : `${scenarioBuy}/${report.paper_scenarios.length} synthetic paths reached BUY`,
    },
    {
      id: "open_position",
      ok: !openLoss,
      note: openLoss
        ? `${openLoss.symbol} open drawdown ${openLoss.unrealized_usd} USD`
        : report.open_positions.length
        ? "open paper position within soft loss band"
        : "no open position",
    },
    {
      id: "decision_flow",
      ok: !holdHeavy,
      note: holdHeavy
        ? "mostly HOLD in last 24h — normal when chop filters are on"
        : "BUY/HOLD mix looks active",
    },
  ];
  const readyForLiveToggle = checks.every((row) => row.ok);
  return {
    ready_for_live_toggle: readyForLiveToggle,
    wait_for_tomorrow: !readyForLiveToggle,
    rerun_in_hours: readyForLiveToggle ? 0 : 4,
    checks,
    note: readyForLiveToggle
      ? "Paper + edge checks are green; still flip live one symbol at a time."
      : "Paper is on with stricter chop guards — re-run this script after the next cron burst.",
  };
}

function formatLiveReadinessSummary(liveReadiness) {
  if (!liveReadiness) return "live_readiness: unavailable";
  const lines = [
    `live_ready: ${liveReadiness.ready_for_live_toggle ? "yes" : "no"}`,
    liveReadiness.note,
  ];
  for (const check of liveReadiness.checks) {
    lines.push(`- ${check.id}: ${check.ok ? "pass" : "watch"} (${check.note})`);
  }
  if (!liveReadiness.ready_for_live_toggle) {
    lines.push(`next_check: ~${liveReadiness.rerun_in_hours}h (or after next cron burst)`);
  }
  return lines.join("\n");
}
