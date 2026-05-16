// @ts-nocheck
export type LlmProvider = "gemini" | "groq";

export type LlmApiKeyRow = {
  id: string;
  provider: LlmProvider;
  api_key: string;
  status: "active" | "cooldown" | "blocked";
  cooldown_until: string | null;
  error_count: number;
  last_used_at: string | null;
};

export type GroqKeyPlan = {
  scanKeys: string[];
  vetoKeys: string[];
  /** Parallel to `scanKeys` / `vetoKeys` when `source === "db"` (same length). */
  scanDbIds: (string | undefined)[];
  vetoDbIds: (string | undefined)[];
  source: "db" | "env";
  /** When true, `groqAnalyze` / veto use a hard per-attempt timeout cap. */
  useDbHardTimeout: boolean;
};
