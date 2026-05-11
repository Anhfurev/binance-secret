// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";

export type CycleLogRow = {
  level: string;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
  created_at?: string;
  user_id?: string | null;
  symbol?: string | null;
};

const cycleLogBuffer: CycleLogRow[] = [];

export function enqueueCycleLog(row: CycleLogRow) {
  cycleLogBuffer.push({
    ...row,
    created_at: row.created_at ?? new Date().toISOString(),
  });
}

export function clearCycleLogBuffer() {
  cycleLogBuffer.length = 0;
}

export async function flushCycleLogs(
  supabase: ReturnType<typeof createClient> | null,
) {
  if (!supabase || cycleLogBuffer.length === 0) return;
  const rows = cycleLogBuffer.splice(0, cycleLogBuffer.length);
  const result = await supabase.from("logs").insert(rows);
  if (result.error) {
    console.error(`[cycle-log-buffer] flush failed: ${result.error.message}`);
  }
}
