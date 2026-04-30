"use client";

import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useSignalsData } from "@/hooks/use-dashboard-data";
import { useLanguage } from "@/components/language-provider";

export default function SignalsPage() {
  const { t } = useLanguage();
  const { signals, isLoading, refresh } = useSignalsData();
  const topSignals = [...signals]
    .filter((s) => s.isActive !== false)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);

  return (
    <AppLayout>
      <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("AI Signals", "AI Дохио")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Simplified signal view: confidence first.", "Хялбаршуулсан дохио: итгэлцлээр эхэлнэ.")}
            </p>
          </div>
          <Button variant="outline" onClick={refresh} disabled={isLoading}>
            {t("Refresh", "Шинэчлэх")}
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Top Active Signals", "Идэвхтэй топ дохионууд")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topSignals.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No signals available.", "Дохио алга байна.")}</p>
            ) : (
              topSignals.map((signal) => (
                <div key={signal.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium">{signal.symbol} {signal.signalType}</p>
                    <Badge>{signal.confidence}%</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Entry {signal.entryPrice} · SL {signal.stopLoss} · TP {signal.takeProfits[0]?.price ?? "-"}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <div className="flex gap-2">
          <Button asChild>
            <Link href="/optimizer">{t("Open Optimizer", "Optimizer нээх")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/">{t("Back Dashboard", "Dashboard руу буцах")}</Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
