"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { toast } from "sonner";
import {
  defaultSettings,
  loadAppSettings,
  saveAppSettings,
  SETTINGS_KEY,
  type AppSettings,
} from "@/lib/trading/settings";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { formatUnknownError } from "@/lib/error-utils";

const DEMO_STORAGE_KEY = "nextrade-demo-account";

type TFn = (en: string, mn: string) => string;

export function useSettingsPageState(t: TFn) {
  const initialAppSettings = useMemo(() => loadAppSettings(), []);
  const [notifications, setNotifications] = useState(
    () => initialAppSettings.notifications,
  );
  const [riskSettings, setRiskSettings] = useState(() => initialAppSettings.risk);
  const [scalpingSettings, setScalpingSettings] = useState(
    () => initialAppSettings.scalping,
  );
  const [refreshInterval, setRefreshInterval] = useState(() => [
    initialAppSettings.refreshInterval,
  ]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let active = true;
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return;
      setAuthUser(data.user ?? null);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUser(session?.user ?? null);
    });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const markChanged = useCallback(() => setHasChanges(true), []);

  const handleSave = useCallback(async () => {
    const settings: AppSettings = {
      notifications,
      risk: riskSettings,
      refreshInterval: refreshInterval[0],
      scalping: scalpingSettings,
    };
    setSaveBusy(true);
    try {
      const res = await fetch("/api/bot-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(authUser?.id ? { user_id: authUser.id } : {}),
          min_ai_confidence: scalpingSettings.minAiConfidence,
          max_open_trades: scalpingSettings.maxOpenTrades,
          risk_percent: scalpingSettings.maxPositionSizePct,
          stop_loss_pct: scalpingSettings.stopLossPct,
          take_profit_pct: scalpingSettings.takeProfitPct,
          trailing_stop_pct: scalpingSettings.trailingStopPct,
          rsi_buy_threshold: scalpingSettings.rsiBuyThreshold,
          rsi_sell_threshold: scalpingSettings.rsiSellThreshold,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg =
          t("Could not sync bot settings.", "Ботын тохиргоо синк амжилтгүй.") +
          (data?.error ? ` ${data.error}` : ` (${res.status})`) +
          " Bot was not updated.";
        toast.error(msg, { duration: 8000, closeButton: true });
        return;
      }
      try {
        saveAppSettings(settings);
      } catch {}
      setHasChanges(false);
      toast.success(
        t(
          "Saved. Bot reads DB on the next run (~60s).",
          "Хадгалагдлаа. Бот дараагийн ажиллагаанд (~60с) DB-аас уншина.",
        ),
      );
    } catch (err) {
      toast.error(`${formatUnknownError(err)} Bot was not updated.`, {
        duration: 8000,
        closeButton: true,
      });
    } finally {
      setSaveBusy(false);
    }
  }, [authUser?.id, notifications, refreshInterval, riskSettings, scalpingSettings, t]);

  const handleCancel = useCallback(() => {
    const saved = loadAppSettings();
    setNotifications(saved.notifications);
    setRiskSettings(saved.risk);
    setScalpingSettings(saved.scalping);
    setRefreshInterval([saved.refreshInterval]);
    setHasChanges(false);
    toast.info(t("Changes reverted", "Өөрчлөлтүүд буцаагдлаа"));
  }, [t]);

  const handleResetDemo = useCallback(() => {
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {}
    toast.success(t("Demo account reset!", "Демо данс сэргээгдлээ!"));
  }, [t]);

  const handleExportData = useCallback(() => {
    try {
      const demoRaw = localStorage.getItem(DEMO_STORAGE_KEY);
      const settingsRaw = localStorage.getItem(SETTINGS_KEY);
      const exportData = {
        exportedAt: new Date().toISOString(),
        settings: settingsRaw ? JSON.parse(settingsRaw) : null,
        demoAccount: demoRaw ? JSON.parse(demoRaw) : null,
      };
      const blob = new Blob([JSON.stringify(exportData, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `nextrade-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("Data exported!", "Өгөгдөл экспортоллоо!"));
    } catch {
      toast.error(t("Export failed", "Экспорт амжилтгүй"));
    }
  }, [t]);

  const handleClearAll = useCallback(() => {
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      saveAppSettings(defaultSettings);
      localStorage.removeItem("nextrade-demo-trade-queue");
      localStorage.removeItem("nextrade-language-mode");
    } catch {}
    setNotifications(defaultSettings.notifications);
    setRiskSettings(defaultSettings.risk);
    setScalpingSettings(defaultSettings.scalping);
    setRefreshInterval([defaultSettings.refreshInterval]);
    setHasChanges(false);
    toast.success(t("All local data cleared!", "Локал өгөгдөл цэвэрлэгдлээ!"));
  }, [t]);

  const handleAuthSubmit = useCallback(
    async (mode: "signin" | "signup") => {
      if (!isSupabaseConfigured || !supabase) {
        toast.error(t("Supabase is not configured", "Supabase тохируулаагүй"));
        return;
      }
      if (!authEmail.trim() || authPassword.length < 6) {
        toast.error(t("Enter a valid email and password.", "Зөв email болон нууц үг оруулна уу."));
        return;
      }
      setAuthLoading(true);
      const response =
        mode === "signup"
          ? await supabase.auth.signUp({
              email: authEmail.trim(),
              password: authPassword,
            })
          : await supabase.auth.signInWithPassword({
              email: authEmail.trim(),
              password: authPassword,
            });
      setAuthLoading(false);
      if (response.error) {
        toast.error(formatUnknownError(response.error));
        return;
      }
      if (mode === "signup") {
        toast.success(t("Account created", "Бүртгэл үүслээ"));
        return;
      }
      setAuthPassword("");
      toast.success(t("Signed in", "Нэвтэрлээ"));
    },
    [authEmail, authPassword, t],
  );

  const handleSignOut = useCallback(async () => {
    if (!supabase) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signOut();
    setAuthLoading(false);
    if (error) {
      toast.error(formatUnknownError(error));
      return;
    }
    setAuthPassword("");
    toast.success(t("Signed out", "Гарлаа"));
  }, [t]);

  return {
    notifications,
    setNotifications,
    riskSettings,
    setRiskSettings,
    scalpingSettings,
    setScalpingSettings,
    refreshInterval,
    setRefreshInterval,
    hasChanges,
    saveBusy,
    markChanged,
    handleSave,
    handleCancel,
    handleResetDemo,
    handleExportData,
    handleClearAll,
    authUser,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authLoading,
    handleAuthSubmit,
    handleSignOut,
  };
}
