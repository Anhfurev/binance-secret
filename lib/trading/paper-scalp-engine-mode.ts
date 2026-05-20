export type PaperEngineMode = "alpha" | "micro";

const ALPHA_ALIASES = new Set(["alpha", "15m", "legacy", "hourly"]);

/** Defaults to micro when unset. Only explicit alpha aliases select 15m engine. */
export function resolvePaperEngineMode(): PaperEngineMode {
  const raw = String(process.env.PAPER_ENGINE_MODE ?? "micro")
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "");
  if (ALPHA_ALIASES.has(raw)) return "alpha";
  return "micro";
}

export function isMicroEngineMode(): boolean {
  return resolvePaperEngineMode() === "micro";
}

export function resolveMicroScalpInterval(): "1m" | "3m" {
  const raw = String(process.env.MICRO_SCALP_INTERVAL ?? "1m")
    .trim()
    .toLowerCase();
  return raw === "3m" ? "3m" : "1m";
}
