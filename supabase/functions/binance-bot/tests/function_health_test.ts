import { assertEquals } from "jsr:@std/assert";
import {
  deriveVitalityStatus,
  vitalityHeadline,
} from "../function-health.ts";

Deno.test("deriveVitalityStatus maps critical and warn counts", () => {
  assertEquals(deriveVitalityStatus({ criticalIssues: 0, warnIssues: 0 }), "alive");
  assertEquals(deriveVitalityStatus({ criticalIssues: 0, warnIssues: 2 }), "degraded");
  assertEquals(deriveVitalityStatus({ criticalIssues: 1, warnIssues: 0 }), "broken");
});

Deno.test("vitalityHeadline explains alive vs degraded vs broken", () => {
  assertEquals(vitalityHeadline("alive").includes("alive"), true);
  assertEquals(vitalityHeadline("broken").includes("broken"), true);
});
