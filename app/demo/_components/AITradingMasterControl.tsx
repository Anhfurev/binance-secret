import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Brain, Cloud, Activity } from "lucide-react";

interface AITradingMasterControlProps {
  demoAutoPilot: boolean;
  onToggleAutoPilot: (val: boolean) => void;
  currentBalance: number;
  walletMode: "demo" | "real";
  cloudSyncState: "synced" | "syncing" | "local" | "error" | "disabled";
  // Adding the missing defaults to satisfy the type
  autoPilotMode?: string;
  onAutoPilotModeChange?: (val: any) => void;
  executableSignalsCount?: number;
  openPositionsCount?: number;
}

export function AITradingMasterControl({
  demoAutoPilot,
  onToggleAutoPilot,
  currentBalance,
  walletMode,
  cloudSyncState,
}: AITradingMasterControlProps) {
  return (
    <Card className="border-primary/20 bg-card/50 backdrop-blur-md">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="space-y-1">
          <CardTitle className="text-xl flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            AI Command Center
          </CardTitle>
        </div>
        <div className="flex items-center gap-4">
          <Badge
            variant={cloudSyncState === "synced" ? "default" : "outline"}
            className="gap-1"
          >
            <Cloud className="h-3 w-3" /> {cloudSyncState}
          </Badge>
          <Switch checked={demoAutoPilot} onCheckedChange={onToggleAutoPilot} />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Activity className="h-4 w-4" />
            System Status:{" "}
            <span className="text-foreground font-medium">
              {demoAutoPilot ? "Active" : "Standby"}
            </span>
          </div>
          <div className="font-mono text-primary">
            Available: ${currentBalance.toLocaleString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
