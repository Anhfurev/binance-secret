// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { fireAndForgetLogsInsert } from "./async-supabase-writes.ts";
import type { MarketRegime } from "./types.ts";
import type { WarRoomConsensus } from "./war-room.ts";

/** Non-blocking insert into `public.logs`. */
export function safeInsertLog(
  supabase: ReturnType<typeof createClient>,
  row: Record<string, unknown>,
  context: string,
) {
  fireAndForgetLogsInsert(supabase, row, context);
}

/** Ghost/paper execution audit row for BUY decisions (no exchange side effect). */
export async function logMockTrade(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  tradeUsd: number;
  price: number;
  qty: number;
  strategyNotes: string;
}) {
  const { supabase, userId, symbol, tradeUsd, price, qty, strategyNotes } = params;
  safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "info",
      source: "mock-execution",
      message: "GHOST_BUY",
      meta: {
        event: "ghost_buy",
        usd_size: Number(tradeUsd.toFixed(4)),
        price: Number(price.toFixed(8)),
        qty: Number(qty.toFixed(8)),
        strategy: strategyNotes,
      },
      created_at: new Date().toISOString(),
    },
    "ghost_buy_mock_execution",
  );
}

/** Ghost / audit: persist War Room outcome without opening a trade row. */
export async function logWarRoomGhostSnapshot(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  warRoom: WarRoomConsensus;
  rawWeighted: number;
  effectiveChart: number;
  regime: MarketRegime;
  detail: string;
}) {
  const { supabase, userId, symbol, warRoom, rawWeighted, effectiveChart, regime, detail } =
    params;
  safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "info",
      source: "war-room-ghost",
      message: "war_room_snapshot",
      meta: {
        event: "war_room_ghost_snapshot",
        detail,
        regime,
        raw_weighted_confidence: rawWeighted,
        effective_chart_confidence: effectiveChart,
        war_room: {
          agent_votes: warRoom.agent_votes,
          final_governance: warRoom.final_governance,
          governance_floor: warRoom.governance_floor,
          base_floor: warRoom.base_floor,
          quorum_passed: warRoom.quorum_passed,
        },
      },
      created_at: new Date().toISOString(),
    },
    "war_room_ghost_snapshot",
  );
}

export async function logBuyFlowFailure(params: {
  supabase: ReturnType<typeof createClient>;
  userId: string;
  symbol: string;
  message: string;
  meta?: Record<string, unknown>;
}) {
  const { supabase, userId, symbol, message, meta } = params;
  safeInsertLog(
    supabase,
    {
      user_id: userId,
      symbol,
      level: "error",
      source: "buy-flow-error",
      message,
      meta: {
        event: "buy_flow_error",
        ...(meta ?? {}),
      },
      created_at: new Date().toISOString(),
    },
    "buy_flow_error",
  );
}
