import {
  clearCycleLogBuffer,
  enqueueCycleLog,
  flushCycleLogs,
} from "../cycle-log-buffer.ts";
import { assertEquals } from "jsr:@std/assert@1";

Deno.test("flushCycleLogs clears buffered rows after insert", async () => {
  clearCycleLogBuffer();
  enqueueCycleLog({
    level: "info",
    source: "runtime",
    message: "cron_batch_start",
    meta: { event: "cron_batch_start" },
  });
  const inserted: unknown[] = [];
  const supabase = {
    from() {
      return {
        async insert(rows: unknown[]) {
          inserted.push(...rows);
          return { error: null };
        },
      };
    },
  };
  await flushCycleLogs(supabase as never);
  assertEquals(inserted.length, 1);
  await flushCycleLogs(supabase as never);
  assertEquals(inserted.length, 1);
});
