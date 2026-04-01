"use client";

import { Shield, AlertTriangle, Target, TrendingDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import type { RiskControls } from "@/lib/types";
import { cn } from "@/lib/utils";

interface RiskControlsProps {
  controls: RiskControls;
  onUpdate: (controls: RiskControls) => void;
}

export function RiskControlsCard({ controls, onUpdate }: RiskControlsProps) {
  return (
    <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Shield className="h-4 w-4 text-primary" />
            Risk Controls
          </CardTitle>
          <Badge
            variant="outline"
            className="text-xs border-warning/30 bg-warning/10 text-warning"
          >
            <AlertTriangle className="mr-1 h-3 w-3" />
            Safety
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Max Position Size */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Max Position Size</span>
            </div>
            <span className="text-sm font-semibold text-primary">
              {controls.maxPositionSize}%
            </span>
          </div>
          <Slider
            value={[controls.maxPositionSize]}
            onValueChange={([value]) =>
              onUpdate({ ...controls, maxPositionSize: value })
            }
            max={50}
            min={5}
            step={5}
            className="[&>span:first-child]:bg-secondary [&>span:first-child>span]:bg-primary"
          />
          <p className="text-xs text-muted-foreground">
            Suggested: Never put more than {controls.maxPositionSize}% of
            portfolio in a single position
          </p>
        </div>

        {/* Max Daily Loss */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Max Daily Loss</span>
            </div>
            <span className="text-sm font-semibold text-destructive">
              -{controls.maxDailyLoss}%
            </span>
          </div>
          <Slider
            value={[controls.maxDailyLoss]}
            onValueChange={([value]) =>
              onUpdate({ ...controls, maxDailyLoss: value })
            }
            max={20}
            min={2}
            step={1}
            className="[&>span:first-child]:bg-secondary [&>span:first-child>span]:bg-destructive"
          />
          <p className="text-xs text-muted-foreground">
            Consider stepping back if losses exceed {controls.maxDailyLoss}% in
            a day
          </p>
        </div>

        {/* Stop Loss Reminder */}
        <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/30 p-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-warning" />
            <div>
              <p className="text-sm font-medium">Stop-Loss Reminder</p>
              <p className="text-xs text-muted-foreground">
                Alert when no stop-loss is set
              </p>
            </div>
          </div>
          <Switch
            checked={controls.stopLossReminder}
            onCheckedChange={(checked) =>
              onUpdate({ ...controls, stopLossReminder: checked })
            }
          />
        </div>

        {/* Disclaimer */}
        <div className="rounded-xl border border-warning/20 bg-warning/5 p-3">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-warning">
                Not Financial Advice
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                NexTrade provides suggestions for educational purposes only.
                Always do your own research and never invest more than you can
                afford to lose. Past performance does not guarantee future
                results.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
