import { assertEquals } from "jsr:@std/assert";
import { resolvePortfolioBasketHint } from "../portfolio-basket.ts";

Deno.test("portfolio basket honors DB tier overrides", () => {
  const hint = resolvePortfolioBasketHint("PEPEUSDT", {
    portfolio_tier: "Tier3",
    basket_weight_pct: 8,
  });
  assertEquals(hint, "DB portfolio_tier=Tier3 basket_weight_pct=8");
});

Deno.test("portfolio basket defaults PEPE to meme tier", () => {
  const hint = resolvePortfolioBasketHint("PEPEUSDT", null);
  assertEquals(
    hint,
    "Default Tier3 (spec/meme) ~10% cohort — liquidity and gap risk dominate.",
  );
});
