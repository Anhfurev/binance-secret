"use client";

import Link from "next/link";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useLanguage } from "@/components/language-provider";
import { useState } from "react";

export default function OptimizerPage() {
  const { t } = useLanguage();
  const [minConfidence, setMinConfidence] = useState([70]);
  const [maxRisk, setMaxRisk] = useState([6]);
  const [autoApply, setAutoApply] = useState(false);

  return (
    <AppLayout>
      <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{t("AI Optimizer", "AI Оновчлол")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Tune only what affects AI decisions.", "AI шийдвэрт нөлөөлөх үндсэн зүйлсийг л тохируулна.")}
            </p>
          </div>
          <Badge variant="outline">{t("Simplified", "Хялбаршуулсан")}</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Core AI Rules", "AI гол дүрэм")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{t("Minimum signal confidence", "Хамгийн бага дохионы итгэлцэл")}</span>
                <span>{minConfidence[0]}%</span>
              </div>
              <Slider value={minConfidence} onValueChange={setMinConfidence} min={40} max={95} step={1} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span>{t("Max risk per position", "Нэг байрлалын дээд эрсдэл")}</span>
                <span>{maxRisk[0]}%</span>
              </div>
              <Slider value={maxRisk} onValueChange={setMaxRisk} min={1} max={15} step={1} />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="text-sm font-medium">{t("Auto apply best setup", "Хамгийн сайн setup-г автоматаар хэрэгжүүлэх")}</p>
                <p className="text-xs text-muted-foreground">{t("Demo mode only recommended.", "Зөвхөн демо горимд зөвлөж байна.")}</p>
              </div>
              <Switch checked={autoApply} onCheckedChange={setAutoApply} />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/signals">{t("Open Signals", "Дохио нээх")}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/settings">{t("Open Settings", "Тохиргоо нээх")}</Link>
          </Button>
        </div>
      </div>
    </AppLayout>
  );
}
