/** Keep legacy trades varchar columns safe (prod DB uses varchar(50) on several cols). */
export const TRADES_LEGACY_VARCHAR_MAX = 50;
export const TRADES_STRATEGY_KEY_MAX = 48;

export function truncateDbText(
  value: unknown,
  maxLen = TRADES_LEGACY_VARCHAR_MAX,
): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length <= maxLen ? text : text.slice(0, maxLen);
}

export function buildPaperStrategyKey(
  legId: string,
  exitReason: string,
): string {
  const id = legId.trim();
  const reason = exitReason.trim().slice(0, 24);
  const key = `${id.slice(0, 20)}|${reason || "paper-scalp"}`;
  return key.length <= TRADES_STRATEGY_KEY_MAX
    ? key
    : key.slice(0, TRADES_STRATEGY_KEY_MAX);
}
