// @ts-nocheck
export function getGeminiKeysFromEnv(): string[] {
  const env = Deno.env.toObject();
  const numberedKeys = Object.entries(env)
    .filter(([key, value]) =>
      (/^GEMINI_KEY_\d+$/.test(key) || /^GEMINI_API_KEY\d+$/.test(key)) &&
      value?.trim()
    )
    .sort(([a], [b]) => {
      const aNum = Number(a.match(/\d+$/)?.[0] ?? 0);
      const bNum = Number(b.match(/\d+$/)?.[0] ?? 0);
      return aNum - bNum;
    })
    .map(([, value]) => String(value).trim());
  const fallbackPrimary = (env.GEMINI_API_KEY ?? "").trim();
  const merged = fallbackPrimary
    ? [fallbackPrimary, ...numberedKeys]
    : numberedKeys;
  return [...new Set(merged)];
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
