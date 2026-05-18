/** Telegram manifest dispatch — high-signal + ULAT 10-minute tactical pulse. */

export type ManifestDispatchReason =
  | "high_signal"
  | "tactical_pulse"
  | "silent";

export type ManifestDispatchDecision = {
  dispatch: boolean;
  reason: ManifestDispatchReason;
};

/** ULAT = UTC+8 (VPS local expectation). */
const ULAT_OFFSET_MS = 8 * 60 * 60 * 1000;

let lastTacticalPulseUlatKey: string | null = null;

function getUlatParts(isoOrMs: string | number) {
  const ms = typeof isoOrMs === "string" ? Date.parse(isoOrMs) : isoOrMs;
  const ulat = new Date(ms + ULAT_OFFSET_MS);
  return {
    year: ulat.getUTCFullYear(),
    month: ulat.getUTCMonth() + 1,
    day: ulat.getUTCDate(),
    hour: ulat.getUTCHours(),
    minute: ulat.getUTCMinutes(),
  };
}

/** Block id for the current 10-minute ULAT window (…T14:00, …T14:10, …). */
export function formatUlatPulseBlockKey(isoOrMs: string | number): string {
  const p = getUlatParts(isoOrMs);
  const blockMinute = Math.floor(p.minute / 10) * 10;
  const mm = String(blockMinute).padStart(2, "0");
  const mo = String(p.month).padStart(2, "0");
  const dd = String(p.day).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  return `${p.year}-${mo}-${dd}T${hh}:${mm}`;
}

/** True when ULAT minute is :00, :10, :20, :30, :40, :50. */
export function isUlatPulseMinute(isoOrMs: string | number): boolean {
  return getUlatParts(isoOrMs).minute % 10 === 0;
}

/**
 * First tick on a pulse minute (minute % 10 === 0) → one Tactical Pulse Summary.
 * Later ticks in the same 10-minute block stay silent unless high-signal.
 */
export function claimTacticalPulseManifestSlot(ranAtIso: string): boolean {
  if (!isUlatPulseMinute(ranAtIso)) return false;
  const blockKey = formatUlatPulseBlockKey(ranAtIso);
  if (blockKey === lastTacticalPulseUlatKey) return false;
  lastTacticalPulseUlatKey = blockKey;
  return true;
}

export function resetTacticalPulseSlotForTests(): void {
  lastTacticalPulseUlatKey = null;
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
  if (claimTacticalPulseManifestSlot(params.ranAt)) {
    return { dispatch: true, reason: "tactical_pulse" };
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
