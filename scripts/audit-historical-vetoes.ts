#!/usr/bin/env npx tsx
/**
 * Audit historical war_room_audits / log dumps for HOLD veto patterns.
 *
 * Usage:
 *   npx tsx scripts/audit-historical-vetoes.ts --input ./exports/war_room_audits.json
 *   npx tsx scripts/audit-historical-vetoes.ts --dir ./exports --out ./reports/veto-audit.md
 *   npx tsx scripts/audit-historical-vetoes.ts --fetch --hours 168
 *
 * Export from Supabase (SQL):
 *   select final_decision, veto_details, technical_score, ai_confidence, symbol, created_at
 *   from war_room_audits where created_at > now() - interval '7 days';
 */
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchFromSupabase,
  loadEnvFile,
  loadRowsFromDir,
  loadRowsFromPath,
  parseArgs,
  runVetoAuditReport,
  type AuditRow,
} from "./audit-historical-vetoes-lib.ts";

async function main(): Promise<void> {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  loadEnvFile(resolve(root, ".env.local"));
  const args = parseArgs(process.argv);

  let rows: AuditRow[] = [];
  if (args.fetch) rows = await fetchFromSupabase(args.hours);
  else if (args.input) rows = loadRowsFromPath(args.input);
  else if (args.dir) rows = loadRowsFromDir(args.dir);
  else {
    console.error("Provide --input <file.json> or --dir <folder> or --fetch");
    process.exit(1);
  }

  const report = runVetoAuditReport(rows);
  console.log(report);
  if (args.out) {
    writeFileSync(resolve(args.out), report, "utf8");
    console.error(`\nWrote ${resolve(args.out)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
