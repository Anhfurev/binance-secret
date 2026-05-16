import { assertEquals } from "jsr:@std/assert";
import {
  readGroqSoftFailureCooldownMs,
  resolveGroqKeyFailureCooldownMs,
} from "../groq-key-failure-cooldown.ts";

Deno.test("readGroqSoftFailureCooldownMs defaults to 60s", () => {
  const prev = Deno.env.get("GROQ_COOLDOWN_DURATION_SEC");
  try {
    Deno.env.delete("GROQ_COOLDOWN_DURATION_SEC");
    assertEquals(readGroqSoftFailureCooldownMs(), 60_000);
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_COOLDOWN_DURATION_SEC");
    else Deno.env.set("GROQ_COOLDOWN_DURATION_SEC", prev);
  }
});

Deno.test("readGroqSoftFailureCooldownMs respects GROQ_COOLDOWN_DURATION_SEC", () => {
  const prev = Deno.env.get("GROQ_COOLDOWN_DURATION_SEC");
  try {
    Deno.env.set("GROQ_COOLDOWN_DURATION_SEC", "120");
    assertEquals(readGroqSoftFailureCooldownMs(), 120_000);
    Deno.env.set("GROQ_COOLDOWN_DURATION_SEC", "0");
    assertEquals(readGroqSoftFailureCooldownMs(), 0);
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_COOLDOWN_DURATION_SEC");
    else Deno.env.set("GROQ_COOLDOWN_DURATION_SEC", prev);
  }
});

Deno.test("resolveGroqKeyFailureCooldownMs uses soft window for 429", () => {
  const prev = Deno.env.get("GROQ_COOLDOWN_DURATION_SEC");
  try {
    Deno.env.set("GROQ_COOLDOWN_DURATION_SEC", "90");
    assertEquals(resolveGroqKeyFailureCooldownMs("HTTP status 429"), 90_000);
  } finally {
    if (prev === undefined) Deno.env.delete("GROQ_COOLDOWN_DURATION_SEC");
    else Deno.env.set("GROQ_COOLDOWN_DURATION_SEC", prev);
  }
});

Deno.test("resolveGroqKeyFailureCooldownMs returns null for unrelated errors", () => {
  assertEquals(resolveGroqKeyFailureCooldownMs("ECONNRESET"), null);
});
