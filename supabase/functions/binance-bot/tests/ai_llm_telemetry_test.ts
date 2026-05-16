import { assertEquals } from "jsr:@std/assert";
import {
  tryParseGeminiUsage,
  tryParseGroqUsage,
} from "../ai-llm-telemetry.ts";

Deno.test("tryParseGroqUsage reads OpenAI-style usage block", () => {
  const u = tryParseGroqUsage({
    choices: [{ message: { content: "{}" } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
  assertEquals(u, { prompt: 100, completion: 50, total: 150 });
});

Deno.test("tryParseGroqUsage infers total when missing", () => {
  const u = tryParseGroqUsage({
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  assertEquals(u?.total, 15);
});

Deno.test("tryParseGeminiUsage reads usageMetadata", () => {
  const u = tryParseGeminiUsage({
    usageMetadata: {
      promptTokenCount: 200,
      candidatesTokenCount: 80,
      totalTokenCount: 280,
    },
  });
  assertEquals(u, { prompt: 200, completion: 80, total: 280 });
});

Deno.test("tryParseGroqUsage returns null on garbage", () => {
  assertEquals(tryParseGroqUsage(null), null);
  assertEquals(tryParseGroqUsage({}), null);
});
