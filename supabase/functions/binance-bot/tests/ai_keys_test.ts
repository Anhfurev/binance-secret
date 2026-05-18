import { assertEquals } from "jsr:@std/assert";
import {
  dedupeGeminiKeySlotsByValue,
  getGeminiKeySlotsFromEnv,
  getGroqKeysFromEnv,
  getGroqScanKeysFromEnv,
  normalizeLlmApiKeySecret,
} from "../ai-keys.ts";

Deno.test("getGroqScanKeysFromEnv collects GROQ_API_KEY_SCANn in order", () => {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(Deno.env.toObject())) {
    if (/^GROQ_API_KEY/.test(k)) prev[k] = Deno.env.get(k) ?? undefined;
  }
  try {
    for (const k of Object.keys(prev)) Deno.env.delete(k);
    Deno.env.set("GROQ_API_KEY_SCAN2", "b");
    Deno.env.set("GROQ_API_KEY_SCAN1", "a");
    Deno.env.set("GROQ_API_KEY_SCAN4", "d");
    assertEquals(getGroqScanKeysFromEnv(), ["a", "b", "d"]);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) Deno.env.delete(k);
      else Deno.env.set(k, v);
    }
  }
});

Deno.test("normalizeLlmApiKeySecret strips quotes and whitespace", () => {
  assertEquals(normalizeLlmApiKeySecret('  "gsk_test123"  '), "gsk_test123");
});

Deno.test("getGroqKeysFromEnv reads GROQ_KEYS_POOL comma list", () => {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (/^GROQ_/.test(key)) {
      saved[key] = value;
      Deno.env.delete(key);
    }
  }
  Deno.env.set("GROQ_KEYS_POOL", "alpha,beta");
  try {
    assertEquals(getGroqKeysFromEnv(), ["alpha", "beta"]);
  } finally {
    for (const key of Object.keys(saved)) Deno.env.set(key, saved[key]);
    Deno.env.delete("GROQ_KEYS_POOL");
  }
});

Deno.test("getGroqKeysFromEnv merges primary and numbered keys", () => {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (/^GROQ_API_KEY/.test(key)) {
      saved[key] = value;
      Deno.env.delete(key);
    }
  }
  Deno.env.set("GROQ_API_KEY", "primary");
  Deno.env.set("GROQ_API_KEY2", "second");
  Deno.env.set("GROQ_API_KEY10", "tenth");
  try {
    const keys = getGroqKeysFromEnv();
    assertEquals(keys, ["primary", "second", "tenth"]);
  } finally {
    for (const key of Object.keys(saved)) {
      Deno.env.set(key, saved[key]);
    }
    Deno.env.delete("GROQ_API_KEY");
    Deno.env.delete("GROQ_API_KEY2");
    Deno.env.delete("GROQ_API_KEY10");
  }
});

Deno.test("getGeminiKeySlotsFromEnv preserves env labels and order", () => {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (/^GEMINI_/.test(key)) {
      saved[key] = value;
      Deno.env.delete(key);
    }
  }
  Deno.env.set("GEMINI_API_KEY", "alpha");
  Deno.env.set("GEMINI_KEY_2", "beta");
  Deno.env.set("GEMINI_API_KEY18", "gamma");
  try {
    const slots = getGeminiKeySlotsFromEnv();
    assertEquals(slots.map((s) => s.value), ["alpha", "beta", "gamma"]);
    assertEquals(slots.map((s) => s.label), ["GEMINI_API_KEY", "GEMINI_KEY_2", "GEMINI_API_KEY18"]);
  } finally {
    for (const key of Object.keys(saved)) {
      Deno.env.set(key, saved[key]);
    }
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.delete("GEMINI_KEY_2");
    Deno.env.delete("GEMINI_API_KEY18");
  }
});

Deno.test("getGeminiKeySlotsFromEnv parses GEMINI_KEYS_POOL and dedupes with GEMINI_API_KEY", () => {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (/^GEMINI_/.test(key)) {
      saved[key] = value;
      Deno.env.delete(key);
    }
  }
  Deno.env.set("GEMINI_API_KEY", "alpha");
  Deno.env.set("GEMINI_KEYS_POOL", "beta, gamma ,alpha");
  try {
    const slots = getGeminiKeySlotsFromEnv();
    assertEquals(slots.map((s) => s.value), ["alpha", "beta", "gamma"]);
    assertEquals(slots.map((s) => s.label), ["GEMINI_API_KEY", "GEMINI_KEYS_POOL[0]", "GEMINI_KEYS_POOL[1]"]);
  } finally {
    for (const key of Object.keys(saved)) {
      Deno.env.set(key, saved[key]);
    }
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.delete("GEMINI_KEYS_POOL");
  }
});

Deno.test("getGeminiKeySlotsFromEnv pool-only supplies keys", () => {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (/^GEMINI_/.test(key)) {
      saved[key] = value;
      Deno.env.delete(key);
    }
  }
  Deno.env.set("GEMINI_KEYS_POOL", "k1,k2");
  try {
    const slots = getGeminiKeySlotsFromEnv();
    assertEquals(slots.map((s) => s.value), ["k1", "k2"]);
  } finally {
    for (const key of Object.keys(saved)) {
      Deno.env.set(key, saved[key]);
    }
    Deno.env.delete("GEMINI_KEYS_POOL");
  }
});

Deno.test("dedupeGeminiKeySlotsByValue collapses db+env duplicate secrets", () => {
  const slots = dedupeGeminiKeySlotsByValue([
    { value: "alpha", label: "llm_api_keys:1", llmDbKeyId: "id-1" },
    { value: "alpha", label: "GEMINI_API_KEY" },
    { value: "beta", label: "GEMINI_KEYS_POOL[0]" },
    { value: "beta", label: "llm_api_keys:2", llmDbKeyId: "id-2" },
  ]);
  assertEquals(slots.length, 2);
  assertEquals(slots.map((s) => s.value), ["alpha", "beta"]);
  assertEquals(slots[0]?.llmDbKeyId, "id-1");
  assertEquals(slots[1]?.llmDbKeyId, "id-2");
});

Deno.test("getGeminiKeySlotsFromEnv pool splits on single comma; accidental ,, yields separate keys", () => {
  const saved: Record<string, string> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (/^GEMINI_/.test(key)) {
      saved[key] = value;
      Deno.env.delete(key);
    }
  }
  Deno.env.set("GEMINI_KEYS_POOL", "k1,,k2");
  try {
    const slots = getGeminiKeySlotsFromEnv();
    assertEquals(slots.map((s) => s.value), ["k1", "k2"]);
  } finally {
    for (const key of Object.keys(saved)) {
      Deno.env.set(key, saved[key]);
    }
    Deno.env.delete("GEMINI_KEYS_POOL");
  }
});
