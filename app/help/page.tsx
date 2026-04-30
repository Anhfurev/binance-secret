"use client";

import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/components/language-provider";

export default function HelpPage() {
  const { t } = useLanguage();

  return (
    <AppLayout>
      <div className="container mx-auto max-w-3xl space-y-6 px-4 py-6 md:px-6">
        <div>
          <h1 className="text-2xl font-bold">{t("Help: AI Logic", "Тусламж: AI Логик")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Only core explanations are kept.", "Зөвхөн үндсэн тайлбаруудыг үлдээлээ.")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("How AI decides", "AI хэрхэн шийддэг")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>1. {t("Collects signal, prediction, and whale context.", "Signal, таамаглал, whale контекст цуглуулна.")}</p>
            <p>2. {t("Scores confidence and risk.", "Итгэлцэл ба эрсдэлийг оноолж үнэлнэ.")}</p>
            <p>3. {t("Shows action with stop-loss discipline.", "Stop-loss сахилга баттай үйлдэл санал болгоно.")}</p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button asChild><Link href="/signals">{t("Open Signals", "Дохио нээх")}</Link></Button>
          <Button asChild variant="outline"><Link href="/optimizer">{t("Open Optimizer", "Оновчлол нээх")}</Link></Button>
        </div>
      </div>
    </AppLayout>
  );
}
