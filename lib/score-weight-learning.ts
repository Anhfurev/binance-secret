import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";

const LOOKBACK_DAYS = 35;
const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_SAMPLES = 40;
/** If the weakest feature’s |r| vs outcome is above this, skip (all channels somewhat aligned). */
const STRONG_ENOUGH_ABS = 0.12;
/** Mass moved from the weakest-correlation feature per run (then renormalized). */
const REDISTRIBUTION_STEP = 0.018;

export type ScoreWeightsRow = {
  trend: number;
  momentum: number;
  volume: number;
  order_book: number;
};

const DEFAULT_TF: ScoreWeightsRow = {
  trend: 0.4,
  momentum: 0.3,
  volume: 0.2,
  order_book: 0.1,
};

const DEFAULT_MR: ScoreWeightsRow = {
  trend: 0.15,
  momentum: 0.45,
  volume: 0.25,
  order_book: 0.15,
};

type ScoreProfile = "trend_following" | "mean_reversion";

const FEATURE_KEYS = ["trend", "momentum", "volume", "order_book"] as const;
type FeatureKey = (typeof FEATURE_KEYS)[number];

function isRelationMissingError(message: string, table: string) {
  return (
    message.includes(table) &&
    (message.includes("does not exist") ||
      message.includes("schema cache") ||
      message.includes("relation"))
  );
}

function mean(a: number[]): number {
  return a.reduce((s, x) => s + x, 0) / a.length;
}

function pearson(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < MIN_SAMPLES) return null;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    const ax = xs[i] - mx;
    const ay = ys[i] - my;
    num += ax * ay;
    dx += ax * ax;
    dy += ay * ay;
  }
  const den = Math.sqrt(dx * dy);
  if (den < 1e-12) return null;
  return num / den;
}

function parseWeightsFromDb(v: unknown): ScoreWeightsRow | null {
  if (v == null || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const read = (k: string) => {
    const n = Number(o[k]);
    return Number.isFinite(n) ? n : NaN;
  };
  const w: ScoreWeightsRow = {
    trend: read("trend"),
    momentum: read("momentum"),
    volume: read("volume"),
    order_book: read("order_book"),
  };
  const sum = w.trend + w.momentum + w.volume + w.order_book;
  if (!Number.isFinite(sum) || sum < 0.5) return null;
  for (const k of FEATURE_KEYS) {
    if (!Number.isFinite(w[k]) || w[k] < 0) return null;
  }
  return normalizeWeights(w);
}

/**
 * Water-fill normalize: clamp each weight to [lo, hi] AFTER (re)normalize, and
 * iterate. Pre-clamp + single normalize was unsafe — three features clamped to
 * `lo` with one at `hi` produced a normalized leader at `hi/(hi+3*lo) ≈ 0.85`,
 * silently breaking the per-feature cap and "blinding" the bot to one channel.
 * This routine redistributes overflow into un-saturated weights until no
 * channel violates [lo, hi] and the sum is exactly 1 (≤ 8 passes; converges
 * fast for 4 features).
 */
function normalizeWeights(w: ScoreWeightsRow): ScoreWeightsRow {
  const lo = 0.03;
  const hi = 0.52;
  let cur: ScoreWeightsRow = {
    trend: Number.isFinite(w.trend) ? Math.max(0, w.trend) : 0,
    momentum: Number.isFinite(w.momentum) ? Math.max(0, w.momentum) : 0,
    volume: Number.isFinite(w.volume) ? Math.max(0, w.volume) : 0,
    order_book: Number.isFinite(w.order_book) ? Math.max(0, w.order_book) : 0,
  };
  let sum0 = cur.trend + cur.momentum + cur.volume + cur.order_book;
  if (!Number.isFinite(sum0) || sum0 <= 0) {
    return { trend: 0.25, momentum: 0.25, volume: 0.25, order_book: 0.25 };
  }
  cur = {
    trend: cur.trend / sum0,
    momentum: cur.momentum / sum0,
    volume: cur.volume / sum0,
    order_book: cur.order_book / sum0,
  };

  for (let iter = 0; iter < 8; iter++) {
    const clamped: ScoreWeightsRow = {
      trend: Math.min(hi, Math.max(lo, cur.trend)),
      momentum: Math.min(hi, Math.max(lo, cur.momentum)),
      volume: Math.min(hi, Math.max(lo, cur.volume)),
      order_book: Math.min(hi, Math.max(lo, cur.order_book)),
    };
    const s = clamped.trend + clamped.momentum + clamped.volume + clamped.order_book;
    if (s <= 0 || !Number.isFinite(s)) {
      return { trend: 0.25, momentum: 0.25, volume: 0.25, order_book: 0.25 };
    }
    const next: ScoreWeightsRow = {
      trend: clamped.trend / s,
      momentum: clamped.momentum / s,
      volume: clamped.volume / s,
      order_book: clamped.order_book / s,
    };
    const stable =
      Math.max(
        Math.abs(next.trend - cur.trend),
        Math.abs(next.momentum - cur.momentum),
        Math.abs(next.volume - cur.volume),
        Math.abs(next.order_book - cur.order_book),
      ) < 1e-6 &&
      next.trend <= hi + 1e-9 &&
      next.momentum <= hi + 1e-9 &&
      next.volume <= hi + 1e-9 &&
      next.order_book <= hi + 1e-9 &&
      next.trend >= lo - 1e-9 &&
      next.momentum >= lo - 1e-9 &&
      next.volume >= lo - 1e-9 &&
      next.order_book >= lo - 1e-9;
    cur = next;
    if (stable) break;
  }
  return cur;
}

export function parseAiReasoningScorecard(raw: unknown): {
  profile: ScoreProfile;
  trend: number;
  momentum: number;
  volume: number;
  order_book: number;
} | null {
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  if (typeof obj !== "object" || obj === null) return null;
  const o = obj as Record<string, unknown>;
  const prof = o.score_weight_profile;
  if (prof !== "trend_following" && prof !== "mean_reversion") return null;
  const sc = o.scorecard;
  if (typeof sc !== "object" || sc === null) return null;
  const s = sc as Record<string, unknown>;
  const num = (x: unknown) => {
    const n = typeof x === "number" ? x : Number(x);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : NaN;
  };
  const trend = num(s.trend_score);
  const momentum = num(s.momentum_score);
  const volume = num(s.volume_score);
  const order_book = num(s.order_book_score);
  if ([trend, momentum, volume, order_book].some((x) => !Number.isFinite(x))) return null;
  return { profile: prof, trend, momentum, volume, order_book };
}

type SampleRow = {
  y: number;
  trend: number;
  momentum: number;
  volume: number;
  order_book: number;
};

function correlationsForSamples(rows: SampleRow[]): Record<FeatureKey, number | null> {
  const ys = rows.map((r) => r.y);
  const out: Record<FeatureKey, number | null> = {
    trend: null,
    momentum: null,
    volume: null,
    order_book: null,
  };
  for (const k of FEATURE_KEYS) {
    const xs = rows.map((r) => r[k]);
    out[k] = pearson(xs, ys);
  }
  return out;
}

/**
 * Shift a small slice of weight from the feature with weakest |r| vs win/loss
 * toward the two features with highest positive r (fallback: equal split).
 */
function adjustWeightsFromCorrelations(
  base: ScoreWeightsRow,
  corrs: Record<FeatureKey, number | null>,
): ScoreWeightsRow | null {
  const absEntries = FEATURE_KEYS.map((k) => ({
    k,
    r: corrs[k],
    abs: corrs[k] == null ? 999 : Math.abs(corrs[k]!),
  }));
  const weakest = absEntries.reduce((a, b) => (a.abs <= b.abs ? a : b));
  if (weakest.r == null || weakest.abs >= STRONG_ENOUGH_ABS) return null;

  const donor: FeatureKey = weakest.k;
  const recipients = FEATURE_KEYS.filter((k) => k !== donor).sort((a, b) => {
    const ra = corrs[a] ?? -1;
    const rb = corrs[b] ?? -1;
    return rb - ra;
  }).slice(0, 2) as FeatureKey[];

  const donate = Math.min(
    REDISTRIBUTION_STEP,
    Math.max(0, base[donor] - 0.03),
  );
  if (donate <= 1e-6) return null;

  const w: ScoreWeightsRow = { ...base };
  w[donor] -= donate;
  const r0 = Math.max(0.01, corrs[recipients[0]] ?? 0.01);
  const r1 = Math.max(0.01, corrs[recipients[1]] ?? 0.01);
  const s = r0 + r1;
  w[recipients[0]] += donate * (r0 / s);
  w[recipients[1]] += donate * (r1 / s);
  return normalizeWeights(w);
}

function defaultForProfile(p: ScoreProfile): ScoreWeightsRow {
  return p === "mean_reversion" ? { ...DEFAULT_MR } : { ...DEFAULT_TF };
}

export type FeatureWeightLearningResult = {
  ok: boolean;
  botsScanned: number;
  profilesAdjusted: number;
  actions: string[];
  message?: string;
};

function shouldRunMonthly(scoreWeightsUpdatedAt: string | null | undefined): boolean {
  if (!scoreWeightsUpdatedAt) return true;
  const t = Date.parse(scoreWeightsUpdatedAt);
  if (!Number.isFinite(t)) return true;
  return Date.now() - t >= MONTH_MS;
}

/** Per-profile clock falls back to legacy `score_weights_updated_at` until backfilled. */
function resolvedProfileClock(
  specific: string | null | undefined,
  legacy: string | null | undefined,
): string | null | undefined {
  return specific ?? legacy ?? undefined;
}

type ProfileClockScope = "tf" | "mr" | "both";

async function touchProfileClocks(botId: string, scope: ProfileClockScope) {
  if (!supabaseAdmin) return;
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { score_weights_updated_at: now };
  if (scope === "tf" || scope === "both") patch.score_weights_tf_updated_at = now;
  if (scope === "mr" || scope === "both") patch.score_weights_mr_updated_at = now;
  await supabaseAdmin.from("bot_settings").update(patch).eq("id", botId);
}

export async function runFeatureWeightLearning(): Promise<FeatureWeightLearningResult> {
  if (!isSupabaseAdminConfigured || !supabaseAdmin) {
    return {
      ok: false,
      botsScanned: 0,
      profilesAdjusted: 0,
      actions: [],
      message: "Supabase admin client is not configured",
    };
  }

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString();
  const actions: string[] = [];
  let botsScanned = 0;
  let profilesAdjusted = 0;

  const { data: bots, error: botErr } = await supabaseAdmin
    .from("bot_settings")
    .select(
      "id, score_weights_tf, score_weights_mr, score_weights_updated_at, score_weights_tf_updated_at, score_weights_mr_updated_at",
    );

  if (botErr) {
    if (isRelationMissingError(botErr.message, "bot_settings")) {
      return { ok: true, botsScanned: 0, profilesAdjusted: 0, actions: ["no_bot_settings"] };
    }
    return {
      ok: false,
      botsScanned: 0,
      profilesAdjusted: 0,
      actions: [],
      message: botErr.message,
    };
  }

  for (const bot of bots ?? []) {
    const botId = typeof bot.id === "string" ? bot.id : String(bot.id ?? "");
    if (!botId) continue;

    const b = bot as {
      score_weights_updated_at?: string | null;
      score_weights_tf_updated_at?: string | null;
      score_weights_mr_updated_at?: string | null;
    };
    const legacy = b.score_weights_updated_at ?? undefined;
    const runTf = shouldRunMonthly(
      resolvedProfileClock(b.score_weights_tf_updated_at ?? undefined, legacy),
    );
    const runMr = shouldRunMonthly(
      resolvedProfileClock(b.score_weights_mr_updated_at ?? undefined, legacy),
    );
    if (!runTf && !runMr) continue;
    botsScanned += 1;

    const { data: memRows, error: memErr } = await supabaseAdmin
      .from("ai_performance_memory")
      .select("trade_id, outcome_directionally_correct, created_at")
      .eq("bot_id", botId)
      .gte("created_at", since)
      .not("outcome_directionally_correct", "is", null);

    if (memErr) {
      if (isRelationMissingError(memErr.message, "ai_performance_memory")) {
        actions.push(`${botId}:skip_no_memory_table`);
        await touchProfileClocks(botId, "both");
        continue;
      }
      actions.push(`${botId}:memory_err:${memErr.message}`);
      continue;
    }

    const list = memRows ?? [];
    if (list.length < MIN_SAMPLES) {
      actions.push(`${botId}:skip_samples=${list.length}`);
      const scope: ProfileClockScope = runTf && runMr ? "both" : runTf ? "tf" : "mr";
      await touchProfileClocks(botId, scope);
      continue;
    }

    const tradeIds = [...new Set(list.map((r: { trade_id: string }) => r.trade_id).filter(Boolean))];
    const { data: trades, error: trErr } = await supabaseAdmin
      .from("trades")
      .select("id, ai_reasoning")
      .in("id", tradeIds);

    if (trErr) {
      actions.push(`${botId}:trades_err:${trErr.message}`);
      continue;
    }

    const reasoningById = new Map<string, unknown>();
    for (const t of trades ?? []) {
      const id = typeof (t as { id?: string }).id === "string" ? (t as { id: string }).id : null;
      if (id) reasoningById.set(id, (t as { ai_reasoning?: unknown }).ai_reasoning);
    }

    const byProfile: Record<ScoreProfile, SampleRow[]> = {
      trend_following: [],
      mean_reversion: [],
    };

    for (const m of list) {
      const row = m as {
        trade_id: string;
        outcome_directionally_correct: boolean | null;
      };
      const parsed = parseAiReasoningScorecard(reasoningById.get(row.trade_id));
      if (!parsed) continue;
      const y = row.outcome_directionally_correct === true ? 1 : 0;
      byProfile[parsed.profile].push({
        y,
        trend: parsed.trend,
        momentum: parsed.momentum,
        volume: parsed.volume,
        order_book: parsed.order_book,
      });
    }

    const patch: Record<string, unknown> = {};
    const botRow = bot as {
      score_weights_tf?: unknown;
      score_weights_mr?: unknown;
    };

    for (const profile of ["trend_following", "mean_reversion"] as const) {
      const runThis =
        profile === "trend_following" ? runTf : runMr;
      if (!runThis) continue;

      const samples = byProfile[profile];
      if (samples.length < MIN_SAMPLES) {
        actions.push(`${botId}:${profile}:samples=${samples.length}`);
        await touchProfileClocks(botId, profile === "trend_following" ? "tf" : "mr");
        continue;
      }
      const corrs = correlationsForSamples(samples);
      const baseKey = profile === "trend_following" ? "score_weights_tf" : "score_weights_mr";
      const existing =
        profile === "trend_following"
          ? parseWeightsFromDb(botRow.score_weights_tf)
          : parseWeightsFromDb(botRow.score_weights_mr);
      const base = existing ?? defaultForProfile(profile);
      const next = adjustWeightsFromCorrelations(base, corrs);
      if (!next) {
        actions.push(
          `${botId}:${profile}:no_weight_change corrs=${FEATURE_KEYS.map((k) => `${k}:${corrs[k]?.toFixed(3) ?? "na"}`).join(",")}`,
        );
        await touchProfileClocks(botId, profile === "trend_following" ? "tf" : "mr");
        continue;
      }
      patch[baseKey] = next;
      profilesAdjusted += 1;
      actions.push(
        `${botId}:${profile}:updated corrs=${FEATURE_KEYS.map((k) => `${k}:${corrs[k]?.toFixed(3) ?? "na"}`).join(",")} n=${samples.length}`,
      );
    }

    const nowIso = new Date().toISOString();
    if (!("score_weights_tf" in patch) && !("score_weights_mr" in patch)) {
      continue;
    }
    patch.score_weights_updated_at = nowIso;
    if ("score_weights_tf" in patch) patch.score_weights_tf_updated_at = nowIso;
    if ("score_weights_mr" in patch) patch.score_weights_mr_updated_at = nowIso;

    const { error: upErr } = await supabaseAdmin.from("bot_settings").update(patch).eq("id", botId);
    if (upErr) {
      actions.push(`${botId}:update_failed:${upErr.message}`);
    }
  }

  return { ok: true, botsScanned, profilesAdjusted, actions };
}
