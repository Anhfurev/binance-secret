import { assertEquals } from "jsr:@std/assert@1";
import { widenStopLossToDbFloor } from "../trade-stop-risk.ts";

Deno.test("widenStopLossToDbFloor widens tight long stops", () => {
  const entry = 100;
  const tight = 99.9;
  const widened = widenStopLossToDbFloor(entry, tight, 0.025);
  assertEquals(widened, 97.5);
});
