import { assertEquals } from "jsr:@std/assert";
import { readPaperRegimeSlippageBps } from "../paper-fill.ts";

Deno.test("paper slippage bps defaults by regime", () => {
  assertEquals(readPaperRegimeSlippageBps("TRENDING"), 4);
  assertEquals(readPaperRegimeSlippageBps("RANGING"), 8);
  assertEquals(readPaperRegimeSlippageBps("UNKNOWN"), 6);
});
