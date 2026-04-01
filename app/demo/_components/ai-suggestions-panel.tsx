"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, CheckCircle2, Zap } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import type { AITradeSignal, DemoTrade } from "@/lib/types";
import type { WalletMode } from "./types";

interface AISuggestionsPanelProps {
  signals: AITradeSignal[];
  demoAutoPilot: boolean;
  currentBalance: number;
  openPositions: DemoTrade[];
  signalSource: string;
  walletMode: WalletMode;
  onExecute: (signal: AITradeSignal) => void;
}

export function AISuggestionsPanel({
  signals,
  demoAutoPilot,
  currentBalance,
  openPositions,
  signalSource,
  walletMode,
  onExecute,
}: AISuggestionsPanelProps) {
  const { t } = useLanguage();

  return (
    <Card className="mb-6 border-primary/30 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-primary" />
            {t(
              "Fully Automatic AI Crypto Trader",
              "Бүрэн автомат AI Crypto Trader",
            )}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {demoAutoPilot
              ? t("Autonomous mode", "Автомат горим")
              : t("Preview mode", "Урьдчилсан харах")}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t(
            `The AI engine selects entries, exits, and position size. Current max allocation is 5% of balance = $${Math.floor(currentBalance * 0.05).toLocaleString()} per trade.`,
            `AI engine нь entry, exit, position size-ийг өөрөө шийднэ. Одоогийн дээд allocation нь үлдэгдлийн 5% = $${Math.floor(currentBalance * 0.05).toLocaleString()} нэг арилжаанд.`,
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("Signal feed", "Signal feed")}: {signalSource}
        </p>
        <p className="text-xs text-muted-foreground">
          {demoAutoPilot
            ? t(
                "AI is trading now. In-browser execution works immediately, and the backend runner can continue paper trading after deployment.",
                "AI одоо арилжаалж байна. Browser дээр шууд ажиллана, мөн deployment хийсний дараа backend runner paper trading-ийг үргэлжлүүлж чадна.",
              )
            : t(
                "Turn Full AI Trading ON to let the engine trade on its own. Manual buttons remain only as override controls.",
                "Full AI Trading-ийг ON болговол engine өөрөө арилжаална. Manual товчнууд зөвхөн override control хэвээр байна.",
              )}
        </p>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {signals.map((signal) => {
            const tradeSize = Math.floor(currentBalance * 0.05);
            const alreadyOpen = openPositions.some(
              (p) => p.signalId === signal.id,
            );
            const tp = signal.takeProfits[0]?.price ?? signal.entryPrice * 1.05;
            const expectedPnl = tradeSize * (tp / signal.entryPrice - 1);
            const pctGain = ((tp / signal.entryPrice - 1) * 100).toFixed(1);
            return (
              <div
                key={signal.id}
                className="flex items-center gap-4 rounded-lg border border-border/50 bg-secondary/20 p-3"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 font-bold text-sm text-primary">
                  {signal.symbol.replace(/USDT$/, "").slice(0, 3)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-foreground">
                      {signal.symbol}
                    </span>
                    <Badge
                      className={cn(
                        "text-[10px]",
                        signal.signalType === "STRONG_BUY"
                          ? "bg-success/20 text-success border-success/30"
                          : "bg-primary/20 text-primary border-primary/30",
                      )}
                      variant="outline"
                    >
                      {signal.signalType}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {signal.confidence}% conf
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Entry: ${signal.entryPrice.toLocaleString()}</span>
                    <span className="text-success">
                      TP: ${tp.toLocaleString()}
                    </span>
                    <span className="text-destructive">
                      SL: ${signal.stopLoss.toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-success">
                    {t("Est. profit", "Тооцоолсон ашиг")}: +$
                    {expectedPnl.toFixed(0)} (+{pctGain}%)
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => onExecute(signal)}
                  disabled={
                    alreadyOpen || tradeSize < 10 || walletMode === "real"
                  }
                  variant={alreadyOpen ? "outline" : "default"}
                  className={cn(
                    "shrink-0",
                    !alreadyOpen &&
                      "bg-success hover:bg-success/90 text-success-foreground",
                  )}
                >
                  {alreadyOpen ? (
                    <>
                      <CheckCircle2 className="mr-1 h-3 w-3" />
                      {t("Active", "Идэвхтэй")}
                    </>
                  ) : (
                    <>
                      <Zap className="mr-1 h-3 w-3" />
                      {t("Manual Override", "Гараар Override")}
                    </>
                  )}
                </Button>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">
            {t("24/7 note:", "24/7 тэмдэглэл:")}
          </span>{" "}
          {t(
            "A backend paper-trading runner is now available at /api/automation/paper/run. To make it truly 24/7, deploy the app and set CRON_SECRET so the scheduled job can execute every minute.",
            "Backend paper-trading runner одоо /api/automation/paper/run дээр бэлэн. Үүнийг жинхэнэ 24/7 болгохын тулд app-аа deploy хийж, scheduled job минут тутам ажиллахын тулд CRON_SECRET тохируулна.",
          )}
        </div>
      </CardContent>
    </Card>
  );
}
