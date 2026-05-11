// @ts-nocheck
import type { createClient } from "npm:@supabase/supabase-js@2";
import { getTotalAccountBalanceUsdt } from "./binance.ts";
import { fromUsdCents, toUsdCents } from "./bot-shared.ts";
import { toNumber } from "./utils.ts";

export type WalletSummary = {
  demoBalance: number;
  startingBalance: number;
  accountPnl: number;
  realizedPnl: number;
  liveBalance: number | null;
};

export function formatSignedUsd(value: number) {
  if (!Number.isFinite(value)) return "n/a";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)} USDT`;
}

export function formatWalletDigestSection(summary: WalletSummary) {
  const lines = [
    `💰 <b>Balance</b> ${summary.demoBalance.toFixed(2)} USDT · <b>PnL</b> ${formatSignedUsd(summary.accountPnl)} · <b>Realized</b> ${formatSignedUsd(summary.realizedPnl)}`,
  ];
  if (summary.liveBalance != null && summary.liveBalance > 0) {
    lines.push(`<b>Live Binance</b> ${summary.liveBalance.toFixed(2)} USDT`);
  }
  return lines.join("\n");
}

export async function loadWalletSummary(
  supabase: ReturnType<typeof createClient>,
): Promise<WalletSummary> {
  const profilesResult = await supabase
    .from("profiles")
    .select("demo_balance, starting_balance");
  const profiles = Array.isArray(profilesResult.data) ? profilesResult.data : [];

  let demoBalanceCents = 0;
  let startingBalanceCents = 0;
  for (const row of profiles) {
    demoBalanceCents += toUsdCents(toNumber(row?.demo_balance, 0));
    const starting = toNumber(row?.starting_balance, 0);
    startingBalanceCents += toUsdCents(
      starting > 0 ? starting : toNumber(row?.demo_balance, 0),
    );
  }

  const closedTradesResult = await supabase
    .from("trades")
    .select("pnl")
    .ilike("status", "closed");
  const closedTrades = Array.isArray(closedTradesResult.data)
    ? closedTradesResult.data
    : [];
  let realizedPnlCents = 0;
  for (const row of closedTrades) {
    realizedPnlCents += toUsdCents(toNumber(row?.pnl, 0));
  }

  const demoBalance = fromUsdCents(demoBalanceCents);
  const startingBalance = fromUsdCents(startingBalanceCents);
  const accountPnl = fromUsdCents(demoBalanceCents - startingBalanceCents);
  const realizedPnl = fromUsdCents(realizedPnlCents);

  let liveBalance: number | null = null;
  try {
    const live = await getTotalAccountBalanceUsdt(false);
    if (Number.isFinite(live) && live > 0) liveBalance = live;
  } catch {
    liveBalance = null;
  }

  return { demoBalance, startingBalance, accountPnl, realizedPnl, liveBalance };
}
