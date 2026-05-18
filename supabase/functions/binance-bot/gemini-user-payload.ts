// @ts-nocheck
/** Compact user JSON for Gemini (smaller upload vs verbose buildPayload keys). */

export function stringifyGeminiUserData(data: unknown): string {
  const compact = buildMinifiedGeminiPayload(data);
  return `D:${JSON.stringify(compact)}`;
}

export function buildMinifiedGeminiPayload(data: unknown): Record<string, unknown> {
  const d = (data && typeof data === "object") ? (data as Record<string, unknown>) : {};
  const thtf = (d.trend_htf && typeof d.trend_htf === "object")
    ? (d.trend_htf as Record<string, unknown>)
    : {};
  const mctx = (d.market_context && typeof d.market_context === "object")
    ? (d.market_context as Record<string, unknown>)
    : {};
  const out: Record<string, unknown> = {
    s: d.symbol,
    px: d.latestPrice,
    c1: d.candles1m,
    c15: d.candles15m,
    c1h: d.candles1h,
    c4: d.candles4h,
    reg: d.marketRegime,
    adx: d.adx14,
    atr: d.atr14,
    rsi: d.rsi,
    r15: d.rsi15m,
    mac: d.macd,
    e200: d.ema200,
    e50: d.ema50,
    imb: mctx.imbalance_ratio,
    thtf: {
      h1: thtf.trend_1h,
      h4: thtf.trend_4h,
      ok: thtf.mtf_effective_ok,
    },
  };
  if (d.sandbox_mode) out.sbx = 1;
  if (d.portfolio_basket_hint) out.bsk = d.portfolio_basket_hint;
  if (d.symbol_strategy_hint) out.hint = d.symbol_strategy_hint;
  if (d.ai_scoring_rubric) out.rub = d.ai_scoring_rubric;
  return out;
}
