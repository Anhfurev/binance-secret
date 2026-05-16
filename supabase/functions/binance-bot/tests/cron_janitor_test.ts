import { assertEquals } from "jsr:@std/assert";
import { readReservationStaleMs } from "../cron-janitor.ts";

Deno.test("readReservationStaleMs defaults to five minutes", () => {
  Deno.env.delete("CAPITAL_RESERVATION_STALE_MS");
  assertEquals(readReservationStaleMs(), 300_000);
});

Deno.test("readReservationStaleMs clamps env override", () => {
  Deno.env.set("CAPITAL_RESERVATION_STALE_MS", "120000");
  assertEquals(readReservationStaleMs(), 120_000);
  Deno.env.delete("CAPITAL_RESERVATION_STALE_MS");
});
