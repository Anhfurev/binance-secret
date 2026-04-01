"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldAlert } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

const MAX_DAILY_LOSS_PERCENT = 5;

interface CircuitBreakerAlertProps {
  dailyLossPercent: number;
  dailyPnl: number;
  onReset: () => void;
}

export function CircuitBreakerAlert({
  dailyLossPercent,
  dailyPnl,
  onReset,
}: CircuitBreakerAlertProps) {
  const { t } = useLanguage();

  return (
    <Card className="mb-6 border-destructive/50 bg-destructive/10">
      <CardContent className="py-4">
        <div className="flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 shrink-0 text-destructive" />
          <div className="flex-1">
            <p className="font-bold text-destructive">
              {t("Circuit Breaker Active", "Хамгаалалтын систем идэвхтэй")}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                `Daily loss exceeded ${MAX_DAILY_LOSS_PERCENT}% of starting balance. Futures trading is halted. Daily P&L: $${dailyPnl.toFixed(2)}`,
                `Өнөөдрийн алдагдал ${MAX_DAILY_LOSS_PERCENT}%-аас давлаа. Маргаашийг хүртэл фьючерс арилжаа зогссон.`,
              )}
            </p>
          </div>
          <Badge variant="destructive" className="shrink-0">
            -{dailyLossPercent.toFixed(1)}%
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 border-destructive/50 text-destructive hover:bg-destructive/10"
            onClick={onReset}
          >
            {t("Reset", "Арилгах")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
