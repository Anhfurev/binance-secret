import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase-admin";
import { computePaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import {
  recordPaperPortfolioSnapshot,
  type PaperWorkspaceDbCtx,
} from "@/lib/trading/paper-portfolio-db";
import type { PaperWorkspaceNav } from "@/lib/trading/paper-scalp-nav";
import type { CoinData, DemoAccount } from "@/lib/types";

function num(v: unknown, fb = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export type LiveProfileNav = {
  available_usdt: number;
  portfolio_nav_usdt: number;
  demo_balance: number;
};

/** Push computed NAV into profiles — fixes frozen demo_balance / available_usdt. */
export async function applyLiveProfileNav(params: {
  userId: string;
  account: DemoAccount;
  marketCoins: CoinData[];
  dbCtx?: PaperWorkspaceDbCtx | null;
}): Promise<LiveProfileNav> {
  const nav = computePaperWorkspaceNav(params.account, params.marketCoins);
  const patch: LiveProfileNav = {
    available_usdt: nav.available_usdt,
    portfolio_nav_usdt: nav.portfolio_nav_usdt,
    demo_balance: nav.portfolio_nav_usdt,
  };

  if (!isSupabaseAdminConfigured || !supabaseAdmin) return patch;

  const { error } = await supabaseAdmin
    .from("profiles")
    .update({
      available_usdt: patch.available_usdt,
      portfolio_nav_usdt: patch.portfolio_nav_usdt,
      demo_balance: patch.demo_balance,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.userId);

  if (error) {
    const hint =
      error.code === "PGRST116" || error.message.includes("0 rows")
        ? "profile row missing — set PAPER_TRADES_USER_ID to a valid profiles.id"
        : undefined;
    console.warn("[paper-profile-live] profiles update failed", {
      userId: params.userId,
      message: error.message,
      hint,
    });
    return patch;
  }

  if (params.dbCtx) {
    await recordPaperPortfolioSnapshot({
      ctx: params.dbCtx,
      nav,
    });
  }

  return patch;
}

export async function loadLiveProfileNav(
  userId: string,
): Promise<LiveProfileNav | null> {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("available_usdt,portfolio_nav_usdt,demo_balance")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  const available = num(data.available_usdt, num(data.demo_balance));
  const nav = num(data.portfolio_nav_usdt, available);
  if (nav <= 0 && available <= 0) return null;
  return {
    available_usdt: available,
    portfolio_nav_usdt: nav,
    demo_balance: num(data.demo_balance, nav),
  };
}

/** Prefer Supabase profile cash over stale JSON workspace payload. */
export async function mergeAccountWithLiveProfile(
  userId: string,
  account: DemoAccount,
): Promise<DemoAccount> {
  const live = await loadLiveProfileNav(userId);
  if (!live) return account;
  return {
    ...account,
    currentBalance: live.available_usdt,
    startingBalance:
      account.startingBalance > 0
        ? account.startingBalance
        : live.portfolio_nav_usdt,
  };
}

export function accountFromLiveNav(
  account: DemoAccount,
  live: LiveProfileNav,
): DemoAccount {
  return {
    ...account,
    currentBalance: live.available_usdt,
  };
}
