"use client";

import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePredictionsData } from "@/hooks/use-dashboard-data";
import { useLanguage } from "@/components/language-provider";

export default function PredictionsPage() {
  const { t } = useLanguage();
  const { predictions, isLoading } = usePredictionsData();
  const top = [...predictions].slice(0, 10);

  return (
    <AppLayout>
      <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
        <div>
          <h1 className="text-2xl font-bold">{t("AI Predictions", "AI Таамаглал")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Minimal prediction feed for decision support.", "Шийдвэр дэмжих хялбар таамаглалын feed.")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Latest Model Output", "Сүүлийн загварын үр дүн")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{t("Loading...", "Ачааллаж байна...")}</p>
            ) : top.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No predictions available.", "Таамаглал алга байна.")}</p>
            ) : (
              top.map((item) => {
                const day = item.predictions.find((p) => p.timeframe === "24h") ?? item.predictions[0];
                return (
                  <div key={item.coinId} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{item.symbol}</p>
                      <Badge>{day?.confidence ?? 0}%</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      24h: {day?.direction ?? "sideways"} · {day?.percentChange?.toFixed(2) ?? "0.00"}%
                    </p>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
