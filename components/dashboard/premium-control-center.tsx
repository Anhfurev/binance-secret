"use client";

import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import type { FuturesSignal } from "@/lib/types";
import {
  Bot,
  GraduationCap,
  Shield,
  Sparkles,
  Rocket,
  AlertTriangle,
  KeyRound,
  LineChart,
} from "lucide-react";
import { useLanguage } from "@/components/language-provider";

const spotFuturesStats = [
  { label: "Active API Keys", labelMn: "Идэвхтэй API түлхүүр", value: "15" },
  { label: "Active DCA Bots", labelMn: "Идэвхтэй DCA bot", value: "1K" },
  {
    label: "Active Signal Bots",
    labelMn: "Идэвхтэй Signal bot",
    value: "1K",
  },
  { label: "Active GRID Bots", labelMn: "Идэвхтэй GRID bot", value: "1K" },
  {
    label: "Active DCA Trades",
    labelMn: "Идэвхтэй DCA арилжаа",
    value: "5K",
  },
  {
    label: "Active Signal Trades",
    labelMn: "Идэвхтэй Signal арилжаа",
    value: "5K",
  },
  {
    label: "Active SmartTrades",
    labelMn: "Идэвхтэй SmartTrade",
    value: "5K",
  },
  { label: "DCA Backtests", labelMn: "DCA Backtest", value: "5K" },
  { label: "GRID Backtests", labelMn: "GRID Backtest", value: "5K" },
];

interface PremiumControlCenterProps {
  binanceConfigured: boolean;
  canTrade: boolean;
  canWithdraw: boolean;
  autoPilotEnabled: boolean;
  onAutoPilotChange: (enabled: boolean) => void;
  topSignal?: FuturesSignal;
}

export function PremiumControlCenter({
  binanceConfigured,
  canTrade,
  canWithdraw,
  autoPilotEnabled,
  onAutoPilotChange,
  topSignal,
}: PremiumControlCenterProps) {
  const { t } = useLanguage();
  const router = useRouter();

  const canEnableLiveAutoPilot = binanceConfigured && canTrade && !canWithdraw;

  const strategy =
    topSignal?.signal === "LONG"
      ? t("Trend Follow Long", "Өсөлт дагах long")
      : topSignal?.signal === "SHORT"
        ? t("Momentum Short", "Моментум short")
        : t("Wait & Mean Reversion", "Хүлээх ба дундаж руу буцах");

  return (
    <Card className="mb-6 border-primary/20 bg-card/90 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
          <Sparkles className="h-5 w-5 text-primary" />
          {t("Command Center", "Удирдлагын төв")}
          <Badge variant="outline" className="text-[10px]">
            {t("Pro", "Pro")}
          </Badge>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bot className="h-4 w-4 text-primary" />
                {t("AI Assistant", "AI туслах")}
                <Badge
                  className="bg-success/20 text-success"
                  variant="secondary"
                >
                  {t("NEW FEATURE", "ШИНЭ")}
                </Badge>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t(
                  "Spot & Futures automation cockpit with full history and bot analytics.",
                  "Spot & Futures автоматжуулалтын төв, бүтэн түүх болон bot шинжилгээтэй.",
                )}
              </p>
            </div>
            <Badge variant="outline" className="text-xs">
              <LineChart className="mr-1 h-3 w-3" />
              {t("Spot & Futures", "Spot & Futures")}
            </Badge>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {spotFuturesStats.map((item) => (
              <div
                key={item.label}
                className="rounded-md border border-border/60 bg-card/80 p-2.5"
              >
                <p className="text-lg font-bold text-foreground">
                  {item.value}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {t(item.label, item.labelMn)}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            <KeyRound className="h-3.5 w-3.5" />
            {t(
              "Backtests include full history mode.",
              "Backtest нь бүтэн түүхийн горимтой.",
            )}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border/60 bg-card/80 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <GraduationCap className="h-4 w-4 text-info" />
              {t("What each section does", "Хэсэг бүр юу хийдгийг тайлбар")}
            </p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              <li>
                {t(
                  "Dashboard: market pulse + AI summary",
                  "Dashboard: захын төлөв + AI товч дүгнэлт",
                )}
              </li>
              <li>
                {t(
                  "AI Signals: entry/SL/TP trade ideas",
                  "AI Signals: оролт/SL/TP арилжааны санаа",
                )}
              </li>
              <li>
                {t(
                  "Predictions: 1h/24h/7d/30d forecast",
                  "Predictions: 1ц/24ц/7ө/30ө таамаг",
                )}
              </li>
              <li>
                {t(
                  "Demo: risk-free bot training mode",
                  "Demo: эрсдэлгүй bot сургалтын горим",
                )}
              </li>
            </ul>
          </div>

          <div className="rounded-lg border border-border/60 bg-card/80 p-3">
            <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Rocket className="h-4 w-4 text-success" />
              {t(
                "Best current strategy",
                "Одоогийн хамгийн тохиромжтой стратеги",
              )}
            </p>
            <p className="text-sm font-medium text-foreground">{strategy}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {topSignal
                ? t(
                    `Top signal: ${topSignal.symbol} ${topSignal.signal} (${topSignal.confidence}% confidence)`,
                    `Шилдэг дохио: ${topSignal.symbol} ${topSignal.signal} (итгэлцэл ${topSignal.confidence}%)`,
                  )
                : t(
                    "Waiting for futures signal feed...",
                    "Futures дохио хүлээж байна...",
                  )}
            </p>
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/80 p-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Bot className="h-4 w-4 text-primary" />
                {t("Live Auto Trade AI", "Шууд Auto Trade AI")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "If ON, the system can place trades automatically in live mode.",
                  "ON бол систем live горимд арилжааг автоматаар хийж болно.",
                )}
              </p>
            </div>
            <Switch
              checked={autoPilotEnabled}
              onCheckedChange={onAutoPilotChange}
              disabled={!canEnableLiveAutoPilot}
              aria-label="Auto trade toggle"
            />
          </div>

          {!canEnableLiveAutoPilot && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
              <p className="flex items-center gap-2 font-medium text-white">
                <AlertTriangle className="h-3.5 w-3.5" />
                {t(
                  "Auto trade locked for safety",
                  "Аюулгүй байдлаар auto trade түгжээтэй",
                )}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t(
                  "Requirements: Binance connected, trading permission ON, withdrawals OFF.",
                  "Шаардлага: Binance холбогдсон, trading permission ON, withdrawal OFF.",
                )}
              </p>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Badge variant={binanceConfigured ? "default" : "secondary"}>
              {binanceConfigured
                ? t("Binance linked", "Binance холбогдсон")
                : t("Binance not linked", "Binance холбогдоогүй")}
            </Badge>
            <Badge variant={canTrade ? "default" : "secondary"}>
              {canTrade
                ? t("Trading enabled", "Trading идэвхтэй")
                : t("Trading disabled", "Trading идэвхгүй")}
            </Badge>
            <Badge variant={canWithdraw ? "destructive" : "default"}>
              {canWithdraw
                ? t("Withdrawal enabled", "Withdrawal идэвхтэй")
                : t("Withdrawal off", "Withdrawal унтраалттай")}
            </Badge>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-card/80 p-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Shield className="h-4 w-4 text-success" />
              {t("Pro advice", "Мэргэжлийн зөвлөгөө")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                "Use Demo Autopilot for 30+ days before enabling live automation.",
                "Live automation асаахаас өмнө Demo Autopilot-оо 30+ хоног турш.",
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/demo")}
          >
            {t("Open Demo Lab", "Demo Lab нээх")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
