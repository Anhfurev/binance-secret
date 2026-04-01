"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { X, StickyNote, Activity, Plus } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import { useRouter } from "next/navigation";
import type { DemoTrade } from "@/lib/types";

interface OpenPositionsTableProps {
  positions: DemoTrade[];
  onClose: (trade: DemoTrade) => void;
  onJournalOpen: (trade: DemoTrade) => void;
  formatDate: (date: Date) => string;
  formatPrice: (price: number) => string;
}

export function OpenPositionsTable({
  positions,
  onClose,
  onJournalOpen,
  formatDate: _formatDate,
  formatPrice,
}: OpenPositionsTableProps) {
  const { t } = useLanguage();
  const router = useRouter();

  if (positions.length === 0) {
    return (
      <div className="py-12 text-center">
        <Activity className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-4 text-lg font-medium text-foreground">
          No open positions
        </p>
        <p className="text-muted-foreground">
          {t(
            "Go to AI Signals to start trading",
            "AI Signals руу орж арилжаагаа эхэл",
          )}
        </p>
        <Button className="mt-4" onClick={() => router.push("/signals")}>
          <Plus className="mr-2 h-4 w-4" />
          {t("View Signals", "Сигналуудыг харах")}
        </Button>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead>Asset</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>P&L</TableHead>
            <TableHead>Stop / Target</TableHead>
            <TableHead>Action</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.map((trade) => (
            <TableRow key={trade.id} className="border-border/50">
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-foreground">
                    {trade.symbol}
                  </span>
                  {trade.isFutures && (
                    <Badge
                      variant="outline"
                      className="text-[10px] border-warning text-warning"
                    >
                      {trade.direction} {trade.leverage}x
                    </Badge>
                  )}
                  {trade.followedSignal && (
                    <Badge variant="outline" className="text-[10px]">
                      AI Signal
                    </Badge>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <Badge
                  className={cn(
                    "text-xs",
                    trade.isFutures
                      ? trade.direction === "LONG"
                        ? "bg-success/20 text-success"
                        : "bg-destructive/20 text-destructive"
                      : trade.type === "buy"
                        ? "bg-success/20 text-success"
                        : "bg-destructive/20 text-destructive",
                  )}
                >
                  {trade.isFutures ? trade.direction : trade.type.toUpperCase()}
                </Badge>
              </TableCell>
              <TableCell className="font-mono text-foreground">
                <div className="flex flex-col">
                  <span>{formatPrice(trade.entryPrice)}</span>
                  {trade.isFutures && trade.liquidationPrice && (
                    <span className="text-[10px] text-destructive">
                      Liq: {formatPrice(trade.liquidationPrice)}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">
                <div className="flex flex-col">
                  <span>{formatPrice(trade.value)}</span>
                  {trade.isFutures && trade.marginUsed && (
                    <span className="text-[10px] text-muted-foreground">
                      Margin: {formatPrice(trade.marginUsed)}
                    </span>
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div
                  className={cn(
                    "font-mono font-bold",
                    (trade.pnl ?? 0) >= 0 ? "text-success" : "text-destructive",
                  )}
                >
                  {(trade.pnl ?? 0) >= 0 ? "+" : ""}
                  {formatPrice(trade.pnl ?? 0)}
                  <span className="ml-1 text-xs">
                    ({(trade.pnlPercent ?? 0) >= 0 ? "+" : ""}
                    {trade.pnlPercent?.toFixed(2)}%)
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-destructive">
                    SL: {formatPrice(trade.stopLoss)}
                  </span>
                  <span className="text-xs text-success">
                    TP: {formatPrice(trade.takeProfit)}
                  </span>
                </div>
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onClose(trade)}
                  >
                    <X className="mr-1 h-3 w-3" />
                    Close
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onJournalOpen(trade)}
                    title="Add note"
                  >
                    <StickyNote className="h-3 w-3" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
