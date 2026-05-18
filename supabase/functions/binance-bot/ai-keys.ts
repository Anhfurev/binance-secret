// @ts-nocheck
/** One Gemini credential: secret value + env var name (for logs; not the API key string). */
export type GeminiKeySlot = {
  value: string;
  label: string;
  llmDbKeyId?: string;
  llmDbErrorCount?: number;
  llmDbStatus?: "active" | "cooldown" | "blocked";
  llmDbCooldownUntil?: string | null;
};

/** Trim vault/env cruft (quotes, whitespace) without logging the secret. */
export function normalizeLlmApiKeySecret(raw: unknown): string {
  let s = String(raw ?? "").trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Gemini keys from Edge env (order preserved, deduped by value):
 * 1. `GEMINI_API_KEY` (if set)
 * 2. `GEMINI_KEY_*` / `GEMINI_API_KEY*` (trailing number sort)
 * 3. `GEMINI_KEYS_POOL` — **ASCII comma `,` only** between keys (e.g. `key1,key2,key3`).
 *    Not `,,`. Empty segments from accidental `,,` are ignored after trim.
 */
export function getGeminiKeySlotsFromEnv(): GeminiKeySlot[] {
  const env = Deno.env.toObject();
  const numbered = Object.entries(env)
    .filter(([key, value]) =>
      (/^GEMINI_KEY_\d+$/.test(key) || /^GEMINI_API_KEY\d+$/.test(key)) &&
      value?.trim()
    )
    .sort(([a], [b]) => {
      const aNum = Number(a.match(/\d+$/)?.[0] ?? 0);
      const bNum = Number(b.match(/\d+$/)?.[0] ?? 0);
      return aNum - bNum;
    })
    .map(([key, value]) => ({ value: normalizeLlmApiKeySecret(value), label: key }));

  const slots: GeminiKeySlot[] = [];
  const seen = new Set<string>();
  const push = (value: string, label: string) => {
    const v = normalizeLlmApiKeySecret(value);
    if (!v || seen.has(v)) return;
    seen.add(v);
    slots.push({ value: v, label });
  };

  const fallbackPrimary = normalizeLlmApiKeySecret(env.GEMINI_API_KEY ?? "");
  if (fallbackPrimary) push(fallbackPrimary, "GEMINI_API_KEY");
  for (const row of numbered) push(row.value, row.label);

  const poolRaw = String(env.GEMINI_KEYS_POOL ?? "").trim();
  if (poolRaw.length) {
    // One comma between keys: "a,b,c".split(",") — never use ",," as a delimiter pattern.
    const parts = poolRaw.split(",").map((s) => s.trim()).filter(Boolean);
    parts.forEach((value, i) => push(value, `GEMINI_KEYS_POOL[${i}]`));
  }

  return dedupeGeminiKeySlotsByValue(slots);
}

/** One slot per normalized API secret — prefers DB-backed metadata when duplicates exist. */
export function dedupeGeminiKeySlotsByValue(slots: GeminiKeySlot[]): GeminiKeySlot[] {
  const byValue = new Map<string, GeminiKeySlot>();
  for (const slot of slots) {
    const v = normalizeLlmApiKeySecret(slot.value);
    if (!v) continue;
    const normalized: GeminiKeySlot = { ...slot, value: v };
    const prev = byValue.get(v);
    if (!prev) {
      byValue.set(v, normalized);
      continue;
    }
    if (!prev.llmDbKeyId && normalized.llmDbKeyId) {
      byValue.set(v, normalized);
    }
  }
  return [...byValue.values()];
}

export function getGeminiKeysFromEnv(): string[] {
  return getGeminiKeySlotsFromEnv().map((s) => s.value);
}

export function getGroqKeysFromEnv(): string[] {
  const env = Deno.env.toObject();
  const slots: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const v = normalizeLlmApiKeySecret(value);
    if (!v || seen.has(v)) return;
    seen.add(v);
    slots.push(v);
  };

  push(env.GROQ_API_KEY ?? env.GROQ_API_KEY1 ?? "");

  const poolRaw = String(env.GROQ_KEYS_POOL ?? "").trim();
  if (poolRaw.length) {
    poolRaw.split(",").map((s) => s.trim()).filter(Boolean).forEach(push);
  }

  const numberedKeys = Object.entries(env)
    .filter(([key, value]) => /^GROQ_API_KEY\d+$/.test(key) && normalizeLlmApiKeySecret(value))
    .sort(([a], [b]) => {
      const aNum = Number(a.match(/\d+$/)?.[0] ?? 0);
      const bNum = Number(b.match(/\d+$/)?.[0] ?? 0);
      return aNum - bNum;
    })
    .map(([, value]) => normalizeLlmApiKeySecret(value));
  for (const k of numberedKeys) push(k);

  return slots;
}

/**
 * Optional dedicated Groq keys for scan-only completions (`GROQ_API_KEY_SCAN1` … `SCANn`).
 * When empty, callers should fall back to `getGroqKeysFromEnv()` for the scan path.
 */
export function getGroqScanKeysFromEnv(): string[] {
  const env = Deno.env.toObject();
  const scanKeys = Object.entries(env)
    .filter(([key, value]) => /^GROQ_API_KEY_SCAN\d+$/.test(key) && normalizeLlmApiKeySecret(value))
    .sort(([a], [b]) => {
      const aNum = Number(a.match(/\d+$/)?.[0] ?? 0);
      const bNum = Number(b.match(/\d+$/)?.[0] ?? 0);
      return aNum - bNum;
    })
    .map(([, value]) => normalizeLlmApiKeySecret(value));
  return [...new Set(scanKeys)];
}
