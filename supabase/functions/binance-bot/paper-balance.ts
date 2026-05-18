// @ts-nocheck
import { isPaperTradingEnvForced } from "./paper-trade-interceptor.ts";
import { toNumber } from "./utils.ts";

/** Default paper simulation pool when profile balance is missing (tracking ledger). */
export const DEFAULT_PAPER_SIMULATION_POOL_USD = 9982.03;

export function readPaperSimulationPoolUsdt(): number {
  const raw = String(Deno.env.get("PAPER_SIMULATION_POOL_USDT") ?? "").trim();
  if (raw.length) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Number(n.toFixed(2));
  }
  return DEFAULT_PAPER_SIMULATION_POOL_USD;
}

/** Paper wallet updates apply to demo profile cash only — not ghost shadow runs. */
export function shouldApplyPaperDemoLedgerDelta(
  isTestMode: boolean,
  ghostMode: boolean,
): boolean {
  return Boolean(isTestMode && !ghostMode);
}

/** Prefer profile `demo_balance`; env fallback only when profile is missing. */
export function resolvePaperWalletUsdt(
  profileDemoBalance?: number | null,
): number {
  const profile = toNumber(profileDemoBalance, NaN);
  if (Number.isFinite(profile) && profile >= 0) {
    return Number(profile.toFixed(2));
  }
  const raw = String(Deno.env.get("TEST_USDT_BALANCE") ?? "").trim();
  const env = raw.length ? Number(raw) : NaN;
  if (Number.isFinite(env) && env > 0) return env;
  return 10_000;
}

/**
 * Global paper simulation liquidity — mirrors tracking pool into runtime free USDT
 * for every symbol when `IS_PAPER_TRADING` (or related env) is active.
 */
export function resolvePaperSimulationLiquidityUsdt(
  profileDemoBalance?: number | null,
): number {
  const profile = toNumber(profileDemoBalance, NaN);
  if (Number.isFinite(profile) && profile > 0) {
    return Number(profile.toFixed(2));
  }
  if (isPaperTradingEnvForced()) {
    return readPaperSimulationPoolUsdt();
  }
  return resolvePaperWalletUsdt(profileDemoBalance);
}

export function readDemoProbeEnabled(): boolean {
  const raw = String(Deno.env.get("DEMO_PROBE_ENABLED") ?? "0").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return raw === "1" || raw === "true" || raw === "yes";
}

export function readPaperStartingBalanceResyncEnabled(): boolean {
  const raw = String(Deno.env.get("PAPER_RESYNC_STARTING_ON_DRAWDOWN") ?? "0")
    .trim()
    .toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function readForceBuyConfidenceDelta(): number {
  const raw = String(Deno.env.get("FORCE_BUY_CONFIDENCE_DELTA") ?? "10").trim();
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 10;
  return Math.min(30, Math.floor(n));
}
