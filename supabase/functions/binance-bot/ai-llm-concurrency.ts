// @ts-nocheck
/**
 * Limits concurrent outbound LLM calls per warm isolate (Gemini + Groq veto).
 * Default 3 matches BTC/SOL/PEPE parallel symbol batches. Tunable: LLM_MAX_CONCURRENT (1–8).
 */
let active = 0;
const waiters: Array<() => void> = [];

export function readLlmMaxConcurrent(): number {
  const raw = String(Deno.env.get("LLM_MAX_CONCURRENT") ?? "3").trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return 3;
  return Math.min(8, Math.max(1, Math.floor(n)));
}

function readMaxConcurrent(): number {
  return readLlmMaxConcurrent();
}

export async function withLlmConcurrency<T>(fn: () => Promise<T>): Promise<T> {
  const max = readMaxConcurrent();
  if (active >= max) {
    await new Promise<void>((resolve) => {
      waiters.push(resolve);
    });
  }
  active += 1;
  try {
    return await fn();
  } finally {
    active -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}
