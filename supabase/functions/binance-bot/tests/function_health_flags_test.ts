import { assertEquals } from "jsr:@std/assert";
import {
  readFunctionHealthFlags,
  wantsFunctionHealth,
} from "../function-health.ts";

Deno.test("wantsFunctionHealth honors query and body flags", () => {
  const params = new URLSearchParams("function_health=1");
  assertEquals(wantsFunctionHealth(null, params), true);
  assertEquals(wantsFunctionHealth({ alive: true }, new URLSearchParams()), true);
  assertEquals(wantsFunctionHealth({}, new URLSearchParams()), false);
});

Deno.test("readFunctionHealthFlags defaults debugger fixes off unless enabled", () => {
  const defaults = readFunctionHealthFlags({});
  assertEquals(defaults.applyFixes, false);
  assertEquals(defaults.runDebugger, true);
  const readiness = readFunctionHealthFlags({ debugger_apply_fixes: false });
  assertEquals(readiness.applyFixes, false);
  const withFixes = readFunctionHealthFlags({ debugger_apply_fixes: true });
  assertEquals(withFixes.applyFixes, true);
});
