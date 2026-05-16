// @ts-nocheck
/** Structured HTTP failure from LLM providers for DB key accounting. */

export class LlmHttpError extends Error {
  readonly status: number;
  readonly bodySnippet: string;

  constructor(message: string, status: number, bodySnippet: string) {
    super(message);
    this.name = "LlmHttpError";
    this.status = Number.isFinite(status) ? status : 0;
    this.bodySnippet = String(bodySnippet ?? "").slice(0, 400);
  }
}

export function isLlmHttpError(e: unknown): e is LlmHttpError {
  return e instanceof LlmHttpError;
}
