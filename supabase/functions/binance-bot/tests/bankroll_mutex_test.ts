import { assertEquals } from "jsr:@std/assert";
import { readBankrollMutexMode } from "../bankroll-mutex.ts";

Deno.test("bankroll mutex defaults to skip mode", () => {
  Deno.env.delete("BANKROLL_MUTEX_MODE");
  assertEquals(readBankrollMutexMode(), "skip");
  Deno.env.set("BANKROLL_MUTEX_MODE", "wait");
  assertEquals(readBankrollMutexMode(), "wait");
  Deno.env.delete("BANKROLL_MUTEX_MODE");
});
