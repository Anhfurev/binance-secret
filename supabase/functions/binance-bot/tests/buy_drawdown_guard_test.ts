import { assertEquals } from "jsr:@std/assert";
import { isDrawdownBreached } from "../buy-drawdown-guard.ts";

Deno.test("drawdown breach triggers only above the configured limit", () => {
  assertEquals(isDrawdownBreached(10, 10), false);
  assertEquals(isDrawdownBreached(10.01, 10), true);
});
