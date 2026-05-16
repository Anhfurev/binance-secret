function toNum(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function tradeNetUsd(row) {
  const extra = row?.extra && typeof row.extra === "object" ? row.extra : {};
  const fee =
    toNum(extra.fee_usd_buy, 0) +
    toNum(extra.fee_usd_sell, 0) +
    toNum(extra.fee_usd, 0);
  return toNum(row?.pnl, 0) - fee;
}

export function profitFactorFromNets(nets) {
  let gains = 0;
  let lossAbs = 0;
  for (const net of nets) {
    if (net > 0) gains += net;
    else if (net < 0) lossAbs += Math.abs(net);
  }
  if (lossAbs <= 0) return gains > 0 ? null : null;
  return gains / lossAbs;
}

export function expectancyFromNets(nets) {
  if (!nets.length) return 0;
  const wins = nets.filter((net) => net > 0);
  const losses = nets.filter((net) => net < 0);
  const winRate = wins.length / nets.length;
  const lossRate = losses.length / nets.length;
  const avgWin = wins.length
    ? wins.reduce((sum, net) => sum + net, 0) / wins.length
    : 0;
  const avgLoss = losses.length
    ? losses.reduce((sum, net) => sum + Math.abs(net), 0) / losses.length
    : 0;
  return winRate * avgWin - lossRate * avgLoss;
}

export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function frictionTax(feesUsd, netPnl) {
  if (!Number.isFinite(netPnl) || Math.abs(netPnl) < 1e-9) {
    return { ratio: null, pctOfNet: null };
  }
  const ratio = feesUsd / Math.abs(netPnl);
  return { ratio, pctOfNet: ratio * 100 };
}

function dailyProfitFactors(trades) {
  const byDay = new Map();
  for (const row of trades) {
    const day = String(row.closed_at ?? "").slice(0, 10);
    if (!day) continue;
    const net = tradeNetUsd(row);
    const bucket = byDay.get(day) ?? { gains: 0, lossAbs: 0 };
    if (net > 0) bucket.gains += net;
    else if (net < 0) bucket.lossAbs += Math.abs(net);
    byDay.set(day, bucket);
  }
  const factors = [];
  for (const bucket of byDay.values()) {
    if (bucket.lossAbs > 0) factors.push(bucket.gains / bucket.lossAbs);
  }
  return factors;
}

export function averageProfitFactor(trades) {
  const factors = dailyProfitFactors(trades);
  if (!factors.length) return null;
  return factors.reduce((sum, value) => sum + value, 0) / factors.length;
}

export function walkForwardEfficiency(pf24h, avgPf7d) {
  if (pf24h == null || avgPf7d == null || avgPf7d <= 0) return null;
  return pf24h / avgPf7d;
}

export function buildQuantMetrics({ trades, trades24h, trades7d, feesUsd, netPnl }) {
  const nets = trades.map((row) => tradeNetUsd(row));
  const profitFactor = profitFactorFromNets(nets);
  const expectancyUsd = expectancyFromNets(nets);
  const friction = frictionTax(feesUsd, netPnl);
  const pf24h = profitFactorFromNets((trades24h ?? trades).map((row) => tradeNetUsd(row)));
  const avgPf7d = averageProfitFactor(trades7d ?? []);
  const wfe = walkForwardEfficiency(pf24h, avgPf7d);
  return {
    profitFactor,
    profitFactorTarget: 1.5,
    profitFactorMeetsTarget: profitFactor != null && profitFactor >= 1.5,
    expectancyUsd,
    walkForwardEfficiency: wfe,
    profitFactor24h: pf24h,
    avgProfitFactor7d: avgPf7d,
    frictionTaxRatio: friction.ratio,
    frictionTaxPctOfNet: friction.pctOfNet,
  };
}
