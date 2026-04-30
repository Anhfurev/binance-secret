// @ts-nocheck
/**
 * Basket / diversification hint for the AI payload.
 * Prefer `bot_settings.portfolio_tier` + `basket_weight_pct` when present; else symbol defaults.
 */
export function resolvePortfolioBasketHint(
  symbol: string,
  row: Record<string, unknown> | null | undefined,
): string {
  const tier =
    typeof row?.portfolio_tier === "string" && row.portfolio_tier.trim()
      ? row.portfolio_tier.trim()
      : null;
  const w = Number(row?.basket_weight_pct);
  if (tier) {
    return `DB portfolio_tier=${tier}${
      Number.isFinite(w) && w > 0 ? ` basket_weight_pct=${w}` : ""
    }`;
  }
  const base = symbol.replace(/USDT$/i, "").toUpperCase();
  const tier1 = new Set(["BTC", "ETH"]);
  const tier2 = new Set(["SOL", "AVAX"]);
  if (tier1.has(base)) {
    return "Default Tier1 (safe majors) ~60% notional cohort — do not treat like meme risk.";
  }
  if (tier2.has(base)) {
    return "Default Tier2 (growth alts) ~30% cohort — moderate size vs Tier1.";
  }
  return "Default Tier3 (spec/meme) ~10% cohort — liquidity and gap risk dominate.";
}
