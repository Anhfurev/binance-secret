import { assertEquals } from "jsr:@std/assert";
import {
  readBotCycleTimeoutMs,
  readBotParallelSymbolCyclesEnabled,
  readBotSymbolStaggerMs,
  readGeminiCronSymbolGapMs,
  readSerialSymbolCyclesForGeminiQuota,
} from "../batch-validator.ts";
import {
  readPostBatchBalanceSyncEnabled,
  summarizeBatchActions,
} from "../run-symbol-batch.ts";

Deno.test("readBotParallelSymbolCyclesEnabled defaults off and respects on", () => {
  Deno.env.delete("BOT_PARALLEL_SYMBOL_CYCLES");
  assertEquals(readBotParallelSymbolCyclesEnabled(), false);
  Deno.env.set("BOT_PARALLEL_SYMBOL_CYCLES", "1");
  assertEquals(readBotParallelSymbolCyclesEnabled(), true);
  Deno.env.delete("BOT_PARALLEL_SYMBOL_CYCLES");
});

Deno.test("readBotSymbolStaggerMs defaults and clamps", () => {
  Deno.env.delete("BOT_SYMBOL_STAGGER_MS");
  assertEquals(readBotSymbolStaggerMs(), 3000);
  Deno.env.set("BOT_SYMBOL_STAGGER_MS", "0");
  assertEquals(readBotSymbolStaggerMs(), 0);
  Deno.env.set("BOT_SYMBOL_STAGGER_MS", "20000");
  assertEquals(readBotSymbolStaggerMs(), 15000);
  Deno.env.delete("BOT_SYMBOL_STAGGER_MS");
});

Deno.test("readBotCycleTimeoutMs clamps env override", () => {
  Deno.env.set("BOT_CYCLE_TIMEOUT_MS", "9000");
  assertEquals(readBotCycleTimeoutMs(), 10_000);
  Deno.env.set("BOT_CYCLE_TIMEOUT_MS", "45000");
  assertEquals(readBotCycleTimeoutMs(), 45_000);
  Deno.env.delete("BOT_CYCLE_TIMEOUT_MS");
  assertEquals(readBotCycleTimeoutMs(), 55_000);
});

Deno.test("summarizeBatchActions counts timeout skips and errors", () => {
  const summary = summarizeBatchActions([
    { userId: "u1", symbol: "BTCUSDT", decision: "HOLD", action: "skip", detail: "TIMEOUT_HOLD:55000ms" },
    { userId: "u2", symbol: "ETHUSDT", decision: "HOLD", action: "error", detail: "boom" },
    { userId: "u3", symbol: "SOLUSDT", decision: "BUY", action: "buy", detail: "ok" },
  ]);
  assertEquals(summary.batchTimeouts, 1);
  assertEquals(summary.batchErrors, 1);
});

Deno.test("readPostBatchBalanceSyncEnabled defaults on", () => {
  Deno.env.delete("POST_BATCH_BALANCE_SYNC");
  assertEquals(readPostBatchBalanceSyncEnabled(), true);
  Deno.env.set("POST_BATCH_BALANCE_SYNC", "0");
  assertEquals(readPostBatchBalanceSyncEnabled(), false);
  Deno.env.delete("POST_BATCH_BALANCE_SYNC");
});

Deno.test("readSerialSymbolCyclesForGeminiQuota follows matrix and AI_SKIP_GEMINI", () => {
  const prevSkip = Deno.env.get("AI_SKIP_GEMINI");
  const prevDis = Deno.env.get("GEMINI_DISABLED");
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  try {
    Deno.env.delete("AI_SKIP_GEMINI");
    Deno.env.delete("GEMINI_DISABLED");
    Deno.env.delete("AI_PROVIDER_MATRIX");
    assertEquals(readSerialSymbolCyclesForGeminiQuota(), true);
    Deno.env.set("AI_PROVIDER_MATRIX", "0");
    Deno.env.set("AI_SKIP_GEMINI", "1");
    assertEquals(readSerialSymbolCyclesForGeminiQuota(), false);
    Deno.env.delete("AI_SKIP_GEMINI");
    Deno.env.set("GEMINI_DISABLED", "true");
    assertEquals(readSerialSymbolCyclesForGeminiQuota(), false);
  } finally {
    if (prevSkip === undefined) Deno.env.delete("AI_SKIP_GEMINI");
    else Deno.env.set("AI_SKIP_GEMINI", prevSkip);
    if (prevDis === undefined) Deno.env.delete("GEMINI_DISABLED");
    else Deno.env.set("GEMINI_DISABLED", prevDis);
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
  }
});

Deno.test("readGeminiCronSymbolGapMs 400 default with matrix, 0 when Gemini skipped", () => {
  const prevSkip = Deno.env.get("AI_SKIP_GEMINI");
  const prevGap = Deno.env.get("GEMINI_CRON_SYMBOL_GAP_MS");
  const prevMatrix = Deno.env.get("AI_PROVIDER_MATRIX");
  const prevPreempt = Deno.env.get("LLM_PREEMPTIVE_KEY_ROUTING");
  try {
    Deno.env.delete("AI_SKIP_GEMINI");
    Deno.env.delete("GEMINI_CRON_SYMBOL_GAP_MS");
    Deno.env.delete("SYMBOL_MATRIX_GAP_MS");
    Deno.env.set("AI_PROVIDER_MATRIX", "1");
    Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", "1");
    assertEquals(readGeminiCronSymbolGapMs(), 400);
    Deno.env.set("GEMINI_CRON_SYMBOL_GAP_MS", "300");
    assertEquals(readGeminiCronSymbolGapMs(), 300);
    Deno.env.set("GEMINI_CRON_SYMBOL_GAP_MS", "5000");
    assertEquals(readGeminiCronSymbolGapMs(), 5000);
    Deno.env.set("AI_PROVIDER_MATRIX", "0");
    Deno.env.set("AI_SKIP_GEMINI", "1");
    assertEquals(readGeminiCronSymbolGapMs(), 0);
  } finally {
    if (prevSkip === undefined) Deno.env.delete("AI_SKIP_GEMINI");
    else Deno.env.set("AI_SKIP_GEMINI", prevSkip);
    if (prevGap === undefined) Deno.env.delete("GEMINI_CRON_SYMBOL_GAP_MS");
    else Deno.env.set("GEMINI_CRON_SYMBOL_GAP_MS", prevGap);
    if (prevMatrix === undefined) Deno.env.delete("AI_PROVIDER_MATRIX");
    else Deno.env.set("AI_PROVIDER_MATRIX", prevMatrix);
    if (prevPreempt === undefined) Deno.env.delete("LLM_PREEMPTIVE_KEY_ROUTING");
    else Deno.env.set("LLM_PREEMPTIVE_KEY_ROUTING", prevPreempt);
  }
});
