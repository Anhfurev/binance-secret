export const FRICTION_TAX_WARN_PCT = 30;
export const WFE_REGIME_SHIFT_RATIO = 0.85;

export function computePartialExitStats(trades) {
  let partialTpCloses = 0;
  let beStopAfterPartial = 0;
  let beStopHits = 0;
  for (const row of trades) {
    const reason = String(row.exit_reason ?? "").toLowerCase();
    const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
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

export function scanChaosBlockerSignals(topBlockers) {
  const chaosPattern =
    /chaos|fail_wide_spread|fail_low_1m_volume|hold_wide_spread|hold_low_1m_volume/i;
  return (topBlockers ?? []).filter((row) => chaosPattern.test(String(row.reason ?? "")));
}

export function buildAuditDiagnostics({ quant, partialExit, topBlockers }) {
  const frictionElevated =
    quant?.frictionTaxPctOfNet != null &&
    quant.frictionTaxPctOfNet > FRICTION_TAX_WARN_PCT;
  const wfe = quant?.walkForwardEfficiency;
  const wfeRegimeShift =
    wfe != null &&
    wfe < WFE_REGIME_SHIFT_RATIO &&
    quant?.avgProfitFactor7d != null;
  return {
    frictionElevated,
    wfeRegimeShift,
    chaosBlockers: scanChaosBlockerSignals(topBlockers),
    partialExit: partialExit ?? {},
  };
}

export function formatPlaybookLines(diagnostics) {
  const lines = [];
  if (diagnostics.frictionElevated) {
    lines.push(
      "• Friction tax is above 30% of net PnL — consider raising partial-TP targets or tightening spread filters.",
    );
  }
  const partial = diagnostics.partialExit;
  if (partial.partialTpCloses > 0) {
    const pctLabel =
      partial.beStopAfterPartialPct == null
        ? "n/a"
        : `${partial.beStopAfterPartialPct.toFixed(0)}%`;
    lines.push(
      `• BE-stop after partial TP: ${partial.beStopAfterPartial}/${partial.partialTpCloses} (${pctLabel}). High ratios can mean tight initial stops or weak trend follow-through.`,
    );
  } else if (partial.beStopHits > 0) {
    lines.push(
      `• BE-stop hits: ${partial.beStopHits} (no partial_tp flags on closed rows in this window).`,
    );
  }
  if (diagnostics.wfeRegimeShift) {
    const chaosHint = diagnostics.chaosBlockers.length
      ? ` Review blockers: ${diagnostics.chaosBlockers.map((row) => row.reason).join(", ")}.`
      : " Compare Top Blockers for CHAOS spread/volume gates.";
    lines.push(
      `• 24h profit factor trails the 7d average — regime may have shifted.${chaosHint}`,
    );
  }
  return lines;
}
