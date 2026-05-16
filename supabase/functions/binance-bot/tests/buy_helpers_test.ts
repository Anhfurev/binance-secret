import { assertEquals } from "jsr:@std/assert";
import { takeProfitDistanceUp } from "../buy-helpers.ts";

Deno.test("takeProfitDistanceUp honors reward-risk floor", () => {
  const distance = takeProfitDistanceUp(100, 0, 0.01, 2);
  assertEquals(distance, 4);
});
