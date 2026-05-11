import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { formatWalletDigestSection } from "../telegram-wallet-summary.ts";
import {
  buildTelegramWalletStatusMessage,
  formatSignedUsd,
} from "../telegram-wallet-status.ts";

Deno.test("formatSignedUsd adds sign and suffix", () => {
  assertEquals(formatSignedUsd(12.3), "+12.30 USDT");
  assertEquals(formatSignedUsd(-4.5), "-4.50 USDT");
  assertEquals(formatSignedUsd(Number.NaN), "n/a");
});

Deno.test("formatWalletDigestSection includes balance and pnl", () => {
  const section = formatWalletDigestSection({
    demoBalance: 10500,
    startingBalance: 10000,
    accountPnl: 500,
    realizedPnl: 250,
    liveBalance: null,
  });
  assert(section.includes("Balance"));
  assert(section.includes("PnL"));
  assert(section.includes("Realized"));
});

Deno.test("buildTelegramWalletStatusMessage includes wallet and open positions", () => {
  const message = buildTelegramWalletStatusMessage({
    demoBalance: 10500,
    startingBalance: 10000,
    accountPnl: 500,
    realizedPnl: 250,
    liveBalance: 12000,
    openTrades: [{
      symbol: "BTCUSDT",
      amount: 0.01,
      value: 650,
      entryPrice: 64000,
    }],
  });
  assert(message.includes("WALLET"));
  assert(message.includes("Paper balance"));
  assert(message.includes("Account PnL"));
  assert(message.includes("Realized (closed trades)"));
  assert(message.includes("Live Binance"));
  assert(message.includes("BTCUSDT"));
});
