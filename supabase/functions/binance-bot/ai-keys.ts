// @ts-nocheck
/** One Gemini credential: secret value + env var name (for logs; not the API key string). */
export type GeminiKeySlot = { value: string; label: string; llmDbKeyId?: string };

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
    .map(([key, value]) => ({ value: String(value).trim(), label: key }));

  const slots: GeminiKeySlot[] = [];
  const seen = new Set<string>();
  const push = (value: string, label: string) => {
    const v = value.trim();
    if (!v || seen.has(v)) return;
    seen.add(v);
    slots.push({ value: v, label });
  };

  const fallbackPrimary = (env.GEMINI_API_KEY ?? "").trim();
  if (fallbackPrimary) push(fallbackPrimary, "GEMINI_API_KEY");
  for (const row of numbered) push(row.value, row.label);

  const poolRaw = String(env.GEMINI_KEYS_POOL ?? "").trim();
  if (poolRaw.length) {
    // One comma between keys: "a,b,c".split(",") — never use ",," as a delimiter pattern.
    const parts = poolRaw.split(",").map((s) => s.trim()).filter(Boolean);
    parts.forEach((value, i) => push(value, `GEMINI_KEYS_POOL[${i}]`));
  }

  return slots;
}

export function getGeminiKeysFromEnv(): string[] {
  return getGeminiKeySlotsFromEnv().map((s) => s.value);
}

export function getGroqKeysFromEnv(): string[] {
  const env = Deno.env.toObject();
  const numberedKeys = Object.entries(env)
    .filter(([key, value]) => /^GROQ_API_KEY\d+$/.test(key) && value?.trim())
    .sort(([a], [b]) => {
      const aNum = Number(a.match(/\d+$/)?.[0] ?? 0);
      const bNum = Number(b.match(/\d+$/)?.[0] ?? 0);
      return aNum - bNum;
    })
    .map(([, value]) => String(value).trim());
  const primary = (env.GROQ_API_KEY ?? "").trim();
  const merged = primary ? [primary, ...numberedKeys] : numberedKeys;
  return [...new Set(merged)];
}

/**
 * Optional dedicated Groq keys for scan-only completions (`GROQ_API_KEY_SCAN1` … `SCANn`).
 * When empty, callers should fall back to `getGroqKeysFromEnv()` for the scan path.
 */
export function getGroqScanKeysFromEnv(): string[] {
  const env = Deno.env.toObject();
  const scanKeys = Object.entries(env)
    .filter(([key, value]) => /^GROQ_API_KEY_SCAN\d+$/.test(key) && value?.trim())
    .sort(([a], [b]) => {
      const aNum = Number(a.match(/\d+$/)?.[0] ?? 0);
      const bNum = Number(b.match(/\d+$/)?.[0] ?? 0);
      return aNum - bNum;
    })
    .map(([, value]) => String(value).trim());
  return [...new Set(scanKeys)];
}
