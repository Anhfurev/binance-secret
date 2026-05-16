// @ts-nocheck
/**
 * Serializes Groq HTTP calls from the same edge isolate to reduce same-ms bursts
 * from one IP. When unset, defaults to **2000ms** (serial symbol cycles) or **3000ms**
 * when `BOT_PARALLEL_SYMBOL_CYCLES=1`. Override with `GROQ_MIN_REQUEST_GAP_MS` (0 disables).
 */
let lastGroqRequestAt = 0;

/** Test helper: spacing clock otherwise leaks across Deno tests in one process. */
export function resetGroqRequestSpacingClockForTests(): void {
  lastGroqRequestAt = 0;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("CYCLE_ABORTED:llm"));
      return;
    }
    const id = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new Error("CYCLE_ABORTED:llm"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function defaultGroqGapMsWhenUnset(): number {
  const raw = String(Deno.env.get("BOT_PARALLEL_SYMBOL_CYCLES") ?? "0").trim().toLowerCase();
  const parallel = raw === "1" || raw === "true" || raw === "yes";
  // Wider gaps when parallel batches share one isolate (TPM / 429 safety). Override with `GROQ_MIN_REQUEST_GAP_MS`.
  return parallel ? 3000 : 2000;
}

export async function enforceGroqRequestSpacing(signal?: AbortSignal): Promise<void> {
  const rawStr = (Deno.env.get("GROQ_MIN_REQUEST_GAP_MS") ?? "").trim();
  const fallback = defaultGroqGapMsWhenUnset();
  const gapMs = !rawStr.length
    ? fallback
    : Number.isFinite(Number(rawStr)) && Number(rawStr) >= 0
    ? Math.min(10_000, Math.floor(Number(rawStr)))
    : fallback;
  if (gapMs === 0) return;
  const now = Date.now();
  const wait = Math.max(0, lastGroqRequestAt + gapMs - now);
  if (wait > 0) await delay(wait, signal);
  lastGroqRequestAt = Date.now();
}

/** Mandatory pause after Groq 429 before invoking Gemini fallback (`GROQ_TO_GEMINI_FALLBACK_GAP_MS`, min 3000). */
export function readGroqToGeminiFallbackGapMs(): number {
  const raw = Number(Deno.env.get("GROQ_TO_GEMINI_FALLBACK_GAP_MS") ?? "3000");
  if (!Number.isFinite(raw)) return 3000;
  return Math.min(30_000, Math.max(3000, Math.floor(raw)));
}

export async function enforceGroqToGeminiFallbackGap(signal?: AbortSignal): Promise<void> {
  await delay(readGroqToGeminiFallbackGapMs(), signal);
}

/** Pause before alternate-provider fallback (matrix: Groq↔Gemini). */
export async function enforceCrossProviderFallbackGap(signal?: AbortSignal): Promise<void> {
  await enforceGroqToGeminiFallbackGap(signal);
}
