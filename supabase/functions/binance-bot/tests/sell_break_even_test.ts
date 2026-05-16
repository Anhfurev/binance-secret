import { assertEquals } from "jsr:@std/assert";
import {
  readClassicBreakEvenEnabled,
  shouldArmClassicBreakEven,
} from "../sell-break-even.ts";

Deno.test("classic break-even stays off unless explicitly enabled", () => {
  Deno.env.delete("CLASSIC_BREAK_EVEN_ENABLED");
  assertEquals(readClassicBreakEvenEnabled(), false);
  assertEquals(
    shouldArmClassicBreakEven({
      entryPrice: 100,
      amount: 1,
      extra: {},
    } as any),
    false,
  );
});

Deno.test("classic break-even skips partial-tp managed legs", () => {
  Deno.env.set("CLASSIC_BREAK_EVEN_ENABLED", "1");
  assertEquals(
    shouldArmClassicBreakEven({
      entryPrice: 100,
      amount: 1,
      extra: { partial_tp_executed: true },
    } as any),
    false,
  );
  assertEquals(
    shouldArmClassicBreakEven({
      entryPrice: 100,
      amount: 1,
      extra: { break_even_after_partial_tp: true },
    } as any),
    false,
  );
  assertEquals(
    shouldArmClassicBreakEven({
      entryPrice: 100,
      amount: 1,
      extra: {},
    } as any),
    true,
  );
  Deno.env.delete("CLASSIC_BREAK_EVEN_ENABLED");
});
