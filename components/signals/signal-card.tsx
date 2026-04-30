"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AITradeSignal } from "@/lib/types";
import { useLanguage } from "@/components/language-provider";

interface SignalCardProps {
  signal: AITradeSignal;
  onTrade?: (signal: AITradeSignal, action: "execute" | "demo") => void;
  isBought?: boolean;
  recentAction?: "demo" | "execute" | null;
}

function formatPrice(value: number) {
  if (value >= 1000) return `$${value.toLocaleString()}`;
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function SignalCard({
  signal,
  onTrade,
  isBought = false,
  recentAction = null,
}: SignalCardProps) {
  const { t } = useLanguage();
  const direction = signal.signalType.includes("BUY")
    ? "BUY"
    : signal.signalType.includes("SELL")
      ? "SELL"
      : "HOLD";
  const tp = signal.takeProfits[0]?.price ?? signal.entryPrice;

  const askAiToExplainSignal = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent("nextrade:chat-ask", {
        detail: {
          prompt: `Explain signal ${signal.id} for ${signal.symbol} ${signal.signalType} in simple terms`,
        },
      }),
    );
  };

  return (
    <Card className="border-l-4 border-l-primary/50 bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-lg font-bold">
              {signal.symbol} <span className="text-sm text-muted-foreground">{signal.name}</span>
            </p>
            <p className="text-xl font-bold">{formatPrice(signal.currentPrice)}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge>{direction}</Badge>
            <Badge variant="outline">{signal.confidence}%</Badge>
            {isBought && <Badge variant="secondary">{t("Bought", "Худалдаж авсан")}</Badge>}
            {recentAction && <Badge variant="secondary">{recentAction}</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded border p-2">
            <p className="text-xs text-muted-foreground">{t("Entry", "Оролт")}</p>
            <p className="font-mono">{formatPrice(signal.entryPrice)}</p>
          </div>
          <div className="rounded border p-2">
            <p className="text-xs text-muted-foreground">{t("Stop", "Stop")}</p>
            <p className="font-mono">{formatPrice(signal.stopLoss)}</p>
          </div>
          <div className="rounded border p-2">
            <p className="text-xs text-muted-foreground">{t("TP", "TP")}</p>
            <p className="font-mono">{formatPrice(tp)}</p>
          </div>
        </div>

        <div className="rounded border p-2">
          <p className="text-xs text-muted-foreground">{t("AI Reason", "AI шалтгаан")}</p>
          <p className="text-sm">{signal.reasoning[0] ?? "-"}</p>
        </div>

        <div className="flex gap-2">
          <Button className="flex-1" variant="outline" onClick={() => onTrade?.(signal, "demo")}>
            {t("Demo", "Демо")}
          </Button>
          <Button className="flex-1" onClick={() => onTrade?.(signal, "execute")}>
            {t("Execute", "Гүйцэтгэх")}
          </Button>
        </div>
        <Button className="w-full" variant="ghost" onClick={askAiToExplainSignal}>
          {t("Ask AI", "AI-аас асуух")}
        </Button>
      </CardContent>
    </Card>
  );
}
