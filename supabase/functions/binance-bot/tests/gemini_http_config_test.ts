import { assertEquals } from "jsr:@std/assert";
import {
  buildGeminiGenerationConfig,
  readGeminiTemperature,
} from "../gemini-http.ts";

Deno.test("buildGeminiGenerationConfig enforces JSON mime and low temperature", () => {
  const prev = Deno.env.get("GEMINI_TEMPERATURE");
  try {
    Deno.env.delete("GEMINI_TEMPERATURE");
    const cfg = buildGeminiGenerationConfig();
    assertEquals(cfg.responseMimeType, "application/json");
    assertEquals(cfg.temperature, 0.1);
    assertEquals(cfg.candidateCount, 1);
  } finally {
    if (prev === undefined) Deno.env.delete("GEMINI_TEMPERATURE");
    else Deno.env.set("GEMINI_TEMPERATURE", prev);
  }
});

Deno.test("readGeminiTemperature clamps to 0-0.4", () => {
  const prev = Deno.env.get("GEMINI_TEMPERATURE");
  try {
    Deno.env.set("GEMINI_TEMPERATURE", "0.2");
    assertEquals(readGeminiTemperature(), 0.2);
    Deno.env.set("GEMINI_TEMPERATURE", "9");
    assertEquals(readGeminiTemperature(), 0.4);
  } finally {
    if (prev === undefined) Deno.env.delete("GEMINI_TEMPERATURE");
    else Deno.env.set("GEMINI_TEMPERATURE", prev);
  }
});
