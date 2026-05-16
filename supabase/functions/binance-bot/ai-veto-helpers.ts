// @ts-nocheck
import type { AiAnalysis, Candle, IndicatorSnapshot } from "./types.ts";
import { isGroqTieredTrapConfigured } from "./ai-groq-models.ts";
import { GLOBAL_BOT_CONFIG } from "./config.ts";
import { toNumber } from "./utils.ts";

export function shouldFastTrackGroqBuyVeto(ai: AiAnalysis): boolean {
  if (isGroqTieredTrapConfigured()) return false;
  if (String(ai.action ?? "").toUpperCase() !== "BUY") return false;
  const conf = Number(ai.ai_confidence);
  if (!Number.isFinite(conf)) return false;
  return conf >= GLOBAL_BOT_CONFIG.GROQ_VETO_FAST_TRACK_MIN_CONFIDENCE;
}

function tailBars(candles: Candle[] | undefined, n: number): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  const k = Math.min(n, candles.length);
  return candles.slice(-k);
}

function candleSummary(c: Candle) {
  return {
    t: c.openTime,
    o: Number(c.open.toFixed(8)),
    h: Number(c.high.toFixed(8)),
    l: Number(c.low.toFixed(8)),
    c: Number(c.close.toFixed(8)),
    v: Number(c.volume.toFixed(4)),
  };
}

/** Last 3–5 OHLCV bars + momentum stats for Groq veto (reduces “stale BUY” approvals). */
export function buildVetoTechnicalWindow(snapshot: IndicatorSnapshot) {
  const last5_1m = tailBars(snapshot.candles5, 5).map(candleSummary);
  const last5_15m = tailBars(snapshot.candles15m, 5).map(candleSummary);
  const c1 = tailBars(snapshot.candles5, 5);
  let five1mReturnPct: number | null = null;
  let oneBar1mReturnPct: number | null = null;
  let threeConsecutiveRed1m = false;
  if (c1.length >= 2) {
    const o0 = toNumber(c1[0]?.close, 0);
    const cLast = toNumber(c1[c1.length - 1]?.close, 0);
    if (o0 > 0 && cLast > 0) {
      five1mReturnPct = Number((((cLast - o0) / o0) * 100).toFixed(4));
    }
    const prev = c1[c1.length - 2];
    const last = c1[c1.length - 1];
    const pc = toNumber(prev?.close, 0);
    const lc = toNumber(last?.close, 0);
    if (pc > 0 && lc > 0) {
      oneBar1mReturnPct = Number((((lc - pc) / pc) * 100).toFixed(4));
    }
  }
  if (c1.length >= 3) {
    const tail3 = c1.slice(-3);
    threeConsecutiveRed1m = tail3.every(
      (x) => toNumber(x?.close, 0) < toNumber(x?.open, 0),
    );
  }
  const lastClose1m = c1.length ? toNumber(c1[c1.length - 1]?.close, 0) : 0;
  const px = snapshot.latestPrice;
  let gapSinceLast1mClosePct: number | null = null;
  if (lastClose1m > 0 && px > 0) {
    gapSinceLast1mClosePct = Number((((px - lastClose1m) / lastClose1m) * 100).toFixed(4));
  }
  return {
    last5_1m,
    last5_15m,
    computed: {
      five_1m_return_pct: five1mReturnPct,
      last_1m_close_to_close_pct: oneBar1mReturnPct,
      three_consecutive_red_1m: threeConsecutiveRed1m,
      latest_price_vs_last_1m_close_pct: gapSinceLast1mClosePct,
    },
  };
}

export function evaluateStaleSignalVeto(snapshot: IndicatorSnapshot): {
  reject: boolean;
  reason: string;
} | null {
  if (!GLOBAL_BOT_CONFIG.VETO_STALE_SIGNAL) return null;
  const win = buildVetoTechnicalWindow(snapshot);
  const fiveTh = GLOBAL_BOT_CONFIG.VETO_FAST_1M_5BAR_RETURN_PCT;
  const gapTh = GLOBAL_BOT_CONFIG.VETO_FAST_GAP_FROM_LAST_1M_CLOSE_PCT;
  if (
    win.computed.five_1m_return_pct != null &&
    win.computed.five_1m_return_pct < fiveTh
  ) {
    return {
      reject: true,
      reason: `fast_veto:5x1m_return_${win.computed.five_1m_return_pct}%<${fiveTh}`,
    };
  }
  if (win.computed.three_consecutive_red_1m) {
    return { reject: true, reason: "fast_veto:three_red_1m_candles" };
  }
  if (
    win.computed.latest_price_vs_last_1m_close_pct != null &&
    win.computed.latest_price_vs_last_1m_close_pct < gapTh
  ) {
    return {
      reject: true,
      reason:
        `fast_veto:ticker_vs_last1m_close_${win.computed.latest_price_vs_last_1m_close_pct}%<${gapTh}`,
    };
  }
  return null;
}

export function hasFinalGroqBuyVeto(ai: AiAnalysis): boolean {
  const verdict = String(ai.groq_verdict ?? "").toUpperCase();
  return verdict === "APPROVE" || verdict === "REJECT" || verdict === "SKIPPED";
}

export function applyStaleSignalBuyVeto(
  snapshot: IndicatorSnapshot,
  ai: AiAnalysis,
): AiAnalysis {
  if (String(ai.action ?? "").toUpperCase() !== "BUY") return ai;
  const stale = evaluateStaleSignalVeto(snapshot);
  if (!stale?.reject) return ai;
  return {
    ...ai,
    action: "HOLD",
    trend_alignment: false,
    groq_verdict: "REJECT",
    groq_reason: stale.reason,
    raw_groq_veto_response: { action: "REJECT", reason: stale.reason, fast_path: true },
  };
}
