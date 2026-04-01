"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bot } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import type { AutoPilotMode, CloudSyncState, WalletMode } from "./types";
import { AUTOMATION_EVENT } from "./types";

interface AITradingMasterControlProps {
  demoAutoPilot: boolean;
  onToggleAutoPilot: (next: boolean) => void;
  autoPilotMode: AutoPilotMode;
  onAutoPilotModeChange: (mode: AutoPilotMode) => void;
  walletMode: WalletMode;
  currentBalance: number;
  openPositionsCount: number;
  executableSignalsCount: number;
  cloudSyncState: CloudSyncState;
  cloudSyncMessage: string | null;
  lastCloudSync: string | null;
  formatDate: (date: Date) => string;
}

export function AITradingMasterControl({
  demoAutoPilot,
  onToggleAutoPilot,
  autoPilotMode,
  onAutoPilotModeChange,
  walletMode,
  currentBalance,
  openPositionsCount,
  executableSignalsCount,
  cloudSyncState,
  cloudSyncMessage,
  lastCloudSync,
  formatDate,
}: AITradingMasterControlProps) {
  const { t } = useLanguage();

  const handleToggle = () => {
    if (walletMode === "real") return;
    const next = !demoAutoPilot;
    onToggleAutoPilot(next);
    if (next) onAutoPilotModeChange("signals");
    window.dispatchEvent(
      new CustomEvent(AUTOMATION_EVENT, { detail: { enabled: next } }),
    );
    toast.success(
      next
        ? t("Full AI Trading ENABLED", "Бүтэн AI Арилжаа АСААЛАА")
        : t("Full AI Trading DISABLED", "Бүтэн AI Арилжаа УНТРААЛАА"),
      {
        description: next
          ? t(
              "AI will now scan and execute trades automatically.",
              "AI одоо автоматаар дохио скан хийж арилжаа хийнэ.",
            )
          : t("Switched to manual mode.", "Гараар горим руу шилжлээ."),
      },
    );
  };

  return (
    <Card
      className={cn(
        "mb-6 border-2 transition-all duration-300",
        demoAutoPilot
          ? "border-success/60 bg-success/5 shadow-[0_0_24px_rgba(34,197,94,0.15)]"
          : "border-border/50 bg-card/60",
      )}
    >
      <CardContent className="pt-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 transition-all",
                demoAutoPilot
                  ? "border-success/60 bg-success/10"
                  : "border-border bg-secondary/40",
              )}
            >
              <Bot
                className={cn(
                  "h-7 w-7 transition-colors",
                  demoAutoPilot ? "text-success" : "text-muted-foreground",
                )}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-foreground">
                  {t("Full AI Trading", "Бүтэн AI Арилжаа")}
                </h2>
                <Badge
                  className={cn(
                    "text-xs font-semibold",
                    demoAutoPilot
                      ? "bg-success/20 text-success border-success/40"
                      : "bg-muted text-muted-foreground",
                  )}
                  variant="outline"
                >
                  {demoAutoPilot
                    ? t("● ACTIVE", "● ИДЭВХТЭЙ")
                    : t("○ OFFLINE", "○ УНТАРСАН")}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {demoAutoPilot
                  ? t(
                      "AI is actively scanning signals and executing trades on your demo balance.",
                      "AI дохиог скан хийж, демо балансад арилжаа хийж байна.",
                    )
                  : t(
                      "Enable to let AI automatically trade for you using live signals.",
                      "AI-д автоматаар арилжаа хийлгэхийн тулд асаана уу.",
                    )}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {cloudSyncState === "local"
                  ? (cloudSyncMessage ??
                    t(
                      "Supabase sync is not ready yet. Paper trading is using local storage.",
                      "Supabase sync хараахан бэлэн биш байна. Paper trading local storage ашиглаж байна.",
                    ))
                  : cloudSyncState === "error"
                    ? (cloudSyncMessage ??
                      t(
                        "Cloud sync failed. Local mode is still active.",
                        "Cloud синк амжилтгүй. Local mode үргэлжилж байна.",
                      ))
                    : lastCloudSync
                      ? t(
                          `Last cloud sync ${formatDate(new Date(lastCloudSync))}`,
                          `Сүүлийн cloud sync ${formatDate(new Date(lastCloudSync))}`,
                        )
                      : t(
                          "Cloud sync keeps your demo AI state backed up on this device.",
                          "Cloud sync нь энэ төхөөрөмжийн demo AI төлөвийг хадгална.",
                        )}
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <Button
              size="lg"
              disabled={walletMode === "real"}
              className={cn(
                "min-w-40 gap-2 text-sm font-semibold transition-all",
                demoAutoPilot
                  ? "bg-success hover:bg-success/80 text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]"
                  : "bg-primary hover:bg-primary/80",
              )}
              onClick={handleToggle}
            >
              <Bot className="h-4 w-4" />
              {demoAutoPilot
                ? t("Turn OFF AI", "AI Унтраах")
                : t("Turn ON AI", "AI Асаах")}
            </Button>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={autoPilotMode === "signals" ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                disabled={!demoAutoPilot || walletMode === "real"}
                onClick={() => onAutoPilotModeChange("signals")}
              >
                {t("Signal Scalp", "Signal Scalp")}
              </Button>
              <Button
                size="sm"
                variant={autoPilotMode === "dca" ? "default" : "outline"}
                className="h-7 px-2.5 text-xs"
                disabled={!demoAutoPilot || walletMode === "real"}
                onClick={() => onAutoPilotModeChange("dca")}
              >
                {t("DCA Mode", "DCA горим")}
              </Button>
            </div>
          </div>
        </div>
        {demoAutoPilot && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/50 pt-4 sm:grid-cols-4">
            <div className="rounded-lg bg-secondary/30 p-2.5">
              <p className="text-[11px] text-muted-foreground">
                {t("Balance", "Үлдэгдэл")}
              </p>
              <p className="mt-0.5 text-sm font-bold text-foreground">
                ${currentBalance.toLocaleString()}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2.5">
              <p className="text-[11px] text-muted-foreground">
                {t("Open Positions", "Нээлттэй")}
              </p>
              <p className="mt-0.5 text-sm font-bold text-foreground">
                {openPositionsCount}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2.5">
              <p className="text-[11px] text-muted-foreground">
                {t("Mode", "Горим")}
              </p>
              <p className="mt-0.5 text-sm font-bold text-foreground capitalize">
                {autoPilotMode === "dca" ? "DCA" : "Signal Scalp"}
              </p>
            </div>
            <div className="rounded-lg bg-secondary/30 p-2.5">
              <p className="text-[11px] text-muted-foreground">
                {t("Available Signals", "Боломжит дохио")}
              </p>
              <p className="mt-0.5 text-sm font-bold text-foreground">
                {executableSignalsCount}
              </p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
