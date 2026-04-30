"use client";

import { Settings } from "lucide-react";
import { AppLayout } from "@/components/layout/app-layout";
import { Slider } from "@/components/ui/slider";
import { useLanguage } from "@/components/language-provider";
import { useSettingsPageState } from "@/hooks/use-settings-page-state";
import {
  SaveActions,
  ScalpingPresetControls,
  SliderCard,
  ToggleCard,
} from "@/app/settings/_components/settings-sections";

export default function SettingsPage() {
  const { t } = useLanguage();
  const state = useSettingsPageState(t);

  return (
    <AppLayout>
      <div className="container mx-auto px-4 py-6 md:px-6 lg:py-8">
        <div className="mb-8">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-foreground md:text-3xl">
            <Settings className="h-7 w-7 text-primary" />
            {t("Settings", "Тохиргоо")}
          </h1>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <ToggleCard
            t={t}
            title="Notifications"
            titleMn="Мэдэгдэл"
            icon="bell"
            items={[
              {
                key: "price",
                label: "Price Alerts",
                labelMn: "Үнийн анхааруулга",
                value: state.notifications.priceAlerts,
                onChange: (checked) => {
                  state.setNotifications((prev) => ({ ...prev, priceAlerts: checked }));
                  state.markChanged();
                },
              },
              {
                key: "signal",
                label: "AI Signal Alerts",
                labelMn: "AI дохионы анхааруулга",
                value: state.notifications.signalAlerts,
                onChange: (checked) => {
                  state.setNotifications((prev) => ({ ...prev, signalAlerts: checked }));
                  state.markChanged();
                },
              },
              {
                key: "whale",
                label: "Whale Activity",
                labelMn: "Whale идэвх",
                value: state.notifications.whaleAlerts,
                onChange: (checked) => {
                  state.setNotifications((prev) => ({ ...prev, whaleAlerts: checked }));
                  state.markChanged();
                },
              },
              {
                key: "digest",
                label: "Daily Digest",
                labelMn: "Өдрийн тойм",
                value: state.notifications.dailyDigest,
                onChange: (checked) => {
                  state.setNotifications((prev) => ({ ...prev, dailyDigest: checked }));
                  state.markChanged();
                },
              },
            ]}
          />

          <ToggleCard
            t={t}
            title="Risk Management"
            titleMn="Эрсдэлийн удирдлага"
            icon="shield"
            items={[
              {
                key: "stop",
                label: "Stop-Loss Reminder",
                labelMn: "Stop-loss сануулга",
                value: state.riskSettings.stopLossReminder,
                onChange: (checked) => {
                  state.setRiskSettings((prev) => ({ ...prev, stopLossReminder: checked }));
                  state.markChanged();
                },
              },
              {
                key: "capital",
                label: "Capital Protection Mode",
                labelMn: "Капитал хамгаалах горим",
                value: state.riskSettings.capitalProtection,
                onChange: (checked) => {
                  state.setRiskSettings((prev) => ({ ...prev, capitalProtection: checked }));
                  state.markChanged();
                },
              },
            ]}
          />

          <SliderCard t={t} title="Scalping Filters" titleMn="Скальпинг шүүлтүүр" icon="brain">
            <ScalpingPresetControls
              t={t}
              scalpingSettings={state.scalpingSettings}
              setScalpingSettings={state.setScalpingSettings}
              markChanged={state.markChanged}
            />
          </SliderCard>

          <SliderCard t={t} title="Data Refresh" titleMn="Өгөгдөл шинэчлэх" icon="refresh">
            <p className="text-sm text-muted-foreground">
              {t("Refresh interval", "Шинэчлэх интервал")}: {state.refreshInterval[0]}s
            </p>
            <Slider
              value={state.refreshInterval}
              onValueChange={(v) => {
                state.setRefreshInterval(v);
                state.markChanged();
              }}
              min={30}
              max={300}
              step={30}
            />
          </SliderCard>
        </div>

        <SaveActions
          t={t}
          hasChanges={state.hasChanges}
          busy={state.saveBusy}
          onCancel={state.handleCancel}
          onSave={state.handleSave}
        />
      </div>
    </AppLayout>
  );
}
