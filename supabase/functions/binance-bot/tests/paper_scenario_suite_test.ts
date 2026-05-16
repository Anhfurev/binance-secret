import {
  buildPaperSuiteCases,
  PAPER_SCENARIO_SUITE_MAX_CASES,
} from "../paper-scenario-suite.ts";
import { PAPER_SCENARIO_NAMES } from "../paper-scenario-snapshot.ts";

Deno.test("suite builds scenario x symbol matrix capped at max cases", () => {
  const symbols = ["BTCUSDT", "SOLUSDT", "PEPEUSDT"];
  const cases = buildPaperSuiteCases(symbols, 12);
  const expected = symbols.length * PAPER_SCENARIO_NAMES.length;
  if (cases.length !== expected) {
    throw new Error(`expected ${expected} cases, got ${cases.length}`);
  }
  if (cases[0]?.scenario !== PAPER_SCENARIO_NAMES[0]) {
    throw new Error("unexpected first scenario");
  }
});

Deno.test("suite repeats scenario matrix until max cases reached", () => {
  const symbols = ["BTCUSDT", "SOLUSDT"];
  const cases = buildPaperSuiteCases(symbols, 10);
  if (cases.length !== 10) {
    throw new Error(`expected 10 cases, got ${cases.length}`);
  }
});

Deno.test("suite max cases truncates large matrices", () => {
  const symbols = Array.from({ length: 20 }, (_, i) => `SYM${i}USDT`);
  const cases = buildPaperSuiteCases(symbols, 7);
  if (cases.length !== 7) {
    throw new Error(`expected 7 cases, got ${cases.length}`);
  }
});
