// @ts-nocheck
/** Shared LLM abort/timeout detection for Gemini ↔ Groq cascade logic. */
export function isAbortOrTimeoutError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  const m = String((error as Error)?.message ?? error).toLowerCase();
  return m.includes("abort") || m.includes("timeout") || m.includes("timed out");
}
