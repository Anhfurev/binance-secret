import { assertEquals } from "jsr:@std/assert";
import { evaluateMoneyMachineExits } from "../money-machine-guard.ts";

Deno.test("money machine hard stop fires on deep drawdown", () => {
  const now = Date.UTC(2026, 4, 12, 12, 0, 0);
  const hint = evaluateMoneyMachineExits({
    openTrade: {
      entryPrice: 100,
      opened_at: new Date(now - 200_000).toISOString(),
      extra: {},
    } as any,
    price: 99.4,
    nowMs: now,
  });
  assertEquals(hint.forceExit, true);
  assertEquals(hint.reason, "money_machine_hard_stop");
});

Deno.test("money machine hard stop waits for min hold", () => {
  const now = Date.UTC(2026, 4, 12, 12, 0, 0);
  const hint = evaluateMoneyMachineExits({
    openTrade: {
      entryPrice: 100,
      opened_at: new Date(now - 60_000).toISOString(),
      extra: {},
    } as any,
    price: 99.4,
    nowMs: now,
  });
  assertEquals(hint.forceExit, false);
});

Deno.test("money machine trail uses live price for high-water", () => {
  const hint = evaluateMoneyMachineExits({
    openTrade: {
      entryPrice: 100,
      extra: { highest_price_seen: 100.2 },
    } as any,
    price: 100.3,
  });
  assertEquals(hint.forceExit, false);
  assertEquals(hint.reason, null);
});
