"use client";

import Link from "next/link";
import useSWR from "swr";
import { AppLayout } from "@/components/layout/app-layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { WhaleTransaction } from "@/lib/types";
import { useLanguage } from "@/components/language-provider";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function WhalePage() {
  const { t } = useLanguage();
  const { data } = useSWR<{ whales?: WhaleTransaction[] }>("/api/whale", fetcher, {
    refreshInterval: 60000,
  });
  const whales = (data?.whales ?? []).slice(0, 10);

  return (
    <AppLayout>
      <div className="container mx-auto space-y-6 px-4 py-6 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{t("Whale Monitor", "Whale Хяналт")}</h1>
            <p className="text-sm text-muted-foreground">
              {t("Only the highest-impact transfers for AI context.", "AI контекстэд хэрэгтэй хамгийн нөлөөтэй гүйлгээнүүд л харагдана.")}
            </p>
          </div>
          <Badge variant="outline">{t("AI Focus", "AI Төвлөрөл")}</Badge>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{t("Latest High-Impact Activity", "Сүүлийн өндөр нөлөөтэй activity")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {whales.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("No whale data yet.", "Whale өгөгдөл алга байна.")}</p>
            ) : (
              whales.map((tx) => (
                <div key={tx.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <p className="font-medium">{tx.symbol}</p>
                    <Badge variant={tx.impact === "bullish" ? "default" : tx.impact === "bearish" ? "destructive" : "secondary"}>
                      {tx.impact}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    ${Math.round(tx.valueUsd).toLocaleString()} · {tx.type.replace("_", " ")}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Button asChild variant="outline">
          <Link href="/signals">{t("Go To Signals", "Дохио руу очих")}</Link>
        </Button>
      </div>
    </AppLayout>
  );
}
