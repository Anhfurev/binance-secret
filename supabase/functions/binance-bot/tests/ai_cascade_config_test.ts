// @ts-nocheck
import { assertEquals } from "jsr:@std/assert";
import {
  readAiCascadePipelineEnabled,
  readTier1OversoldRsiMax,
} from "../ai-cascade-config.ts";

Deno.test("cascade pipeline enabled by default", () => {
  const prev = Deno.env.get("AI_CASCADE_PIPELINE");
  Deno.env.delete("AI_CASCADE_PIPELINE");
  try {
    assertEquals(readAiCascadePipelineEnabled(), true);
  } finally {
    if (prev === undefined) Deno.env.delete("AI_CASCADE_PIPELINE");
    else Deno.env.set("AI_CASCADE_PIPELINE", prev);
  }
});

Deno.test("tier1 RSI max defaults to 35", () => {
  const prev = Deno.env.get("TIER1_OVERSOLD_RSI_MAX");
  Deno.env.delete("TIER1_OVERSOLD_RSI_MAX");
  try {
    assertEquals(readTier1OversoldRsiMax(), 35);
  } finally {
    if (prev === undefined) Deno.env.delete("TIER1_OVERSOLD_RSI_MAX");
    else Deno.env.set("TIER1_OVERSOLD_RSI_MAX", prev);
  }
});
