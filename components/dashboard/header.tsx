"use client";

import { RefreshCw, Shield, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { MarketStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

interface HeaderProps {
  marketStatus: MarketStatus;
  lastUpdated: Date | null;
  isRefreshing: boolean;
  dataSource: "live" | "fallback";
  onRefresh: () => void;
}

export function Header({
  marketStatus,
  lastUpdated,
  isRefreshing,
  dataSource,
  onRefresh,
}: HeaderProps) {
  const statusColors: Record<MarketStatus, string> = {
    "Risk-On": "bg-success/20 text-success border-success/30",
    Neutral: "bg-muted text-muted-foreground border-border",
    "Risk-Off": "bg-destructive/20 text-destructive border-destructive/30",
  };

  const statusIcons: Record<MarketStatus, React.ReactNode> = {
    "Risk-On": <Activity className="h-3.5 w-3.5" />,
    Neutral: <Shield className="h-3.5 w-3.5" />,
    "Risk-Off": <Shield className="h-3.5 w-3.5" />,
  };

  return (
    <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-xl">
      <div className="flex items-center justify-between px-4 py-3 md:px-6">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 glow-teal">
              <Activity className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight text-foreground md:text-xl">
                NexTrade
              </h1>
              <p className="hidden text-xs text-muted-foreground md:block">
                Personal Mode
              </p>
            </div>
          </div>

          <Badge
            variant="outline"
            className={cn(
              "hidden items-center gap-1.5 border px-2.5 py-1 font-medium md:flex",
              statusColors[marketStatus],
            )}
          >
            {statusIcons[marketStatus]}
            {marketStatus}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          {dataSource === "fallback" && (
            <Badge
              variant="outline"
              className="border-warning/30 bg-warning/10 text-warning"
            >
              Demo Data
            </Badge>
          )}

          <div className="hidden text-right text-xs text-muted-foreground md:block">
            <p>Last updated</p>
            <p className="font-medium text-foreground">
              {lastUpdated
                ? lastUpdated.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "--:--"}
            </p>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isRefreshing}
            className="gap-2 border-border/50 bg-secondary/50 hover:bg-secondary"
          >
            <RefreshCw
              className={cn("h-4 w-4", isRefreshing && "animate-spin")}
            />
            <span className="hidden md:inline">Refresh</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
