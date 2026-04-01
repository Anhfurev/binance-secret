"use client";

import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Bot } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import type { CopyProfile } from "./types";

interface PaperTradingStatusProps {
  demoAutoPilot: boolean;
  currentBalance: number;
  marketSource: string;
  signalSource: string;
  copyProfile: CopyProfile;
  winRate: number;
  executableSignalsCount: number;
  openPositionsCount: number;
  marketUpdated: Date | null | undefined;
  signalsUpdated: Date | null | undefined;
}

export function PaperTradingStatus({
  demoAutoPilot,
  currentBalance,
  marketSource,
  signalSource,
  copyProfile,
  winRate,
  executableSignalsCount,
  openPositionsCount,
  marketUpdated,
  signalsUpdated,
}: PaperTradingStatusProps) {
  const { t } = useLanguage();

  return (
    <Card className="mb-6 border-primary/30 bg-card/60 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-5 w-5 text-primary" />
            {t("Paper Trading Automation", "Paper trading автоматжуулалт")}
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {marketSource === "live"
              ? t("Live market feed", "Шууд захын feed")
              : t("Cached market feed", "Кэш захын feed")}
          </Badge>
        </div>
        <CardDescription>
          {t(
            "AI signals are simulated on your demo balance using live market prices. No real money or exchange orders are used.",
            "AI дохиог таны demo balance дээр шууд захын үнээр симуляцлаж байна. Бодит мөнгө, exchange order ашиглахгүй.",
          )}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 md:grid-cols-5">
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("Automation", "Автомат")}
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {demoAutoPilot
                ? t("Copying signals", "Дохио хуулж байна")
                : t("Manual only", "Гараар")}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("Demo Balance", "Demo balance")}
            </p>
            <p className="mt-1 font-semibold text-foreground">
              ${currentBalance.toLocaleString()}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("Signal Source", "Signal эх сурвалж")}
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {signalSource === "live"
                ? t("Live AI", "Шууд AI")
                : t("Fallback AI", "Нөөц AI")}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("Copy profile", "Хуулах профайл")}
            </p>
            <p className="mt-1 font-semibold text-foreground capitalize">
              {copyProfile}
            </p>
          </div>
          <div className="rounded-lg border border-border/50 bg-secondary/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("Performance", "Гүйцэтгэл")}
            </p>
            <p className="mt-1 font-semibold text-foreground">
              {winRate.toFixed(1)}% WR
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span>
            {t("Active AI signals", "Идэвхтэй AI дохио")}:{" "}
            {executableSignalsCount}
          </span>
          <span>
            {t("Open positions", "Нээлттэй байрлал")}: {openPositionsCount}
          </span>
          <span>
            {t("Last market update", "Сүүлийн market update")}:{" "}
            {marketUpdated?.toLocaleTimeString() ?? "--"}
          </span>
          <span>
            {t("Last signal update", "Сүүлийн signal update")}:{" "}
            {signalsUpdated?.toLocaleTimeString() ?? "--"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
