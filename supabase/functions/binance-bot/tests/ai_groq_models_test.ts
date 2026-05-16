// @ts-nocheck
import { assertEquals } from "jsr:@std/assert@1";
import {
  DEFAULT_GROQ_EXECUTION_MODEL_ID,
  DEFAULT_GROQ_SCAN_MODEL,
  isGroqTieredTrapConfigured,
  resolveGroqExecutionMinConfidence,
  resolveGroqScanModel,
  resolveGroqTrapModel,
} from "../ai-groq-models.ts";

function clearGroqModelEnv() {
  Deno.env.delete("GROQ_MODEL");
  Deno.env.delete("GROQ_SCAN_MODEL");
  Deno.env.delete("GROQ_EXECUTION_MODEL");
  Deno.env.delete("GROQ_EXECUTION_MIN_CONFIDENCE");
}

Deno.test("resolveGroqScanModel: keys-only defaults to llama-3.1-8b-instant", () => {
  const prev = {
    m: Deno.env.get("GROQ_MODEL"),
    s: Deno.env.get("GROQ_SCAN_MODEL"),
  };
  try {
    clearGroqModelEnv();
    assertEquals(resolveGroqScanModel(), DEFAULT_GROQ_SCAN_MODEL);
  } finally {
    if (prev.m === undefined) Deno.env.delete("GROQ_MODEL");
    else Deno.env.set("GROQ_MODEL", prev.m);
    if (prev.s === undefined) Deno.env.delete("GROQ_SCAN_MODEL");
    else Deno.env.set("GROQ_SCAN_MODEL", prev.s);
  }
});

Deno.test("resolveGroqTrapModel: default veto uses 70B (not scan model)", () => {
  const prev = {
    m: Deno.env.get("GROQ_MODEL"),
    e: Deno.env.get("GROQ_EXECUTION_MODEL"),
    min: Deno.env.get("GROQ_EXECUTION_MIN_CONFIDENCE"),
  };
  try {
    clearGroqModelEnv();
    assertEquals(isGroqTieredTrapConfigured(), true);
    assertEquals(resolveGroqTrapModel(75), DEFAULT_GROQ_EXECUTION_MODEL_ID);
    assertEquals(resolveGroqTrapModel(90), DEFAULT_GROQ_EXECUTION_MODEL_ID);
  } finally {
    if (prev.m === undefined) Deno.env.delete("GROQ_MODEL");
    else Deno.env.set("GROQ_MODEL", prev.m);
    if (prev.e === undefined) Deno.env.delete("GROQ_EXECUTION_MODEL");
    else Deno.env.set("GROQ_EXECUTION_MODEL", prev.e);
    if (prev.min === undefined) Deno.env.delete("GROQ_EXECUTION_MIN_CONFIDENCE");
    else Deno.env.set("GROQ_EXECUTION_MIN_CONFIDENCE", prev.min);
  }
});

Deno.test("resolveGroqTrapModel: GROQ_MODEL pins legacy single model for trap", () => {
  const prev = Deno.env.get("GROQ_MODEL");
  try {
    Deno.env.delete("GROQ_EXECUTION_MODEL");
    Deno.env.set("GROQ_MODEL", "mixtral-8x7b-32768");
    assertEquals(isGroqTieredTrapConfigured(), false);
    assertEquals(resolveGroqTrapModel(99), "mixtral-8x7b-32768");
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_MODEL");
    else Deno.env.set("GROQ_MODEL", prev);
  }
});

Deno.test("resolveGroqExecutionMinConfidence parses env", () => {
  const prev = Deno.env.get("GROQ_EXECUTION_MIN_CONFIDENCE");
  try {
    Deno.env.set("GROQ_EXECUTION_MIN_CONFIDENCE", "88");
    assertEquals(resolveGroqExecutionMinConfidence(), 88);
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_EXECUTION_MIN_CONFIDENCE");
    else Deno.env.set("GROQ_EXECUTION_MIN_CONFIDENCE", prev);
  }
});
