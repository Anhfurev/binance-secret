const WIN_REASONS = new Set([
  "take_profit",
  "signal_exit",
  "roi_target_hit",
  "money_machine_trailing_lock",
]);

const LOSS_REASONS = new Set([
  "stoploss_hit",
  "trailing_stop_hit",
  "money_machine_hard_stop",
]);

function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tradeFeesUsd(extra) {
  if (!extra || typeof extra !== "object") return 0;
  const buy = toNum(extra.fee_usd_buy, 0);
  const sell = toNum(extra.fee_usd_sell, 0);
  const generic = toNum(extra.fee_usd, 0);
  return buy + sell + generic;
}

function tradeImbalance(extra) {
  if (!extra || typeof extra !== "object") return null;
  const meta = extra.smart_execution_meta;
  if (meta && typeof meta === "object") {
    const imb = toNum(meta.imbalance_ratio, NaN);
    if (Number.isFinite(imb)) return imb;
  }
  const direct = toNum(extra.imbalance_ratio, NaN);
  return Number.isFinite(direct) ? direct : null;
}

function holdMinutes(row) {
  const opened = Date.parse(String(row.opened_at ?? ""));
  const closed = Date.parse(String(row.closed_at ?? ""));
  if (!Number.isFinite(opened) || !Number.isFinite(closed) || closed < opened) {
    return null;
  }
  return (closed - opened) / 60_000;
}

function normalizeBlocker(raw) {
  const text = String(raw ?? "").trim();
  if (!text) return "unknown_blocker";
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

function parseVetoReasons(vetoDetails) {
  if (!vetoDetails) return [];
  if (typeof vetoDetails === "object") {
    const reasons = vetoDetails.veto_reasons;
    return Array.isArray(reasons) ? reasons.map((r) => String(r)) : [];
  }
  try {
    const parsed = JSON.parse(String(vetoDetails));
    if (Array.isArray(parsed?.veto_reasons)) {
      return parsed.veto_reasons.map((r) => String(r));
    }
  } catch {
    return [String(vetoDetails).slice(0, 96)];
  }
  return [];
}

function bump(map, key, delta = 1) {
  const k = normalizeBlocker(key);
  map.set(k, (map.get(k) ?? 0) + delta);
}

export function buildAuditMetrics({
  trades,
  wallet,
  blockerLogs,
  warRoomAudits,
  window,
}) {
  let grossPnl = 0;
  let feesUsd = 0;
  let wins = 0;
  let losses = 0;
  let neutral = 0;
  const bySymbol = new Map();
  const holdMinutesList = [];
  const imbalanceSamples = [];
  let runningNet = 0;
  let peakNet = 0;

  for (const row of trades) {
    const pnl = toNum(row.pnl, 0);
    const fee = tradeFeesUsd(row.extra);
    const net = pnl - fee;
    grossPnl += pnl;
    feesUsd += fee;
    runningNet += net;
    peakNet = Math.max(peakNet, runningNet);

    const reason = String(row.exit_reason ?? "").toLowerCase();
    if (WIN_REASONS.has(reason) || (reason === "signal_exit" && pnl > 0)) {
      wins += 1;
    } else if (LOSS_REASONS.has(reason) || pnl < 0) {
      losses += 1;
    } else {
      neutral += 1;
    }

    const sym = String(row.symbol ?? "UNKNOWN");
    const bucket = bySymbol.get(sym) ?? {
      symbol: sym,
      trades: 0,
      netPnl: 0,
      wins: 0,
      losses: 0,
    };
    bucket.trades += 1;
    bucket.netPnl += net;
    if (WIN_REASONS.has(reason) || (reason === "signal_exit" && pnl > 0)) {
      bucket.wins += 1;
    } else if (LOSS_REASONS.has(reason) || pnl < 0) {
      bucket.losses += 1;
    }
    bySymbol.set(sym, bucket);

    const hold = holdMinutes(row);
    if (hold != null) holdMinutesList.push(hold);

    const imb = tradeImbalance(row.extra);
    if (imb != null) imbalanceSamples.push(imb);
  }

  const closedCount = trades.length;
  const decided = wins + losses;
  const winRatePct = decided > 0 ? (wins / decided) * 100 : 0;
  const avgHoldMinutes =
    holdMinutesList.length > 0
      ? holdMinutesList.reduce((a, b) => a + b, 0) / holdMinutesList.length
      : 0;
  const netPnl = grossPnl - feesUsd;
  const endingEquity = toNum(wallet?.demo_balance, 0);
  const startingEquity = endingEquity - netPnl;
  const peakEquity = startingEquity + peakNet;
  const drawdownUsd = Math.max(0, peakEquity - endingEquity);

  const blockerCounts = new Map();
  for (const row of blockerLogs) {
    const meta = row.meta && typeof row.meta === "object" ? row.meta : {};
    const holdReason = meta.hold_reason ?? meta.reason ?? meta.detail;
    if (holdReason) bump(blockerCounts, holdReason);
    else bump(blockerCounts, row.message);
  }
  for (const row of warRoomAudits) {
    const decision = String(row.final_decision ?? "").toUpperCase();
    if (decision && decision !== "BUY") {
      bump(blockerCounts, `war_room:${decision}`);
    }
    for (const reason of parseVetoReasons(row.veto_details)) {
      bump(blockerCounts, reason);
    }
  }
  const topBlockers = [...blockerCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => ({ reason, count }));

  const whaleSentiment =
    imbalanceSamples.length > 0
      ? imbalanceSamples.reduce((a, b) => a + b, 0) / imbalanceSamples.length
      : null;

  return {
    window,
    closedCount,
    grossPnl,
    feesUsd,
    netPnl,
    winRatePct,
    wins,
    losses,
    neutral,
    avgHoldMinutes,
    drawdownUsd,
    startingEquity,
    endingEquity,
    peakEquity,
    topBlockers,
    whaleSentiment,
    bySymbol: [...bySymbol.values()].sort((a, b) => b.netPnl - a.netPnl),
    maxDrawdownLimitPct: toNum(wallet?.max_drawdown_limit, 5),
  };
}
