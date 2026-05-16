import { assertEquals } from "jsr:@std/assert";
import { resolvePaperLossLesson } from "../paper-loss-lesson.ts";

Deno.test("paper loss lesson bumps confidence after recent losses", async () => {
  const result = await resolvePaperLossLesson({
    supabase: {
      from() {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          in() {
            return this;
          },
          gte() {
            return Promise.resolve({ count: 2, error: null });
          },
        };
      },
    } as any,
    userId: "u1",
    symbol: "BTCUSDT",
    regime: "TRENDING",
    rsi: 48,
    latestPrice: 100,
    bbLower: 98,
  });
  assertEquals(result.confidenceBump, 6);
  assertEquals(result.blockBuy, false);
});
