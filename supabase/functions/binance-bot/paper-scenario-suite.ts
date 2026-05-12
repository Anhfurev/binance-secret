// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { SUPPORTED_SYMBOLS } from "./constants.ts";
import {
  PAPER_SCENARIO_NAMES,
  type PaperScenarioName,
} from "./paper-scenario-snapshot.ts";
import { runSymbolBatch } from "./run-symbol-batch.ts";
import type { BotActionResult } from "./types.ts";
import { normalizeSymbol, toStringValue } from "./utils.ts";

export const PAPER_SCENARIO_SUITE_MAX_CASES = 50;

export type PaperScenarioSuiteCase = {
  index: number;
  scenario: PaperScenarioName;
  symbol: string;
};

export type PaperScenarioSuiteRequest = {
  execute: boolean;
  maxCases: number;
  symbols: string[] | null;
};

export function buildPaperSuiteCases(
  symbols: string[],
  maxCases: number,
): PaperScenarioSuiteCase[] {
  const orderedSymbols = [...new Set(symbols.map((s) => normalizeSymbol(s, s)))].filter(Boolean);
  if (!orderedSymbols.length) return [];
  const cases: PaperScenarioSuiteCase[] = [];
  let index = 0;
  while (cases.length < maxCases) {
    for (const symbol of orderedSymbols) {
      for (const scenario of PAPER_SCENARIO_NAMES) {
        if (cases.length >= maxCases) return cases;
        index += 1;
        cases.push({ index, scenario, symbol });
      }
    }
  }
  return cases;
}

export function parsePaperScenarioSuiteRequest(body: Record<string, unknown> | null): {
  ok: true;
  value: PaperScenarioSuiteRequest;
} | {
  ok: false;
  error: string;
} | {
  ok: true;
  value: null;
} {
  if (body?.paper_scenario_suite !== true) {
    return { ok: true, value: null };
  }
  const rawMax = Number(body?.paper_scenario_max_cases ?? PAPER_SCENARIO_SUITE_MAX_CASES);
  const maxCases = Number.isFinite(rawMax)
    ? Math.min(PAPER_SCENARIO_SUITE_MAX_CASES, Math.max(1, Math.floor(rawMax)))
    : PAPER_SCENARIO_SUITE_MAX_CASES;
  const execute = body?.paper_scenario_execute === true;
  const rawSymbols = body?.symbols;
  let symbols: string[] | null = null;
  if (Array.isArray(rawSymbols) && rawSymbols.length > 0) {
    symbols = rawSymbols
      .map((entry) => normalizeSymbol(toStringValue(entry) ?? "", ""))
      .filter(Boolean);
    if (!symbols.length) {
      return { ok: false, error: "symbols must include at least one valid symbol" };
    }
  }
  return { ok: true, value: { execute, maxCases, symbols } };
}

function summarizeSuiteActions(actions: BotActionResult[]) {
  const decisionCounts: Record<string, number> = {};
  const actionCounts: Record<string, number> = {};
  const issues: Array<Record<string, unknown>> = [];
  for (const row of actions) {
    const detail = String(row.detail ?? "");
    const dryRun = detail.startsWith("paper_scenario_dry_run");
    const decision = String(row.decision ?? "unknown");
    const action = dryRun ? "hold" : String(row.action ?? "unknown");
    decisionCounts[decision] = (decisionCounts[decision] ?? 0) + 1;
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    if (action === "error" || action === "skip") {
      issues.push({
        userId: row.userId,
        symbol: row.symbol,
        decision,
        action,
        detail,
        reason: (row as { reason?: string | null }).reason ?? null,
      });
    } else if (dryRun && decision === "HOLD") {
      issues.push({
        userId: row.userId,
        symbol: row.symbol,
        decision,
        action,
        detail,
        reason: (row as { reason?: string | null }).reason ?? null,
        note: "dry_run_hold",
      });
    }
  }
  return { decisionCounts, actionCounts, issues };
}

async function resolveSuiteSymbols(
  supabase: ReturnType<typeof createClient>,
  symbols: string[] | null,
): Promise<string[]> {
  if (symbols?.length) return symbols;
  const rows = await supabase
    .from("bot_settings")
    .select("symbol")
    .eq("is_autopilot_enabled", true);
  const fromDb = [...new Set(
    (rows.data ?? [])
      .map((row) => normalizeSymbol(toStringValue((row as { symbol?: unknown }).symbol) ?? "", ""))
      .filter(Boolean),
  )];
  if (fromDb.length) return fromDb;
  return [...SUPPORTED_SYMBOLS];
}

export async function runPaperScenarioSuite(params: {
  supabase: ReturnType<typeof createClient>;
  request: PaperScenarioSuiteRequest;
  lastAiPriceBySymbol: Map<string, number>;
}): Promise<Record<string, unknown>> {
  const { supabase, request, lastAiPriceBySymbol } = params;
  const symbols = await resolveSuiteSymbols(supabase, request.symbols);
  const cases = buildPaperSuiteCases(symbols, request.maxCases);
  if (!cases.length) {
    return { ok: false, error: "paper_scenario_suite_no_cases", symbols };
  }

  const liveRows = await supabase
    .from("bot_settings")
    .select("symbol")
    .eq("is_autopilot_enabled", true)
    .eq("is_live_trading_enabled", true)
    .in("symbol", [...new Set(cases.map((entry) => entry.symbol))]);
  if (Array.isArray(liveRows.data) && liveRows.data.length > 0) {
    return {
      ok: false,
      error: "paper_scenario_blocked_live_trading_enabled",
      symbols: [...new Set(liveRows.data.map((row) => row.symbol))],
    };
  }

  const marketCache = new Map();
  const caseResults: Array<Record<string, unknown>> = [];
  const allActions: BotActionResult[] = [];
  let scannedTotal = 0;

  for (const entry of cases) {
    const batch = await runSymbolBatch({
      supabase,
      symbolFilter: entry.symbol,
      lastAiPriceBySymbol,
      marketCache,
      paperScenario: {
        name: entry.scenario,
        execute: request.execute,
      },
    });
    scannedTotal += batch.scanned;
    const actions = batch.actions ?? [];
    allActions.push(...actions);
    caseResults.push({
      index: entry.index,
      scenario: entry.scenario,
      symbol: entry.symbol,
      scanned: batch.scanned,
      cycle_id: batch.cycleId,
      actions,
    });
  }

  const summary = summarizeSuiteActions(allActions);
  return {
    ok: true,
    mode: "paper_scenario_suite",
    execute: request.execute,
    max_cases: request.maxCases,
    case_count: cases.length,
    symbols,
    scanned_total: scannedTotal,
    summary,
    cases: caseResults,
  };
}
