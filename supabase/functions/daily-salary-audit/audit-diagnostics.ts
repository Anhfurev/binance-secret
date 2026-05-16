// @ts-nocheck
export const FRICTION_TAX_WARN_PCT = 30;
export const WFE_REGIME_SHIFT_RATIO = 0.85;

export function computePartialExitStats(
  trades: Array<{ exit_reason?: string | null; extra?: Record<string, unknown> | null }>,
) {
  let partialTpCloses = 0;
  let beStopAfterPartial = 0;
  let beStopHits = 0;
  for (const row of trades) {
    const reason = String(row.exit_reason ?? "").toLowerCase();
    const extra = row.extra ?? {};
    const hadPartial = extra.partial_tp_executed === true;
    if (hadPartial) partialTpCloses += 1;
    if (reason === "be_stop_hit") {
      beStopHits += 1;
      if (hadPartial) beStopAfterPartial += 1;
    }
  }
  const beStopAfterPartialRatio =
    partialTpCloses > 0 ? beStopAfterPartial / partialTpCloses : null;
  return {
    partialTpCloses,
    beStopAfterPartial,
    beStopHits,
    beStopAfterPartialRatio,
    beStopAfterPartialPct:
      beStopAfterPartialRatio == null ? null : beStopAfterPartialRatio * 100,
  };
}

export function scanChaosBlockerSignals(topBlockers: Array<{ reason: string; count: number }>) {
  const chaosPattern =
    /chaos|fail_wide_spread|fail_low_1m_volume|hold_wide_spread|hold_low_1m_volume/i;
  return (topBlockers ?? []).filter((row) => chaosPattern.test(String(row.reason ?? "")));
}

export function buildAuditDiagnostics(params: {
  quant: Record<string, unknown>;
  partialExit: Record<string, unknown>;
  topBlockers: Array<{ reason: string; count: number }>;
}) {
  const { quant, partialExit, topBlockers } = params;
  const frictionElevated =
    quant?.frictionTaxPctOfNet != null &&
    Number(quant.frictionTaxPctOfNet) > FRICTION_TAX_WARN_PCT;
  const wfe = quant?.walkForwardEfficiency;
  const wfeRegimeShift =
    wfe != null &&
    Number(wfe) < WFE_REGIME_SHIFT_RATIO &&
    quant?.avgProfitFactor7d != null;
  return {
    frictionElevated,
    wfeRegimeShift,
    chaosBlockers: scanChaosBlockerSignals(topBlockers),
    partialExit: partialExit ?? {},
  };
}

export function formatPlaybookLines(diagnostics: {
  frictionElevated?: boolean;
  wfeRegimeShift?: boolean;
  chaosBlockers?: Array<{ reason: string; count: number }>;
  partialExit?: Record<string, unknown>;
}): string[] {
  const lines: string[] = [];
  if (diagnostics.frictionElevated) {
    lines.push(
      "• Friction tax is above 30% of net PnL — consider raising partial-TP targets or tightening spread filters.",
    );
  }
  const partial = diagnostics.partialExit ?? {};
  const partialTpCloses = Number(partial.partialTpCloses ?? 0);
  const beStopAfterPartial = Number(partial.beStopAfterPartial ?? 0);
  const beStopHits = Number(partial.beStopHits ?? 0);
  const beStopAfterPartialPct = partial.beStopAfterPartialPct;
  if (partialTpCloses > 0) {
    const pctLabel =
      beStopAfterPartialPct == null
        ? "n/a"
        : `${Number(beStopAfterPartialPct).toFixed(0)}%`;
    lines.push(
      `• BE-stop after partial TP: ${beStopAfterPartial}/${partialTpCloses} (${pctLabel}). High ratios can mean tight initial stops or weak trend follow-through.`,
    );
  } else if (beStopHits > 0) {
    lines.push(
      `• BE-stop hits: ${beStopHits} (no partial_tp flags on closed rows in this window).`,
    );
  }
  if (diagnostics.wfeRegimeShift) {
    const chaosHint = (diagnostics.chaosBlockers ?? []).length
      ? ` Review blockers: ${(diagnostics.chaosBlockers ?? []).map((row) => row.reason).join(", ")}.`
      : " Compare Top Blockers for CHAOS spread/volume gates.";
    lines.push(
      `• 24h profit factor trails the 7d average — regime may have shifted.${chaosHint}`,
    );
  }
  return lines;
}
