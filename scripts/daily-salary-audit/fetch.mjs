const TRADE_SELECT =
  "id,symbol,status,exit_reason,pnl,pnlPercent,opened_at,closed_at,value,extra";

export async function fetchClosedTrades(supabase, startIso, endIso) {
  const { data, error } = await supabase
    .from("trades")
    .select(TRADE_SELECT)
    .in("status", ["closed", "stopped"])
    .gte("closed_at", startIso)
    .lte("closed_at", endIso)
    .order("closed_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchWalletSnapshot(supabase) {
  const { data, error } = await supabase
    .from("profiles")
    .select("demo_balance,starting_balance,max_drawdown_limit")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

export async function fetchBuyBlockerLogs(supabase, startIso, endIso) {
  const { data, error } = await supabase
    .from("logs")
    .select("message,meta,created_at")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .in("message", [
      "execution_hold",
      "execution_skip",
      "war_room_quorum_gate",
      "war_room_news_veto",
      "buy_flow_skip",
    ])
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}

export async function fetchWarRoomAudits(supabase, startIso, endIso) {
  const { data, error } = await supabase
    .from("war_room_audits")
    .select("final_decision,veto_details,created_at")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data ?? [];
}
