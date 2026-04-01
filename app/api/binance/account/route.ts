import { NextResponse } from "next/server";
import { binanceSignedSpotGet, getBinanceCredentials } from "@/lib/binance";

interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

interface BinanceAccountResponse {
  accountType: string;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  permissions?: string[];
  balances: BinanceBalance[];
}

interface AccountSummary {
  configured: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  accountType: string;
  permissions: string[];
  nonZeroBalances: Array<{
    asset: string;
    free: number;
    locked: number;
  }>;
}

export async function GET() {
  try {
    const { configured } = getBinanceCredentials();

    if (!configured) {
      return NextResponse.json(
        {
          configured: false,
          message:
            "BINANCE_API_KEY and BINANCE_API_SECRET are missing in environment variables.",
        },
        { status: 200 },
      );
    }

    const account =
      await binanceSignedSpotGet<BinanceAccountResponse>("/api/v3/account");

    const nonZeroBalances = account.balances
      .map((b) => ({
        asset: b.asset,
        free: Number(b.free),
        locked: Number(b.locked),
      }))
      .filter((b) => b.free > 0 || b.locked > 0)
      .sort((a, b) => b.free + b.locked - (a.free + a.locked))
      .slice(0, 20);

    const summary: AccountSummary = {
      configured: true,
      canTrade: account.canTrade,
      canWithdraw: account.canWithdraw,
      canDeposit: account.canDeposit,
      accountType: account.accountType,
      permissions: account.permissions ?? [],
      nonZeroBalances,
    };

    return NextResponse.json(summary, { status: 200 });
  } catch (error) {
    const errorMsg =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : typeof error === "object" && error !== null
            ? JSON.stringify(error, null, 2)
            : String(error);
    return NextResponse.json(
      {
        configured: true,
        ok: false,
        error: errorMsg,
      },
      { status: 500 },
    );
  }
}
