"use client";

import type { User } from "@supabase/supabase-js";
import { Bell, Brain, Check, Download, LogIn, LogOut, Palette, RefreshCw, Shield, Trash2, UserRound } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { isSupabaseConfigured } from "@/lib/supabase";
import type { AppSettings } from "@/lib/trading/settings";

type TFn = (en: string, mn: string) => string;

export function AccountCard(props: {
  t: TFn;
  authUser: User | null;
  authEmail: string;
  authPassword: string;
  authLoading: boolean;
  setAuthEmail: (value: string) => void;
  setAuthPassword: (value: string) => void;
  handleAuthSubmit: (mode: "signin" | "signup") => Promise<void>;
  handleSignOut: () => Promise<void>;
}) {
  const { t, authUser, authEmail, authPassword, authLoading, setAuthEmail, setAuthPassword, handleAuthSubmit, handleSignOut } = props;
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm lg:col-span-2">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-primary" />{t("Supabase Account", "Supabase бүртгэл")}</CardTitle>
          <Badge variant={authUser ? "default" : "outline"}>{authUser ? t("Connected to account", "Дансанд холбогдсон") : t("Device mode", "Төхөөрөмжийн горим")}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {!isSupabaseConfigured ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-muted-foreground">
            {t("Supabase environment variables are missing.", "Supabase environment variable байхгүй байна.")}
          </div>
        ) : authUser ? (
          <div className="flex items-center justify-between">
            <p className="font-medium text-foreground">{authUser.email}</p>
            <Button variant="outline" onClick={() => void handleSignOut()} disabled={authLoading}>
              <LogOut className="mr-2 h-4 w-4" />{t("Sign Out", "Гарах")}
            </Button>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto_auto]">
            <Input type="email" placeholder="you@example.com" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} />
            <Input type="password" placeholder={t("Password", "Нууц үг")} value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} />
            <Button onClick={() => void handleAuthSubmit("signin")} disabled={authLoading}><LogIn className="mr-2 h-4 w-4" />{t("Sign In", "Нэвтрэх")}</Button>
            <Button variant="outline" onClick={() => void handleAuthSubmit("signup")} disabled={authLoading}>{t("Sign Up", "Бүртгүүлэх")}</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ToggleCard(props: {
  t: TFn;
  title: string;
  titleMn: string;
  icon: "bell" | "shield";
  items: Array<{ key: string; label: string; labelMn: string; value: boolean; onChange: (checked: boolean) => void }>;
}) {
  const Icon = props.icon === "bell" ? Bell : Shield;
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-primary" />{props.t(props.title, props.titleMn)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {props.items.map((item) => (
          <div key={item.key} className="flex items-center justify-between rounded-lg border border-border/50 p-3">
            <p className="text-sm font-medium text-foreground">{props.t(item.label, item.labelMn)}</p>
            <Switch checked={item.value} onCheckedChange={item.onChange} />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function SliderCard(props: {
  t: TFn;
  title: string;
  titleMn: string;
  icon: "brain" | "refresh";
  children: React.ReactNode;
}) {
  const Icon = props.icon === "brain" ? Brain : RefreshCw;
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-primary" />{props.t(props.title, props.titleMn)}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{props.children}</CardContent>
    </Card>
  );
}

export function DataManagementCard(props: {
  t: TFn;
  onExport: () => void;
  onResetDemo: () => void;
  onClearAll: () => void;
}) {
  const { t, onExport, onResetDemo, onClearAll } = props;
  return (
    <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Palette className="h-5 w-5 text-primary" />{t("Data Management", "Өгөгдлийн удирдлага")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button variant="outline" className="w-full justify-start" onClick={onExport}><Download className="mr-2 h-4 w-4" />{t("Export Trade History", "Арилжааны түүх экспортлох")}</Button>
        <Button variant="outline" className="w-full justify-start" onClick={onResetDemo}><RefreshCw className="mr-2 h-4 w-4" />{t("Reset Demo Account", "Демо данс сэргээх")}</Button>
        <Button variant="outline" className="w-full justify-start text-destructive hover:bg-destructive/10" onClick={onClearAll}><Trash2 className="mr-2 h-4 w-4" />{t("Clear All Local Data", "Локал өгөгдлийг цэвэрлэх")}</Button>
      </CardContent>
    </Card>
  );
}

export function SaveActions(props: {
  t: TFn;
  hasChanges: boolean;
  busy?: boolean;
  onCancel: () => void;
  onSave: () => void | Promise<void>;
}) {
  const { t, hasChanges, busy, onCancel, onSave } = props;
  return (
    <div className="mt-8 flex justify-end gap-4">
      <Button variant="outline" onClick={onCancel} disabled={!hasChanges || busy}>{t("Cancel", "Цуцлах")}</Button>
      <Button onClick={() => void onSave()} disabled={!hasChanges || busy}><Check className="mr-2 h-4 w-4" />{busy ? t("Saving…", "Хадгалж байна…") : t("Save Settings", "Тохиргоо хадгалах")}</Button>
    </div>
  );
}

export function ScalpingPresetControls(props: {
  t: TFn;
  scalpingSettings: AppSettings["scalping"];
  setScalpingSettings: (updater: (prev: AppSettings["scalping"]) => AppSettings["scalping"]) => void;
  markChanged: () => void;
}) {
  const { t, scalpingSettings, setScalpingSettings, markChanged } = props;
  return (
    <>
      <Select
        value={scalpingSettings.symbol}
        onValueChange={(value) => {
          setScalpingSettings((prev) => ({ ...prev, symbol: value }));
          markChanged();
        }}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="BTCUSDT">BTCUSDT</SelectItem>
          <SelectItem value="PEPEUSDT">PEPEUSDT</SelectItem>
          <SelectItem value="SOLUSDT">SOLUSDT</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={scalpingSettings.timeframe}
        onValueChange={(value) => {
          setScalpingSettings((prev) => ({ ...prev, timeframe: value as typeof prev.timeframe }));
          markChanged();
        }}
      >
        <SelectTrigger><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="1m">1m</SelectItem><SelectItem value="3m">3m</SelectItem><SelectItem value="5m">5m</SelectItem></SelectContent>
      </Select>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("Minimum AI confidence", "AI-ийн хамгийн бага итгэлцэл")} {scalpingSettings.minAiConfidence}%</p>
        <Slider value={[scalpingSettings.minAiConfidence]} onValueChange={(v) => { setScalpingSettings((prev) => ({ ...prev, minAiConfidence: v[0] })); markChanged(); }} min={50} max={95} step={1} />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("RSI buy zone (≤)", "RSI худалдан авах бүс (≤)")} {scalpingSettings.rsiBuyThreshold}</p>
        <Slider value={[scalpingSettings.rsiBuyThreshold]} onValueChange={(v) => { setScalpingSettings((prev) => ({ ...prev, rsiBuyThreshold: v[0] })); markChanged(); }} min={5} max={50} step={1} />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("RSI sell zone (≥)", "RSI зарах бүс (≥)")} {scalpingSettings.rsiSellThreshold}</p>
        <Slider value={[scalpingSettings.rsiSellThreshold]} onValueChange={(v) => { setScalpingSettings((prev) => ({ ...prev, rsiSellThreshold: v[0] })); markChanged(); }} min={50} max={99} step={1} />
      </div>
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">{t("Max open trades", "Нээлттэй арилжааны дээд хэмжээ")} {scalpingSettings.maxOpenTrades}</p>
        <Slider value={[scalpingSettings.maxOpenTrades]} onValueChange={(v) => { setScalpingSettings((prev) => ({ ...prev, maxOpenTrades: v[0] })); markChanged(); }} min={1} max={50} step={1} />
      </div>
    </>
  );
}
