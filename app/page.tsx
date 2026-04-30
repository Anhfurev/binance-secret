"use client";

import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/components/language-provider";
import { useSignalsData, usePredictionsData, useWhaleActivity } from "@/hooks/use-dashboard-data";

export default function HomePage() {
  const { t } = useLanguage();
  const { signals } = useSignalsData();
  const { predictions } = usePredictionsData();
  const { transactions: whales } = useWhaleActivity();

  const activeSignals = signals.filter((s) => s.isActive !== false).length;
  const highConfidence = signals.filter((s) => s.confidence >= 80).length;

  return (
    <AppLayout>
      <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">{t("AI Trading Dashboard", "AI Арилжааны Самбар")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Only the main AI status is shown here.", "Энд зөвхөн AI-ийн гол төлөв харагдана.")}
            </p>
          </div>
          <Badge variant="outline">{t("Simplified", "Хялбаршуулсан")}</Badge>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <Card><CardHeader><CardTitle>{t("Active Signals", "Идэвхтэй дохио")}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{activeSignals}</p></CardContent></Card>
          <Card><CardHeader><CardTitle>{t("High Confidence", "Өндөр итгэлцэл")}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{highConfidence}</p></CardContent></Card>
          <Card><CardHeader><CardTitle>{t("Whale Alerts", "Whale alert")}</CardTitle></CardHeader><CardContent><p className="text-3xl font-bold">{whales.length}</p></CardContent></Card>
        </div>

        <Card>
          <CardHeader><CardTitle>{t("Quick Navigation", "Шуурхай шилжилт")}</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button asChild><Link href="/signals">{t("Signals", "Дохио")}</Link></Button>
            <Button asChild variant="outline"><Link href="/predictions">{t("Predictions", "Таамаглал")}</Link></Button>
            <Button asChild variant="outline"><Link href="/whale">{t("Whale", "Whale")}</Link></Button>
            <Button asChild variant="outline"><Link href="/optimizer">{t("Optimizer", "Оновчлол")}</Link></Button>
            <Button asChild variant="outline"><Link href="/settings">{t("Settings", "Тохиргоо")}</Link></Button>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          {t("Predictions loaded", "Таамаглал ачаалсан")}: {predictions.length}
        </p>
      </div>
    </AppLayout>
  );
}
