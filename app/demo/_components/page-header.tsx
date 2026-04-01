"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, DollarSign, Plus, RefreshCw, Wallet } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import type { CloudSyncState, WalletMode } from "./types";

interface PageHeaderProps {
  walletMode: WalletMode;
  onWalletModeChange: (mode: WalletMode) => void;
  daysRemaining: number;
  cloudSyncState: CloudSyncState;
  onAddFunds: () => void;
  onPracticeTrade: () => void;
  onReset: () => void;
}

export function PageHeader({
  walletMode,
  onWalletModeChange,
  daysRemaining,
  cloudSyncState,
  onAddFunds,
  onPracticeTrade,
  onReset,
}: PageHeaderProps) {
  const { t } = useLanguage();

  return (
    <div className="mb-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
            <Wallet className="h-7 w-7 text-primary" />
            {t("Demo Account", "Демо данс")}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t(
              "Test AI signals with virtual money - no risk, real learning",
              "AI дохиог виртуал мөнгөөр турш - эрсдэлгүй, бодит суралцах боломж",
            )}
          </p>
          <div className="mt-3 inline-flex items-center rounded-lg border border-border bg-card p-1">
            <Button
              size="sm"
              variant={walletMode === "demo" ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => onWalletModeChange("demo")}
            >
              {t("Demo Wallet", "Demo wallet")}
            </Button>
            <Button
              size="sm"
              variant={walletMode === "real" ? "default" : "ghost"}
              className="h-7 px-3 text-xs"
              onClick={() => onWalletModeChange("real")}
            >
              {t("Real Wallet", "Real wallet")}
            </Button>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge
            variant={walletMode === "demo" ? "secondary" : "outline"}
            className={cn(
              "px-3 py-1",
              walletMode === "real" && "border-warning/40 bg-warning/10",
            )}
          >
            {walletMode === "demo"
              ? t("Mode: Demo", "Горим: Demo")
              : t("Mode: Real", "Горим: Real")}
          </Badge>
          <Badge
            variant={daysRemaining > 7 ? "default" : "destructive"}
            className="px-3 py-1"
          >
            <Clock className="mr-1.5 h-3 w-3" />
            {daysRemaining} {t("days remaining", "хоног үлдсэн")}
          </Badge>
          <Badge
            variant="outline"
            className={cn(
              "px-3 py-1",
              cloudSyncState === "synced" &&
                "border-success/40 bg-success/10 text-success",
              cloudSyncState === "syncing" &&
                "border-info/40 bg-info/10 text-foreground",
              cloudSyncState === "error" &&
                "border-destructive/40 bg-destructive/10 text-destructive",
            )}
          >
            {cloudSyncState === "disabled"
              ? t("Local only", "Local only")
              : cloudSyncState === "syncing"
                ? t("Cloud syncing", "Cloud синк хийж байна")
                : cloudSyncState === "synced"
                  ? t("Cloud synced", "Cloud синкдсэн")
                  : cloudSyncState === "error"
                    ? t("Cloud error", "Cloud алдаа")
                    : t("Cloud ready", "Cloud бэлэн")}
          </Badge>
          <Button
            size="sm"
            onClick={onAddFunds}
            className="bg-success hover:bg-success/90 text-success-foreground"
            disabled={walletMode === "real"}
          >
            <DollarSign className="mr-2 h-4 w-4" />
            {t("Add Funds", "Мөнгө нэмэх")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={onPracticeTrade}
            disabled={walletMode === "real"}
          >
            <Plus className="mr-2 h-4 w-4" />
            {t("Practice Trade", "Дадлагын арилжаа")}
          </Button>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RefreshCw className="mr-2 h-4 w-4" />
            {t("Reset", "Сэргээх")}
          </Button>
        </div>
      </div>
    </div>
  );
}
