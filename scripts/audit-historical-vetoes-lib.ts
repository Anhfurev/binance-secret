/** Core parsers + REGIME_SIDEWAYS simulation for historical veto audits. */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export type AuditRow = {
  final_decision?: string;
  veto_details?: unknown;
  technical_score?: number | null;
  ai_confidence?: number | null;
  symbol?: string;
  created_at?: string;
  /** Optional enriched export fields */
  snapshot?: Record<string, unknown>;
  market_snapshot?: Record<string, unknown>;
};

type ParsedVeto = {
  veto_reasons: string[];
  scorecard: Record<string, boolean>;
  reason: string;
  decision: string;
};

type CycleCtx = {
  symbol: string;
  aiConfidence: number | null;
  techScore: number | null;
  vetoCodes: string[];
  strategyFail: string | null;
  adx14: number | null;
  rsi: number | null;
  marketRegime: string | null;
  bbWidth: number | null;
  scorecard: Record<string, boolean>;
  holdReason: string;
};

const ADX_SIDE = numEnv("DYNAMIC_REGIME_ADX_SIDEWAYS", 20);
const ADX_TREND = numEnv("DYNAMIC_REGIME_ADX_TREND", 22);
const BB_SIDE_MAX = numEnv("DYNAMIC_REGIME_BB_WIDTH_SIDEWAYS", 0.035);
const SIDEWAYS_RSI_MAX = numEnv("REGIME_SIDEWAYS_RSI_ENTRY_MAX", 42);
const SIDEWAYS_AI_FLOOR = numEnv("REGIME_SIDEWAYS_MIN_AI_CONF", 52);
const VOL_SCALE = numEnv("SMART_FILTER_MICRO_CAP_VOL_SCALE", 0.35);
const MICRO_MARKERS = ["PEPE", "MEME", "DOGE", "SHIB", "WIF", "BONK", "FLOKI"];

function numEnv(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) ? n : fallback;
}

export function loadEnvFile(path: string): void {
  if (!existsSync(path)) return;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!(k in process.env)) process.env[k] = v;
  }
}

export function parseArgs(argv: string[]) {
  const args = {
    input: "",
    dir: "",
    out: "",
    fetch: false,
    hours: 168,
    format: "markdown" as "markdown" | "console",
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input" && argv[i + 1]) args.input = argv[++i];
    else if (a === "--dir" && argv[i + 1]) args.dir = argv[++i];
    else if (a === "--out" && argv[i + 1]) args.out = argv[++i];
    else if (a === "--fetch") args.fetch = true;
    else if (a === "--hours" && argv[i + 1]) args.hours = Number(argv[++i]) || 168;
    else if (a === "--json") args.format = "console";
  }
  return args;
}

function parseVetoDetails(raw: unknown): ParsedVeto {
  const empty: ParsedVeto = {
    veto_reasons: [],
    scorecard: {},
    reason: "",
    decision: "",
  };
  if (!raw) return empty;
  let o: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      o = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { ...empty, reason: raw.slice(0, 200) };
    }
  } else if (typeof raw === "object" && !Array.isArray(raw)) {
    o = raw as Record<string, unknown>;
  } else {
    return empty;
  }
  const reasons = Array.isArray(o.veto_reasons)
    ? o.veto_reasons.map((r) => String(r))
    : [];
  const scorecard =
    o.scorecard && typeof o.scorecard === "object"
      ? (o.scorecard as Record<string, boolean>)
      : {};
  return {
    veto_reasons: reasons,
    scorecard,
    reason: String(o.reason ?? ""),
    decision: String(o.decision ?? ""),
  };
}

/** Map raw veto strings to stable blocker codes for counting. */
function canonicalVetoCode(raw: string): string {
  const s = String(raw ?? "").trim();
  if (!s) return "UNKNOWN";
  if (s.startsWith("FAIL_STRATEGY:")) {
    const tail = s.slice("FAIL_STRATEGY:".length);
    if (tail.includes("RSI_NOT_OVERSOLD")) return "RSI_NOT_OVERSOLD";
    if (tail.includes("PRICE_BELOW_EMA200")) return "PRICE_BELOW_EMA200";
    return `FAIL_STRATEGY:${tail.split("|")[0]}`;
  }
  if (s.startsWith("HOLD:")) return s.slice(0, 80);
  if (s.startsWith("NO_TRADE_FALLBACK")) return "NO_TRADE_FALLBACK";
  const known = [
    "FAIL_EMA200",
    "FAIL_RSI_OVERBOUGHT",
    "FAIL_RSI_OVERSOLD",
    "FAIL_RSI_BAND",
    "FAIL_LOW_VOLUME_VS_24H_AVG",
    "FAIL_LOW_1M_VOLUME_USD",
    "FAIL_VOLUME",
    "FAIL_MTF_ALIGNMENT",
    "FAIL_TECH_SCORE",
    "FAIL_STRATEGY_NO_BUY",
    "FAIL_MACD_HIST_FLAT",
    "FAIL_TRENDING_VOLUME_TRACK",
    "FAIL_WIDE_SPREAD",
    "FAIL_MAX_TRADES",
  ];
  for (const k of known) {
    if (s === k || s.includes(k)) return k;
  }
  return s.length > 72 ? `${s.slice(0, 69)}...` : s;
}

function parseMetric(text: string, keys: string[]): number | null {
  for (const key of keys) {
    const m = text.match(new RegExp(`${key}[=:\\s]+(-?\\d+(?:\\.\\d+)?)`, "i"));
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function readSnapshot(row: AuditRow): Record<string, unknown> | null {
  const s = row.snapshot ?? row.market_snapshot;
  return s && typeof s === "object" ? s : null;
}

function buildCycleCtx(row: AuditRow): CycleCtx {
  const vd = parseVetoDetails(row.veto_details);
  const snap = readSnapshot(row);
  const blob = JSON.stringify(vd) + "|" + vd.reason + "|" + JSON.stringify(snap ?? {});
  const aiFromRow = Number(row.ai_confidence);
  const aiFromVd = parseMetric(blob, ["ai_confidence", "confidence"]);
  const aiConfidence = Number.isFinite(aiFromRow)
    ? aiFromRow
    : Number.isFinite(aiFromVd ?? NaN)
      ? (aiFromVd as number)
      : null;

  const vetoCodes = vd.veto_reasons.map(canonicalVetoCode);
  const strategyFail = vd.veto_reasons.find((r) => r.startsWith("FAIL_STRATEGY:")) ?? null;

  const adx14 =
    num(snap?.adx14) ??
    parseMetric(blob, ["adx14", "adx"]) ??
    null;
  const rsi =
    num(snap?.rsi) ??
    parseMetric(blob, ["rsi", "rsi_1m"]) ??
    null;
  const marketRegime =
    str(snap?.marketRegime) ??
    str((vd.scorecard as unknown as { market_regime?: string })?.market_regime) ??
    parseRegimeFromText(blob);
  const bbWidth = estimateBbWidth(snap);

  return {
    symbol: String(row.symbol ?? "UNKNOWN").toUpperCase(),
    aiConfidence,
    techScore: num(row.technical_score),
    vetoCodes,
    strategyFail,
    adx14,
    rsi,
    marketRegime,
    bbWidth,
    scorecard: vd.scorecard,
    holdReason: vd.reason,
  };
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseRegimeFromText(t: string): string | null {
  const m = t.match(/marketRegime[=:\s]+(TRENDING|RANGING|NEUTRAL)/i);
  return m ? m[1].toUpperCase() : null;
}

function estimateBbWidth(snap: Record<string, unknown> | null): number | null {
  if (!snap) return null;
  const mid = num(snap.bbMiddle);
  const upper = num(snap.bbUpper);
  const lower = num(snap.bbLower);
  if (mid != null && mid > 0 && upper != null && lower != null && upper > lower) {
    return (upper - lower) / mid;
  }
  return null;
}

function isMicroCap(symbol: string): boolean {
  return MICRO_MARKERS.some((m) => symbol.includes(m));
}

function classifySidewaysRegime(ctx: CycleCtx): "REGIME_SIDEWAYS" | "REGIME_TRENDING" | "UNKNOWN" {
  if (ctx.adx14 != null || ctx.marketRegime != null || ctx.bbWidth != null) {
    if (ctx.marketRegime === "TRENDING" || (ctx.adx14 != null && ctx.adx14 >= ADX_TREND)) {
      return "REGIME_TRENDING";
    }
    if (
      (ctx.adx14 != null && ctx.adx14 < ADX_SIDE) &&
      (ctx.marketRegime === "RANGING" || ctx.marketRegime === "NEUTRAL" || ctx.marketRegime == null) &&
      (ctx.bbWidth == null || ctx.bbWidth <= BB_SIDE_MAX)
    ) {
      return "REGIME_SIDEWAYS";
    }
    if (ctx.adx14 != null && ctx.adx14 < ADX_TREND) return "REGIME_SIDEWAYS";
    return "REGIME_TRENDING";
  }
  return "UNKNOWN";
}

function isBlockedBuySetup(ctx: CycleCtx): boolean {
  const emaBlock = ctx.vetoCodes.includes("FAIL_EMA200") || ctx.vetoCodes.includes("PRICE_BELOW_EMA200");
  const rsiBlock =
    ctx.vetoCodes.includes("RSI_NOT_OVERSOLD") ||
    ctx.vetoCodes.includes("FAIL_RSI_BAND") ||
    ctx.vetoCodes.includes("FAIL_RSI_OVERBOUGHT") ||
    ctx.vetoCodes.includes("FAIL_RSI_OVERSOLD");
  const volBlock =
    ctx.vetoCodes.includes("FAIL_LOW_VOLUME_VS_24H_AVG") ||
    ctx.vetoCodes.includes("FAIL_LOW_1M_VOLUME_USD") ||
    ctx.vetoCodes.includes("FAIL_VOLUME");
  const stratBlock = ctx.vetoCodes.includes("FAIL_STRATEGY_NO_BUY") || Boolean(ctx.strategyFail);
  const aiOk = ctx.aiConfidence != null && ctx.aiConfidence >= SIDEWAYS_AI_FLOOR;
  return (emaBlock || rsiBlock || volBlock || stratBlock) && (aiOk || ctx.scorecard.strategy_buy_ok === false);
}

function wouldConvertUnderSideways(ctx: CycleCtx): {
  convert: boolean;
  tier: "exact" | "veto_inferred" | "no";
  notes: string[];
} {
  const regime = classifySidewaysRegime(ctx);
  if (regime === "REGIME_TRENDING") {
    return { convert: false, tier: "no", notes: ["trending_regime"] };
  }

  const notes: string[] = [];
  const hardBlocks = new Set([
    "FAIL_TECH_SCORE",
    "FAIL_MTF_ALIGNMENT",
    "FAIL_WIDE_SPREAD",
    "FAIL_MAX_TRADES",
    "FAIL_MACD_HIST_FLAT",
  ]);
  if (ctx.vetoCodes.some((c) => hardBlocks.has(c))) {
    return { convert: false, tier: "no", notes: ["hard_gate"] };
  }

  const emaBlock = ctx.vetoCodes.includes("FAIL_EMA200") || ctx.vetoCodes.includes("PRICE_BELOW_EMA200");
  const rsiBlock =
    ctx.vetoCodes.includes("RSI_NOT_OVERSOLD") ||
    ctx.vetoCodes.includes("FAIL_RSI_BAND");
  const volBlock =
    ctx.vetoCodes.includes("FAIL_LOW_VOLUME_VS_24H_AVG") ||
    ctx.vetoCodes.includes("FAIL_LOW_1M_VOLUME_USD");

  let fixed = 0;
  if (emaBlock) {
    fixed += 1;
    notes.push("ema200_waived_sideways");
  }
  if (rsiBlock) {
    if (ctx.rsi != null && ctx.rsi < SIDEWAYS_RSI_MAX) {
      fixed += 1;
      notes.push(`rsi_${ctx.rsi}_lt_${SIDEWAYS_RSI_MAX}`);
    } else if (ctx.rsi == null && ctx.vetoCodes.includes("RSI_NOT_OVERSOLD")) {
      fixed += 1;
      notes.push("rsi_inferred_not_oversold_band");
    } else if (ctx.rsi == null) {
      notes.push("rsi_unknown");
    } else {
      return { convert: false, tier: "no", notes: [`rsi_${ctx.rsi}_gte_${SIDEWAYS_RSI_MAX}`] };
    }
  }
  if (volBlock) {
    if (isMicroCap(ctx.symbol)) {
      fixed += 1;
      notes.push(`vol_scaled_${VOL_SCALE}`);
    } else {
      notes.push("vol_block_non_micro");
    }
  }

  const onlyStrategyNoBuy =
    ctx.vetoCodes.includes("FAIL_STRATEGY_NO_BUY") &&
    !emaBlock &&
    !rsiBlock &&
    !volBlock;
  if (onlyStrategyNoBuy) {
    if (ctx.aiConfidence != null && ctx.aiConfidence >= SIDEWAYS_AI_FLOOR) {
      fixed += 1;
      notes.push("ai_grinder_promotion");
    } else {
      return { convert: false, tier: "no", notes: ["low_ai_for_grinder"] };
    }
  }

  if (fixed === 0) return { convert: false, tier: "no", notes: ["no_sideways_fixable_blocker"] };

  const tier = ctx.adx14 != null || ctx.rsi != null ? "exact" : "veto_inferred";
  const regimeOk = regime === "REGIME_SIDEWAYS" || regime === "UNKNOWN";
  if (!regimeOk) return { convert: false, tier: "no", notes: ["not_sideways"] };

  return { convert: true, tier, notes };
}

export function loadRowsFromPath(path: string): AuditRow[] {
  const abs = resolve(path);
  const raw = readFileSync(abs, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) return JSON.parse(raw) as AuditRow[];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AuditRow);
}

export function loadRowsFromDir(dir: string): AuditRow[] {
  const abs = resolve(dir);
  const files = readdirSync(abs).filter((f) => /\.(json|ndjson|jsonl)$/i.test(f));
  const rows: AuditRow[] = [];
  for (const f of files) {
    rows.push(...loadRowsFromPath(join(abs, f)));
  }
  return rows;
}

export async function fetchFromSupabase(hours: number): Promise<AuditRow[]> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for --fetch");
  }
  const start = new Date(Date.now() - hours * 3600_000).toISOString();
  const q = new URL(`${url}/rest/v1/war_room_audits`);
  q.searchParams.set(
    "select",
    "final_decision,veto_details,technical_score,ai_confidence,symbol,created_at",
  );
  q.searchParams.set("created_at", `gte.${start}`);
  q.searchParams.set("order", "created_at.desc");
  q.searchParams.set("limit", "10000");
  const res = await fetch(q, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase fetch failed: ${res.status}`);
  return (await res.json()) as AuditRow[];
}

function bump(map: Map<string, number>, key: string, n = 1): void {
  map.set(key, (map.get(key) ?? 0) + n);
}

function renderTable(title: string, rows: Array<[string, number]>): string[] {
  const lines = [`### ${title}`, "", "| Blocker | Count |", "| --- | ---: |"];
  for (const [k, v] of rows) lines.push(`| ${k.replace(/\|/g, "\\|")} | ${v} |`);
  lines.push("");
  return lines;
}

export function runVetoAuditReport(rows: AuditRow[]): string {
  const holdRows = rows.filter((r) => String(r.final_decision ?? "").toUpperCase() === "HOLD");
  const vetoCounts = new Map<string, number>();
  const highConfCross = new Map<string, number>();
  let simExact = 0;
  let simInferred = 0;
  let simCandidates = 0;
  let holdWithHighAi55 = 0;
  let holdWithHighAi65 = 0;

  for (const row of holdRows) {
    const ctx = buildCycleCtx(row);
    for (const code of new Set(ctx.vetoCodes)) bump(vetoCounts, code);

    if (ctx.aiConfidence != null && ctx.aiConfidence >= 55) holdWithHighAi55 += 1;
    if (ctx.aiConfidence != null && ctx.aiConfidence >= 65) holdWithHighAi65 += 1;

    if (ctx.aiConfidence != null && ctx.aiConfidence >= 55 && isBlockedBuySetup(ctx)) {
      for (const code of ctx.vetoCodes) {
        if (code.startsWith("FAIL_") || code === "RSI_NOT_OVERSOLD" || code === "PRICE_BELOW_EMA200") {
          bump(highConfCross, `ai>=55|${code}`);
        }
      }
    }
    if (ctx.aiConfidence != null && ctx.aiConfidence >= 65 && isBlockedBuySetup(ctx)) {
      for (const code of ctx.vetoCodes) {
        if (code.startsWith("FAIL_") || code === "RSI_NOT_OVERSOLD" || code === "PRICE_BELOW_EMA200") {
          bump(highConfCross, `ai>=65|${code}`);
        }
      }
    }

    if (!isBlockedBuySetup(ctx)) continue;
    simCandidates += 1;
    const sim = wouldConvertUnderSideways(ctx);
    if (sim.convert) {
      if (sim.tier === "exact") simExact += 1;
      else simInferred += 1;
    }
  }

  const sortedVetoes = [...vetoCounts.entries()].sort((a, b) => b[1] - a[1]);
  const sortedCross55 = [...highConfCross.entries()]
    .filter(([k]) => k.startsWith("ai>=55|"))
    .sort((a, b) => b[1] - a[1]);
  const sortedCross65 = [...highConfCross.entries()]
    .filter(([k]) => k.startsWith("ai>=65|"))
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => [k.replace("ai>=65|", ""), v] as [string, number]);

  const md: string[] = [
    "# Historical veto audit",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `| --- | ---: |`,
    `| Total rows loaded | ${rows.length} |`,
    `| HOLD cycles | ${holdRows.length} |`,
    `| HOLD with AI ≥ 55% | ${holdWithHighAi55} |`,
    `| HOLD with AI ≥ 65% | ${holdWithHighAi65} |`,
    `| Blocked-buy setup candidates | ${simCandidates} |`,
    `| Would convert (exact metrics) | ${simExact} |`,
    `| Would convert (veto-inferred) | ${simInferred} |`,
    `| **Total simulated BUY** | **${simExact + simInferred}** |`,
    "",
    "### Simulation parameters",
    "",
    `- ADX sideways < ${ADX_SIDE}, trend ≥ ${ADX_TREND}`,
    `- Sideways RSI entry max: ${SIDEWAYS_RSI_MAX}`,
    `- Sideways AI floor: ${SIDEWAYS_AI_FLOOR}%`,
    `- Micro-cap volume scale: ${(VOL_SCALE * 100).toFixed(0)}%`,
    "",
    ...renderTable("Veto type counts (HOLD cycles)", sortedVetoes),
    ...renderTable("High-confidence (≥55%) kills by blocker", sortedCross55.map(([k, v]) => [k.replace("ai>=55|", ""), v] as [string, number])),
    ...renderTable("High-confidence (≥65%) kills by blocker", sortedCross65),
  ];

  return md.join("\n");
}
