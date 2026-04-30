"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Bot, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { formatUnknownError } from "@/lib/error-utils";
import { useAuth } from "@/components/auth-provider";
import { supabase } from "@/lib/supabase";
import { Switch } from "@/components/ui/switch";
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
  resolvedBotUserId?: string | null;
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
  resolvedBotUserId,
}: AITradingMasterControlProps) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingLive, setIsSavingLive] = useState(false);
  const [isSavingAggressive, setIsSavingAggressive] = useState(false);
  const [liveExecutionEnabled, setLiveExecutionEnabled] = useState(false);
  const [aggressiveModeEnabled, setAggressiveModeEnabled] = useState(false);
  const [resolvedUserId, setResolvedUserId] = useState<string | null>(null);
  const DEFAULT_SYMBOLS = ["BTCUSDT", "PEPEUSDT", "SOLUSDT"] as const;

  const fetchBotSettingsSnapshot = async () => {
    const response = await fetch("/api/bot-settings", { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  };

  useEffect(() => {
    void (async () => {
      const targetUserId = await resolveTargetUserId();
      if (!targetUserId) return;
      await refreshAutoPilotState(targetUserId);
      await refreshLiveExecutionState(targetUserId);
      await refreshAggressiveModeState(targetUserId);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resync when auth or resolved bot user changes; helpers are stable enough per run
  }, [user?.id, resolvedBotUserId]);

  const resolveTargetUserId = async () => {
    const snapshot = await fetchBotSettingsSnapshot();
    const snapshotUserId = snapshot?.user_id ? String(snapshot.user_id) : null;
    if (snapshotUserId) {
      setResolvedUserId(snapshotUserId);
      if (typeof snapshot?.is_live_trading_enabled === "boolean") {
        setLiveExecutionEnabled(Boolean(snapshot.is_live_trading_enabled));
      }
      if (typeof snapshot?.is_aggressive_mode === "boolean") {
        setAggressiveModeEnabled(Boolean(snapshot.is_aggressive_mode));
      }
      return snapshotUserId;
    }
    if (resolvedBotUserId) {
      setResolvedUserId(resolvedBotUserId);
      return resolvedBotUserId;
    }
    if (user?.id) {
      setResolvedUserId(user.id);
      return user.id;
    }
    if (resolvedUserId) return resolvedUserId;
    return null;
  };

  const refreshAutoPilotState = async (userId: string) => {
    const snapshot = await fetchBotSettingsSnapshot();
    if (snapshot?.user_id && String(snapshot.user_id) === userId) {
      if (typeof snapshot?.is_autopilot_enabled === "boolean") {
        onToggleAutoPilot(Boolean(snapshot.is_autopilot_enabled));
      }
    }
  };

  const refreshLiveExecutionState = async (userId: string) => {
    const snapshot = await fetchBotSettingsSnapshot();
    if (snapshot?.user_id && String(snapshot.user_id) === userId) {
      if (typeof snapshot?.is_live_trading_enabled === "boolean") {
        setLiveExecutionEnabled(Boolean(snapshot.is_live_trading_enabled));
      }
    }
  };

  const refreshAggressiveModeState = async (userId: string) => {
    const snapshot = await fetchBotSettingsSnapshot();
    if (snapshot?.user_id && String(snapshot.user_id) === userId) {
      if (typeof snapshot?.is_aggressive_mode === "boolean") {
        setAggressiveModeEnabled(Boolean(snapshot.is_aggressive_mode));
      }
    }
  };

  const handleToggle = async () => {
    console.log("Toggle clicked", demoAutoPilot);
    const next = !demoAutoPilot;
    if (!user?.id) {
      onToggleAutoPilot(next);
      if (next) onAutoPilotModeChange("signals");
      window.dispatchEvent(
        new CustomEvent(AUTOMATION_EVENT, { detail: { enabled: next } }),
      );
      return;
    }

    try {
      setIsSaving(true);
      const targetUserId = await resolveTargetUserId();
      if (!targetUserId) {
        throw new Error("No user found for AUTOPILOT toggle.");
      }
      const response = await fetch("/api/bot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUserId,
          is_autopilot_enabled: next,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to update AUTOPILOT");
      }

      await refreshAutoPilotState(targetUserId);
      if (next) onAutoPilotModeChange("signals");
      window.dispatchEvent(
        new CustomEvent(AUTOMATION_EVENT, { detail: { enabled: next } }),
      );
      toast.success(
        next
          ? t("Full AI Trading ENABLED", "Бүтэн AI Арилжаа АСААЛАА")
          : t("Full AI Trading DISABLED", "Бүтэн AI Арилжаа УНТРААЛАА"),
        {
          description: t(
            "Saved to bot_settings successfully.",
            "bot_settings-д амжилттай хадгалагдлаа.",
          ),
        },
      );
    } catch (error) {
      const message = formatUnknownError(error);
      console.error("[AITradingMasterControl][toggle-autopilot]", message, error);
      toast.error(
        t("Failed to save AI toggle", "AI товч хадгалах үед алдаа гарлаа"),
        { description: message },
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleLiveExecution = async (next: boolean) => {
    const targetUserId = await resolveTargetUserId();
    if (!targetUserId) {
      toast.error(
        t("No user found for LIVE EXECUTION toggle.", "LIVE EXECUTION өөрчлөх хэрэглэгч олдсонгүй."),
      );
      return;
    }
    try {
      setIsSavingLive(true);
      const response = await fetch("/api/bot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUserId,
          is_live_trading_enabled: next,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to update LIVE EXECUTION");
      }
      const updated = await response.json();
      setLiveExecutionEnabled(Boolean(updated?.is_live_trading_enabled));
      toast.success(
        next
          ? t("LIVE EXECUTION enabled", "LIVE EXECUTION асаалттай")
          : t("LIVE EXECUTION disabled", "LIVE EXECUTION унтраалттай"),
        {
          description: t(
            "Live execution setting saved.",
            "Live execution тохиргоо хадгалагдлаа.",
          ),
        },
      );
    } catch (error) {
      const message = formatUnknownError(error);
      console.error("[AITradingMasterControl][toggle-live]", message, error);
      toast.error(
        t(
          "Failed to save LIVE EXECUTION setting.",
          "LIVE EXECUTION тохиргоо хадгалах үед алдаа гарлаа.",
        ),
        { description: message },
      );
    } finally {
      setIsSavingLive(false);
    }
  };

  const handleToggleAggressiveMode = async (next: boolean) => {
    const targetUserId = await resolveTargetUserId();
    if (!targetUserId) {
      toast.error(
        t("No user found for AGGRESSIVE MODE toggle.", "AGGRESSIVE MODE өөрчлөх хэрэглэгч олдсонгүй."),
      );
      return;
    }
    try {
      console.log("Aggressive mode toggle clicked", {
        current: aggressiveModeEnabled,
        next,
      });
      setIsSavingAggressive(true);
      setAggressiveModeEnabled(next);
      const response = await fetch("/api/bot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: targetUserId,
          is_aggressive_mode: next,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body?.error ?? "Failed to update AGGRESSIVE MODE");
      }
      const updated = await response.json();
      setAggressiveModeEnabled(Boolean(updated?.is_aggressive_mode));
      toast.success(
        next
          ? t("AGGRESSIVE MODE enabled", "AGGRESSIVE MODE асаалттай")
          : t("AGGRESSIVE MODE disabled", "AGGRESSIVE MODE унтраалттай"),
      );
    } catch (error) {
      const message = formatUnknownError(error);
      console.error("[AITradingMasterControl][toggle-aggressive]", message, error);
      setAggressiveModeEnabled((prev) => !prev);
      toast.error(
        t(
          "Failed to save AGGRESSIVE MODE setting.",
          "AGGRESSIVE MODE тохиргоо хадгалах үед алдаа гарлаа.",
        ),
        { description: message },
      );
    } finally {
      setIsSavingAggressive(false);
    }
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
              disabled={isSaving}
              className={cn(
                "min-w-40 gap-2 text-sm font-semibold transition-all",
                demoAutoPilot
                  ? "bg-success hover:bg-success/80 text-white shadow-[0_0_12px_rgba(34,197,94,0.4)]"
                  : "bg-primary hover:bg-primary/80",
              )}
              onClick={handleToggle}
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Bot className="h-4 w-4" />
              )}
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
            <div className="w-full rounded-lg border border-warning/40 bg-warning/10 p-3 text-left">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-xs font-semibold text-white">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  LIVE EXECUTION
                </p>
                <Switch
                  checked={liveExecutionEnabled}
                  disabled={isSavingLive}
                  onCheckedChange={handleToggleLiveExecution}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                {t(
                  "Enabling this will use real USDT for trades.",
                  "Үүнийг асаавал арилжаанд бодит USDT ашиглана.",
                )}
              </p>
            </div>
            <div className="w-full rounded-lg border border-orange-500/40 bg-red-500/10 p-3 text-left">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p
                  title={t(
                    "Bypasses technical indicators to follow high-confidence AI signals immediately.",
                    "Техникийн шүүлтүүрийг тойрч, өндөр итгэлтэй AI дохиог шууд дагана.",
                  )}
                  className="flex cursor-help items-center gap-2 text-xs font-semibold text-orange-300"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                  AGGRESSIVE MODE
                </p>
                <Switch
                  checked={aggressiveModeEnabled}
                  disabled={isSavingAggressive}
                  onCheckedChange={handleToggleAggressiveMode}
                />
              </div>
              <p className="text-[11px] text-orange-200/90">
                {t(
                  "Higher risk: AI-first entries with reduced technical veto.",
                  "Илүү эрсдэлтэй: техникийн veto багассан AI-first оролт.",
                )}
              </p>
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
