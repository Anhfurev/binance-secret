export const WATCHDOG_BLOCKER_HINTS = {
  warRoomHold:
    "AI saw a setup but War Room governance kept risk off (quorum, news veto, or HOLD).",
  minConfidence:
    "Setup was close but below the regime confidence floor (e.g. STABLE 62 / CHAOS 78).",
  spreadWide:
    "Bid-ask spread was wider than the regime cap — avoiding bad paper/live fills.",
};

export function classifyWatchdogBlocker(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (
    /^war_room:hold$/i.test(String(reason ?? "").trim()) ||
    /war_room_quorum|war_room_news_veto|war room|buy blocked: war room/.test(text)
  ) {
    return "warRoomHold";
  }
  if (
    /fail_ai|hold_ai_confidence|confidence too low|effective confidence|grinder floor|below.*confidence|min confidence|floor \d+%/.test(text) ||
    /hold:.*confidence/.test(text) ||
    /<\s*\w+\s+floor\s+\d+%/.test(text)
  ) {
    return "minConfidence";
  }
  if (
    /fail_wide_spread|wide_spread|spread too wide|hold_smart_filter_wide_spread|hold_wide_spread/.test(text)
  ) {
    return "spreadWide";
  }
  return null;
}

export function aggregateWatchdogBlockers(blockerCounts) {
  const totals = {
    warRoomHold: 0,
    minConfidence: 0,
    spreadWide: 0,
  };
  for (const [reason, count] of blockerCounts.entries()) {
    const bucket = classifyWatchdogBlocker(reason);
    if (!bucket) continue;
    totals[bucket] += Number(count) || 0;
  }
  const rows = [
    {
      key: "warRoomHold",
      label: "War Room: HOLD",
      count: totals.warRoomHold,
      hint: WATCHDOG_BLOCKER_HINTS.warRoomHold,
    },
    {
      key: "minConfidence",
      label: "Below min confidence",
      count: totals.minConfidence,
      hint: WATCHDOG_BLOCKER_HINTS.minConfidence,
    },
    {
      key: "spreadWide",
      label: "Spread too wide",
      count: totals.spreadWide,
      hint: WATCHDOG_BLOCKER_HINTS.spreadWide,
    },
  ];
  const gateEvents = rows.reduce((sum, row) => sum + row.count, 0);
  return {
    totals,
    rows,
    gateEvents,
    isActive: gateEvents > 0,
  };
}

export function formatWatchdogBlockerLines(watchdog) {
  if (!watchdog?.rows?.length) return [];
  return watchdog.rows.map((row) => ({
    label: row.label,
    count: row.count,
    hint: row.hint,
  }));
}
