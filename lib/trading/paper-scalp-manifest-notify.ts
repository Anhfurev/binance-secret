/** Telegram manifest dispatch — high-signal + hourly sync only. */

export type ManifestDispatchReason =
  | "high_signal"
  | "hourly_sync"
  | "silent";

export type ManifestDispatchDecision = {
  dispatch: boolean;
  reason: ManifestDispatchReason;
};

export function isHourlySyncWindow(ranAtIso: string): boolean {
  const minute = new Date(ranAtIso).getUTCMinutes();
  return minute >= 0 && minute <= 2;
}

export function isStateChangingSummary(summary: string): boolean {
  if (summary.startsWith("opened:")) return true;
  if (summary.startsWith("closed:")) return true;
  if (summary.startsWith("velocity-tp-70:")) return true;
  if (summary === "pyramid-layer-added") return true;
  return false;
}

export function evaluateManifestTelegramDispatch(params: {
  ranAt: string;
  actions: string[];
  workspaceSummaries: string[];
  pyramidedAny?: boolean;
  positionClosedAny?: boolean;
  velocityPartialAny?: boolean;
  entryAny?: boolean;
}): ManifestDispatchDecision {
  if (isHourlySyncWindow(params.ranAt)) {
    return { dispatch: true, reason: "hourly_sync" };
  }

  const highSignal =
    params.actions.length > 0 ||
    params.pyramidedAny === true ||
    params.positionClosedAny === true ||
    params.velocityPartialAny === true ||
    params.entryAny === true ||
    params.workspaceSummaries.some(isStateChangingSummary);

  if (highSignal) {
    return { dispatch: true, reason: "high_signal" };
  }

  return { dispatch: false, reason: "silent" };
}
