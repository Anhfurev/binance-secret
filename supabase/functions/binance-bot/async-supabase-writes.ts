// @ts-nocheck
/** Non-blocking Supabase writes — never await these on the cron / scan hot path. */

import type { createClient } from "npm:@supabase/supabase-js@2";
import { fireAndForgetSideEffect } from "./edge-runtime.ts";

export type SupabaseClient = ReturnType<typeof createClient>;

function normalizeRows(
  rows: Record<string, unknown> | Record<string, unknown>[],
): Record<string, unknown>[] {
  return Array.isArray(rows) ? rows : [rows];
}

export function fireAndForgetLogsInsert(
  supabase: SupabaseClient | null,
  rows: Record<string, unknown> | Record<string, unknown>[],
  context = "logs",
): void {
  if (!supabase) return;
  const payload = normalizeRows(rows);
  if (!payload.length) return;
  fireAndForgetSideEffect(`logs_insert_${context}`, async () => {
    const result = await supabase.from("logs").insert(payload);
    if (result.error) {
      console.error(
        `[async-db] logs insert failed (${context}): ${result.error.message}`,
      );
    }
  });
}

export function fireAndForgetTableInsert(
  supabase: SupabaseClient | null,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  context: string,
): void {
  if (!supabase) return;
  const payload = normalizeRows(rows);
  if (!payload.length) return;
  fireAndForgetSideEffect(`insert_${table}_${context}`, async () => {
    const result = await supabase.from(table).insert(payload);
    if (result.error) {
      console.error(
        `[async-db] ${table} insert failed (${context}): ${result.error.message}`,
      );
    }
  });
}

export function fireAndForgetTableUpsert(
  supabase: SupabaseClient | null,
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  options: { onConflict: string },
  context: string,
): void {
  if (!supabase) return;
  const payload = normalizeRows(rows);
  if (!payload.length) return;
  fireAndForgetSideEffect(`upsert_${table}_${context}`, async () => {
    const result = await supabase.from(table).upsert(payload, options);
    if (result.error) {
      console.error(
        `[async-db] ${table} upsert failed (${context}): ${result.error.message}`,
      );
    }
  });
}
