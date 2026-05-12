import { assertEquals } from "jsr:@std/assert";
import { canFireDbStopLoss, readMinHoldBeforeDbStopMs } from "../strategy-stop-hold.ts";

Deno.test("db stop hold defaults to four minutes", () => {
  Deno.env.delete("MIN_HOLD_BEFORE_DB_STOP_MS");
  assertEquals(readMinHoldBeforeDbStopMs(), 240_000);
});

Deno.test("db stop waits until min hold elapsed", () => {
  const now = Date.UTC(2026, 4, 12, 12, 0, 0);
  const openedAt = new Date(now - 60_000).toISOString();
  assertEquals(canFireDbStopLoss({ opened_at: openedAt } as any, now), false);
  assertEquals(canFireDbStopLoss({ opened_at: openedAt } as any, now + 240_000), true);
});

Deno.test("db stop blocked when opened_at missing", () => {
  assertEquals(canFireDbStopLoss({} as any), false);
});
