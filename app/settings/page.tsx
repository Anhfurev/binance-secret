"use client";

import { useState, useEffect, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { AppLayout } from "@/components/layout/app-layout";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Settings,
  Bell,
  Brain,
  Shield,
  Palette,
  RefreshCw,
  Trash2,
  Download,
  AlertTriangle,
  Check,
  UserRound,
  LogIn,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import {
  defaultSettings,
  loadAppSettings,
  saveAppSettings,
  SETTINGS_KEY,
  type AppSettings,
} from "@/lib/trading/settings";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DEMO_STORAGE_KEY = "nextrade-demo-account";

function loadSettings(): AppSettings {
  return loadAppSettings();
}

export default function SettingsPage() {
  const { t } = useLanguage();
  const router = useRouter();
  const [notifications, setNotifications] = useState(
    defaultSettings.notifications,
  );
  const [riskSettings, setRiskSettings] = useState(defaultSettings.risk);
  const [scalpingSettings, setScalpingSettings] = useState(
    defaultSettings.scalping,
  );
  const [refreshInterval, setRefreshInterval] = useState([
    defaultSettings.refreshInterval,
  ]);
  const [hasChanges, setHasChanges] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  // Load from localStorage on mount
  useEffect(() => {
    const saved = loadSettings();
    setNotifications(saved.notifications);
    setRiskSettings(saved.risk);
    setScalpingSettings(saved.scalping);
    setRefreshInterval([saved.refreshInterval]);
  }, []);

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

  const handleSave = () => {
    const settings: AppSettings = {
      notifications,
      risk: riskSettings,
      refreshInterval: refreshInterval[0],
      scalping: scalpingSettings,
    };
    try {
      saveAppSettings(settings);
    } catch {}
    setHasChanges(false);
    toast.success(t("Settings saved!", "Тохиргоо хадгалагдлаа!"), {
      description: t(
        "Your preferences have been updated.",
        "Таны тохиргоо шинэчлэгдлээ.",
      ),
    });
  };

  const handleCancel = () => {
    const saved = loadSettings();
    setNotifications(saved.notifications);
    setRiskSettings(saved.risk);
    setScalpingSettings(saved.scalping);
    setRefreshInterval([saved.refreshInterval]);
    setHasChanges(false);
    toast.info(t("Changes reverted", "Өөрчлөлтүүд буцаагдлаа"));
  };

  const handleResetDemo = () => {
    try {
      localStorage.removeItem(DEMO_STORAGE_KEY);
    } catch {}
    toast.success(t("Demo account reset!", "Демо данс сэргээгдлээ!"), {
      description: t(
        "Starting balance restored to $100,000. Refresh the Demo page to see changes.",
        "Эхлэх үлдэгдэл $100,000 болж сэргээгдлээ. Demo хуудсыг шинэчилнэ үү.",
      ),
    });
  };

  const handleExportData = () => {
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
      toast.success(t("Data exported!", "Өгөгдөл экспортоллоо!"), {
        description: t(
          "Your trade history has been downloaded.",
          "Таны арилжааны түүх татагдлаа.",
        ),
      });
    } catch {
      toast.error(t("Export failed", "Экспорт амжилтгүй"));
    }
  };

  const handleClearAll = () => {
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
    toast.success(t("All local data cleared!", "Локал өгөгдөл цэвэрлэгдлээ!"), {
      description: t(
        "Settings and demo data have been removed.",
        "Тохиргоо ба демо өгөгдөл устгагдлаа.",
      ),
    });
  };

  const handleAuthSubmit = async (mode: "signin" | "signup") => {
    if (!isSupabaseConfigured || !supabase) {
      toast.error(t("Supabase is not configured", "Supabase тохируулаагүй"));
      return;
    }

    if (!authEmail.trim() || authPassword.length < 6) {
      toast.error(
        t(
          "Enter a valid email and a password with at least 6 characters.",
          "Зөв email болон хамгийн багадаа 6 тэмдэгттэй нууц үг оруулна уу.",
        ),
      );
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
      const errorMsg =
        typeof response.error === "object"
          ? response.error.message || JSON.stringify(response.error)
          : String(response.error);
      toast.error(errorMsg);
      return;
    }

    if (mode === "signup") {
      toast.success(t("Account created", "Бүртгэл үүслээ"), {
        description: t(
          "Check your email if confirmation is enabled, then sign in to sync your trader to your account.",
          "Хэрэв email баталгаажуулалт асаалттай бол email-ээ шалгаад, дараа нь trader-аа дансандаа синк хийхийн тулд нэвтэрнэ үү.",
        ),
      });
      return;
    }

    setAuthPassword("");
    toast.success(t("Signed in", "Нэвтэрлээ"), {
      description: t(
        "Cloud trader state will now sync to your Supabase account.",
        "Cloud trader state одоо таны Supabase данс руу синк хийнэ.",
      ),
    });
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    setAuthLoading(true);
    const { error } = await supabase.auth.signOut();
    setAuthLoading(false);

    if (error) {
      const errorMsg =
        typeof error === "object"
          ? error.message || JSON.stringify(error)
          : String(error);
      toast.error(errorMsg);
      return;
    }

    setAuthPassword("");
    toast.success(t("Signed out", "Гарлаа"));
  };

  return (
    <AppLayout showChatbot={false}>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
            <Settings className="h-7 w-7 text-primary" />
            {t("Settings", "Тохиргоо")}
          </h1>
          <p className="mt-1 text-muted-foreground">
            {t(
              "Customize your NexTrade experience",
              "NexTrade хэрэглээгээ тохируул",
            )}
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm lg:col-span-2">
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <UserRound className="h-5 w-5 text-primary" />
                    {t("Supabase Account", "Supabase бүртгэл")}
                  </CardTitle>
                  <CardDescription>
                    {t(
                      "Sign in to sync your AI trader, demo balance, and automation state to your personal account.",
                      "AI trader, demo balance, болон automation төлвийг хувийн дансандаа синк хийхийн тулд нэвтэрнэ үү.",
                    )}
                  </CardDescription>
                </div>
                <Badge variant={authUser ? "default" : "outline"}>
                  {authUser
                    ? t("Connected to account", "Дансанд холбогдсон")
                    : t("Device mode", "Төхөөрөмжийн горим")}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {!isSupabaseConfigured ? (
                <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-muted-foreground">
                  {t(
                    "Supabase environment variables are missing. Add them before using account sync.",
                    "Supabase environment variable байхгүй байна. Account sync ашиглахаас өмнө нэмнэ үү.",
                  )}
                </div>
              ) : authUser ? (
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                  <div>
                    <p className="font-medium text-foreground">
                      {authUser.email}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {t(
                        "Your cloud trader now belongs to this account across devices.",
                        "Таны cloud trader одоо энэ дансанд харьяалагдана.",
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={handleSignOut}
                    disabled={authLoading}
                  >
                    <LogOut className="mr-2 h-4 w-4" />
                    {t("Sign Out", "Гарах")}
                  </Button>
                </div>
              ) : (
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
                  <Input
                    type="email"
                    placeholder="you@example.com"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                  />
                  <Input
                    type="password"
                    placeholder={t("Password", "Нууц үг")}
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                  />
                  <Button
                    onClick={() => void handleAuthSubmit("signin")}
                    disabled={authLoading}
                  >
                    <LogIn className="mr-2 h-4 w-4" />
                    {t("Sign In", "Нэвтрэх")}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void handleAuthSubmit("signup")}
                    disabled={authLoading}
                  >
                    {t("Sign Up", "Бүртгүүлэх")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notifications */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bell className="h-5 w-5 text-primary" />
                {t("Notifications", "Мэдэгдэл")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Control which alerts you receive",
                  "Ямар анхааруулга авахыг удирдах",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("Price Alerts", "Үнийн анхааруулга")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Get notified on significant price movements",
                      "Үнэ хүчтэй хөдөлсөн үед мэдэгдэл авна",
                    )}
                  </p>
                </div>
                <Switch
                  checked={notifications.priceAlerts}
                  onCheckedChange={(checked) => {
                    setNotifications((prev) => ({
                      ...prev,
                      priceAlerts: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("AI Signal Alerts", "AI дохионы анхааруулга")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Notify when new BUY/SELL signals appear",
                      "Шинэ BUY/SELL дохио гарвал мэдэгдэнэ",
                    )}
                  </p>
                </div>
                <Switch
                  checked={notifications.signalAlerts}
                  onCheckedChange={(checked) => {
                    setNotifications((prev) => ({
                      ...prev,
                      signalAlerts: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("Whale Activity", "Whale идэвх")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Alert on large transactions",
                      "Том гүйлгээ гарвал мэдэгдэнэ",
                    )}
                  </p>
                </div>
                <Switch
                  checked={notifications.whaleAlerts}
                  onCheckedChange={(checked) => {
                    setNotifications((prev) => ({
                      ...prev,
                      whaleAlerts: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("Daily Digest", "Өдрийн тойм")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Daily summary of market activity",
                      "Зах зээлийн өдрийн тойм",
                    )}
                  </p>
                </div>
                <Switch
                  checked={notifications.dailyDigest}
                  onCheckedChange={(checked) => {
                    setNotifications((prev) => ({
                      ...prev,
                      dailyDigest: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>
            </CardContent>
          </Card>

          {/* Risk Management */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-primary" />
                {t("Risk Management", "Эрсдэлийн удирдлага")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Configure your risk parameters",
                  "Эрсдэлийн параметрүүдээ тохируул",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Max Position Size", "Нэг байрлалын дээд хэмжээ")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {riskSettings.maxPositionSize}%
                  </span>
                </div>
                <Slider
                  value={[riskSettings.maxPositionSize]}
                  onValueChange={(v) => {
                    setRiskSettings((prev) => ({
                      ...prev,
                      maxPositionSize: v[0],
                    }));
                    setHasChanges(true);
                  }}
                  max={50}
                  step={5}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Maximum % of portfolio in a single position",
                    "Нэг байрлалд оруулах багцын дээд хувь",
                  )}
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Max Daily Loss", "Өдрийн дээд алдагдал")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {riskSettings.maxDailyLoss}%
                  </span>
                </div>
                <Slider
                  value={[riskSettings.maxDailyLoss]}
                  onValueChange={(v) => {
                    setRiskSettings((prev) => ({
                      ...prev,
                      maxDailyLoss: v[0],
                    }));
                    setHasChanges(true);
                  }}
                  max={20}
                  step={1}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Stop trading if daily loss exceeds this",
                    "Өдрийн алдагдал энэ хэмжээнээс хэтэрвэл арилжааг зогсооно",
                  )}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("Stop-Loss Reminder", "Stop-loss сануулга")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Always prompt to set stop-loss",
                      "Stop-loss тохируулахыг үргэлж сануулна",
                    )}
                  </p>
                </div>
                <Switch
                  checked={riskSettings.stopLossReminder}
                  onCheckedChange={(checked) => {
                    setRiskSettings((prev) => ({
                      ...prev,
                      stopLossReminder: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-warning/50 bg-warning/5 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("Capital Protection Mode", "Капитал хамгаалах горим")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Extra conservative during volatility",
                      "Савлагаа их үед илүү хамгаалалттай",
                    )}
                  </p>
                </div>
                <Switch
                  checked={riskSettings.capitalProtection}
                  onCheckedChange={(checked) => {
                    setRiskSettings((prev) => ({
                      ...prev,
                      capitalProtection: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                {t("Scalping Filters", "Скальпинг шүүлтүүр")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Entry quality rules for 1m to 5m setups",
                  "1м-5м setup-д зориулсан оролтын чанарын дүрмүүд",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground">
                  {t("Scalping timeframe", "Скальпинг timeframe")}
                </label>
                <Select
                  value={scalpingSettings.timeframe}
                  onValueChange={(value) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      timeframe: value as typeof prev.timeframe,
                    }));
                    setHasChanges(true);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1m">1m</SelectItem>
                    <SelectItem value="3m">3m</SelectItem>
                    <SelectItem value="5m">5m</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Minimum AI confidence", "AI-ийн хамгийн бага итгэлцэл")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {scalpingSettings.minAiConfidence}%
                  </span>
                </div>
                <Slider
                  value={[scalpingSettings.minAiConfidence]}
                  onValueChange={(v) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      minAiConfidence: v[0],
                    }));
                    setHasChanges(true);
                  }}
                  min={50}
                  max={95}
                  step={1}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Profit to fee multiple", "Ашиг / шимтгэлийн харьцаа")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {scalpingSettings.minExpectedProfitToFeeRatio.toFixed(1)}x
                  </span>
                </div>
                <Slider
                  value={[scalpingSettings.minExpectedProfitToFeeRatio]}
                  onValueChange={(v) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      minExpectedProfitToFeeRatio: Number(v[0].toFixed(1)),
                    }));
                    setHasChanges(true);
                  }}
                  min={1}
                  max={5}
                  step={0.1}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Max spread", "Spread-ийн дээд хэмжээ")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {scalpingSettings.maxSpreadPct.toFixed(3)}%
                  </span>
                </div>
                <Slider
                  value={[scalpingSettings.maxSpreadPct]}
                  onValueChange={(v) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      maxSpreadPct: Number(v[0].toFixed(3)),
                    }));
                    setHasChanges(true);
                  }}
                  min={0.01}
                  max={0.15}
                  step={0.005}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Minimum liquidity", "Хамгийн бага хөрвөх чадвар")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    ${scalpingSettings.minLiquidityUsd.toLocaleString()}
                  </span>
                </div>
                <Slider
                  value={[scalpingSettings.minLiquidityUsd]}
                  onValueChange={(v) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      minLiquidityUsd: v[0],
                    }));
                    setHasChanges(true);
                  }}
                  min={250000}
                  max={10000000}
                  step={250000}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Min volatility", "Хамгийн бага савлагаа")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.minVolatilityPct.toFixed(2)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.minVolatilityPct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        minVolatilityPct: Number(v[0].toFixed(2)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.05}
                    max={1.5}
                    step={0.05}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Max volatility spike", "Савлагааны spike дээд")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.maxVolatilitySpikePct.toFixed(2)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.maxVolatilitySpikePct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        maxVolatilitySpikePct: Number(v[0].toFixed(2)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.5}
                    max={5}
                    step={0.1}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t(
                        "Technical confirmations",
                        "Техникийн баталгаажуулалт",
                      )}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.requiredTechnicalConfirmations}
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.requiredTechnicalConfirmations]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        requiredTechnicalConfirmations: v[0],
                      }));
                      setHasChanges(true);
                    }}
                    min={1}
                    max={4}
                    step={1}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Minimum trade score", "Хамгийн бага trade score")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.minTradeScore.toFixed(0)}
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.minTradeScore]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        minTradeScore: v[0],
                      }));
                      setHasChanges(true);
                    }}
                    min={50}
                    max={95}
                    step={1}
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-5 w-5 text-primary" />
                {t("Scalping Execution", "Скальпинг гүйцэтгэл")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Position sizing, exits, and slippage controls",
                  "Позицийн хэмжээ, exit, slippage-ийн хяналт",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Stop loss", "Stop loss")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.stopLossPct.toFixed(2)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.stopLossPct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        stopLossPct: Number(v[0].toFixed(2)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.1}
                    max={2}
                    step={0.05}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Take profit", "Take profit")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.takeProfitPct.toFixed(2)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.takeProfitPct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        takeProfitPct: Number(v[0].toFixed(2)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.2}
                    max={3}
                    step={0.05}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Max position size", "Позицийн дээд хэмжээ")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.maxPositionSizePct.toFixed(1)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.maxPositionSizePct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        maxPositionSizePct: Number(v[0].toFixed(1)),
                      }));
                      setHasChanges(true);
                    }}
                    min={1}
                    max={20}
                    step={0.5}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Max daily loss", "Өдрийн дээд алдагдал")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.maxDailyLossPct.toFixed(1)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.maxDailyLossPct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        maxDailyLossPct: Number(v[0].toFixed(1)),
                      }));
                      setHasChanges(true);
                    }}
                    min={1}
                    max={10}
                    step={0.5}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Max slippage", "Slippage-ийн дээд хэмжээ")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.maxSlippagePct.toFixed(3)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.maxSlippagePct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        maxSlippagePct: Number(v[0].toFixed(3)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.01}
                    max={0.2}
                    step={0.005}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Min order book depth", "Order book гүн")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      ${scalpingSettings.minOrderBookDepthUsd.toLocaleString()}
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.minOrderBookDepthUsd]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        minOrderBookDepthUsd: v[0],
                      }));
                      setHasChanges(true);
                    }}
                    min={50000}
                    max={1000000}
                    step={50000}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Maker fee", "Maker шимтгэл")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.makerFeePct.toFixed(3)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.makerFeePct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        makerFeePct: Number(v[0].toFixed(3)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.005}
                    max={0.1}
                    step={0.005}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium text-foreground">
                      {t("Taker fee", "Taker шимтгэл")}
                    </label>
                    <span className="text-sm text-muted-foreground">
                      {scalpingSettings.takerFeePct.toFixed(3)}%
                    </span>
                  </div>
                  <Slider
                    value={[scalpingSettings.takerFeePct]}
                    onValueChange={(v) => {
                      setScalpingSettings((prev) => ({
                        ...prev,
                        takerFeePct: Number(v[0].toFixed(3)),
                      }));
                      setHasChanges(true);
                    }}
                    min={0.01}
                    max={0.15}
                    step={0.005}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border border-border/50 p-4">
                <div>
                  <p className="font-medium text-foreground">
                    {t("Trailing stop", "Trailing stop")}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t(
                      "Tighten exits after price moves in your favor",
                      "Үнэ ашигтай чиглэвэл exit-ийг чангална",
                    )}
                  </p>
                </div>
                <Switch
                  checked={scalpingSettings.useTrailingStop}
                  onCheckedChange={(checked) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      useTrailingStop: checked,
                    }));
                    setHasChanges(true);
                  }}
                />
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Trailing distance", "Trailing зай")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {scalpingSettings.trailingStopPct.toFixed(2)}%
                  </span>
                </div>
                <Slider
                  value={[scalpingSettings.trailingStopPct]}
                  onValueChange={(v) => {
                    setScalpingSettings((prev) => ({
                      ...prev,
                      trailingStopPct: Number(v[0].toFixed(2)),
                    }));
                    setHasChanges(true);
                  }}
                  min={0.1}
                  max={2}
                  step={0.05}
                  disabled={!scalpingSettings.useTrailingStop}
                />
              </div>
            </CardContent>
          </Card>

          {/* Data Refresh */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <RefreshCw className="h-5 w-5 text-primary" />
                {t("Data Refresh", "Өгөгдөл шинэчлэх")}
              </CardTitle>
              <CardDescription>
                {t(
                  "How often market data updates",
                  "Захын өгөгдөл хэдийд шинэчлэгдэх",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-foreground">
                    {t("Refresh Interval", "Шинэчлэх интервал")}
                  </label>
                  <span className="text-sm text-muted-foreground">
                    {refreshInterval[0]}s
                  </span>
                </div>
                <Slider
                  value={refreshInterval}
                  onValueChange={(v) => {
                    setRefreshInterval(v);
                    setHasChanges(true);
                  }}
                  min={30}
                  max={300}
                  step={30}
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t("30s (faster)", "30сек (хурдан)")}</span>
                  <span>{t("5min (slower)", "5мин (удаан)")}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Data Management */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palette className="h-5 w-5 text-primary" />
                {t("Data Management", "Өгөгдлийн удирдлага")}
              </CardTitle>
              <CardDescription>
                {t(
                  "Export or reset your data",
                  "Өгөгдлөө экспортлох эсвэл сэргээх",
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleExportData}
              >
                <Download className="mr-2 h-4 w-4" />
                {t("Export Trade History", "Арилжааны түүх экспортлох")}
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start"
                onClick={handleResetDemo}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                {t("Reset Demo Account", "Демо данс сэргээх")}
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start text-destructive hover:bg-destructive/10"
                onClick={handleClearAll}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t("Clear All Local Data", "Локал өгөгдлийг цэвэрлэх")}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Save Button */}
        <div className="mt-8 flex justify-end gap-4">
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={!hasChanges}
          >
            {t("Cancel", "Цуцлах")}
          </Button>
          <Button onClick={handleSave} disabled={!hasChanges}>
            <Check className="mr-2 h-4 w-4" />
            {t("Save Settings", "Тохиргоо хадгалах")}
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
