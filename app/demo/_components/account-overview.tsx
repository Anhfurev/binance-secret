"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Link2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/components/language-provider";
import type {
  AutoPilotMode,
  BinanceConnectionState,
  CopyProfile,
  DemoAccountProfile,
  WalletMode,
} from "./types";

interface AccountOverviewProps {
  walletMode: WalletMode;
  demoAutoPilot: boolean;
  onDemoAutoPilotChange: (v: boolean) => void;
  autoPilotMode: AutoPilotMode;
  onAutoPilotModeChange: (mode: AutoPilotMode) => void;
  copyProfile: CopyProfile;
  onCopyProfileChange: (profile: CopyProfile) => void;
  copyProfileConfig: { allocationCapPct: number; maxOpenPositions: number };
  autoTradeCadenceSec: number;
  onCadenceChange: (sec: number) => void;
  demoProfiles: DemoAccountProfile[];
  activeDemoAccountId: string;
  onSwitchAccount: (id: string) => void;
  balanceOverride: string;
  onBalanceOverrideChange: (v: string) => void;
  onApplyBalanceOverride: () => void;
  newDemoAccountName: string;
  onNewDemoAccountNameChange: (v: string) => void;
  newDemoAccountBalance: string;
  onNewDemoAccountBalanceChange: (v: string) => void;
  onCreateDemoAccount: () => void;
  onRemoveDemoAccount: () => void;
  binanceConnection: BinanceConnectionState;
  onCheckBinanceConnection: () => void;
}

export function AccountOverview({
  walletMode,
  demoAutoPilot,
  onDemoAutoPilotChange,
  autoPilotMode,
  onAutoPilotModeChange,
  copyProfile,
  onCopyProfileChange,
  copyProfileConfig,
  autoTradeCadenceSec,
  onCadenceChange,
  demoProfiles,
  activeDemoAccountId,
  onSwitchAccount,
  balanceOverride,
  onBalanceOverrideChange,
  onApplyBalanceOverride,
  newDemoAccountName,
  onNewDemoAccountNameChange,
  newDemoAccountBalance,
  onNewDemoAccountBalanceChange,
  onCreateDemoAccount,
  onRemoveDemoAccount,
  binanceConnection,
  onCheckBinanceConnection,
}: AccountOverviewProps) {
  const { t } = useLanguage();

  return (
    <Card className="mb-6 border-info/30 bg-info/5">
      <CardContent className="pt-6">
        <div className="space-y-3">
          {walletMode === "real" && (
            <div className="rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning-foreground">
              <p className="font-medium text-foreground">
                {t("Real Wallet selected", "Real wallet горим сонгогдсон")}
              </p>
              <p className="mt-1 text-muted-foreground">
                {t(
                  "Live execution requires API keys and permissions in Settings. Demo actions are currently locked in Real mode.",
                  "Live гүйцэтгэлд Settings дээр API key болон эрх тохируулах шаардлагатай. Real горимд demo үйлдлүүд түгжигдэнэ.",
                )}
              </p>
            </div>
          )}
          <p className="text-sm font-semibold text-foreground">
            {t("Quick Introduction", "Түргэн танилцуулга")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t(
              "This page is your safe lab. Turn AI Copy Trading ON to automatically follow AI signals in paper mode. Keep it OFF for manual practice.",
              "Энэ бол таны аюулгүй туршилтын lab. AI Copy Trading ON бол AI дохиог paper mode дээр автоматаар дагана. OFF бол гараар дадлага хийнэ.",
            )}
          </p>
          <Separator />

          <div className="rounded-md border border-border/60 bg-background/60 p-3">
            <p className="text-sm font-medium text-foreground">
              {t("Demo Account Manager", "Demo account удирдлага")}
            </p>
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">
                  {t("Active account", "Идэвхтэй account")}
                </p>
                <Select
                  value={activeDemoAccountId}
                  onValueChange={onSwitchAccount}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {demoProfiles.map((profile) => (
                      <SelectItem key={profile.id} value={profile.id}>
                        {profile.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={balanceOverride}
                  onChange={(e) => onBalanceOverrideChange(e.target.value)}
                  type="number"
                  min={0}
                  placeholder={t("Set balance", "Үлдэгдэл тохируулах")}
                />
                <Button variant="outline" onClick={onApplyBalanceOverride}>
                  {t("Apply Balance", "Үлдэгдэл хэрэгжүүлэх")}
                </Button>
              </div>
            </div>

            <div className="mt-2 grid gap-2 md:grid-cols-3">
              <Input
                value={newDemoAccountName}
                onChange={(e) => onNewDemoAccountNameChange(e.target.value)}
                placeholder={t("New account name", "Шинэ account нэр")}
              />
              <Input
                value={newDemoAccountBalance}
                onChange={(e) => onNewDemoAccountBalanceChange(e.target.value)}
                type="number"
                min={0}
                placeholder={t("Starting balance", "Эхлэх үлдэгдэл")}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={onCreateDemoAccount}>
                  {t("Create Demo Account", "Demo account үүсгэх")}
                </Button>
                <Button
                  variant="outline"
                  className="text-destructive hover:bg-destructive/10"
                  onClick={onRemoveDemoAccount}
                >
                  {t("Remove account", "Account устгах")}
                </Button>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {t(
                "Each demo account has independent balance, trade history, and automation state.",
                "Demo account бүр тусдаа үлдэгдэл, түүх, automation төлөвтэй.",
              )}
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("AI Copy Trading", "AI Copy Trading")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Follows AI strategies in paper mode and auto-copies eligible signals.",
                  "AI стратегийг paper mode дээр дагаж, тохирох дохиог автоматаар хуулна.",
                )}
              </p>
            </div>
            <Switch
              checked={demoAutoPilot}
              onCheckedChange={(v) => {
                if (walletMode === "real") {
                  toast.info(
                    t(
                      "AI Copy Trading is disabled in Real mode",
                      "Real горимд AI Copy Trading идэвхгүй",
                    ),
                  );
                  return;
                }
                onDemoAutoPilotChange(v);
                toast.info(
                  v
                    ? t("AI Copy Trading enabled", "AI Copy Trading асаалаа")
                    : t(
                        "AI Copy Trading disabled",
                        "AI Copy Trading унтраалаа",
                      ),
                  {
                    description: v
                      ? t(
                          "AI signals will be copied automatically in paper mode.",
                          "AI дохиог paper mode дээр автоматаар хуулна.",
                        )
                      : t(
                          "Back to manual practice mode.",
                          "Гараар дадлага хийх горим руу буцлаа.",
                        ),
                  },
                );
              }}
              disabled={walletMode === "real"}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("Copy profile", "Хуулах профайл")}:
            </span>
            {(["conservative", "balanced", "aggressive"] as CopyProfile[]).map(
              (profile) => (
                <Button
                  key={profile}
                  size="sm"
                  variant={copyProfile === profile ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => onCopyProfileChange(profile)}
                >
                  {profile === "conservative"
                    ? t("Conservative", "Болгоомжтой")
                    : profile === "aggressive"
                      ? t("Aggressive", "Идэвхтэй")
                      : t("Balanced", "Тэнцвэртэй")}
                </Button>
              ),
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("Automation mode", "Automation горим")}:
            </span>
            <Button
              size="sm"
              variant={autoPilotMode === "signals" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => onAutoPilotModeChange("signals")}
            >
              {t("Signal Scalp", "Signal scalp")}
            </Button>
            <Button
              size="sm"
              variant={autoPilotMode === "dca" ? "default" : "outline"}
              className="h-7 px-2 text-xs"
              onClick={() => onAutoPilotModeChange("dca")}
            >
              {t("DCA Strategy", "DCA стратеги")}
            </Button>
          </div>

          <div className="rounded-md border border-border/60 bg-background/60 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Link2 className="h-4 w-4 text-primary" />
                {t("Binance Connection", "Binance холболт")}
              </div>
              <Badge
                variant={
                  binanceConnection.connected
                    ? "default"
                    : binanceConnection.configured
                      ? "secondary"
                      : "destructive"
                }
              >
                {binanceConnection.connected
                  ? t("Connected", "Холбогдсон")
                  : binanceConnection.configured
                    ? t("Configured (check needed)", "Тохируулсан (шалгах)")
                    : t("Not configured", "Тохируулаагүй")}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => void onCheckBinanceConnection()}
                disabled={binanceConnection.checking}
              >
                {binanceConnection.checking
                  ? t("Checking...", "Шалгаж байна...")
                  : t("Check Binance API", "Binance API шалгах")}
              </Button>
              {binanceConnection.error && (
                <span className="text-xs text-destructive">
                  {binanceConnection.error}
                </span>
              )}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t(
              `Current profile: max allocation ${(copyProfileConfig.allocationCapPct * 100).toFixed(1)}%, max positions ${copyProfileConfig.maxOpenPositions}, entries governed by active scalping filters.`,
              `Одоогийн профайл: дээд allocation ${(copyProfileConfig.allocationCapPct * 100).toFixed(1)}%, дээд позиц ${copyProfileConfig.maxOpenPositions}, оролтууд идэвхтэй скальпинг шүүлтүүрээр удирдагдана.`,
            )}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {t("Execution speed", "Гүйцэтгэлийн хурд")}:
            </span>
            {[10, 15, 30].map((sec) => (
              <Button
                key={sec}
                size="sm"
                variant={autoTradeCadenceSec === sec ? "default" : "outline"}
                onClick={() => onCadenceChange(sec)}
                className="h-7 px-2 text-xs"
              >
                {sec}s
              </Button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
