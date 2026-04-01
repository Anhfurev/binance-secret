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
import {
  CheckCircle2,
  XCircle,
  Minus,
  ShieldAlert,
  StickyNote,
} from "lucide-react";
import type { DemoTrade } from "@/lib/types";

interface TradeHistoryTableProps {
  history: DemoTrade[];
  onJournalOpen: (trade: DemoTrade) => void;
  formatDate: (date: Date) => string;
  formatPrice: (price: number) => string;
}

export function TradeHistoryTable({
  history,
  onJournalOpen,
  formatDate,
  formatPrice,
}: TradeHistoryTableProps) {
  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-border/50 hover:bg-transparent">
            <TableHead>Asset</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Entry / Exit</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>P&L</TableHead>
            <TableHead>Result</TableHead>
            <TableHead>Date</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {history.map((trade) => (
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
                      AI
                    </Badge>
                  )}
                  {trade.notes && (
                    <StickyNote className="h-3 w-3 text-muted-foreground" />
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
              <TableCell className="font-mono">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">
                    {formatPrice(trade.entryPrice)}
                  </span>
                  <span className="text-foreground">
                    {formatPrice(trade.exitPrice ?? 0)}
                  </span>
                </div>
              </TableCell>
              <TableCell className="font-mono text-muted-foreground">
                {formatPrice(trade.value)}
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
                {trade.status === "closed" && (trade.pnl ?? 0) >= 0 && (
                  <Badge className="bg-success/20 text-success">
                    <CheckCircle2 className="mr-1 h-3 w-3" />
                    Win
                  </Badge>
                )}
                {trade.status === "closed" && (trade.pnl ?? 0) < 0 && (
                  <Badge className="bg-destructive/20 text-destructive">
                    <XCircle className="mr-1 h-3 w-3" />
                    Loss
                  </Badge>
                )}
                {trade.status === "stopped" && (
                  <Badge className="bg-warning/20 text-warning">
                    <Minus className="mr-1 h-3 w-3" />
                    Stopped
                  </Badge>
                )}
                {trade.status === "liquidated" && (
                  <Badge className="bg-destructive/30 text-destructive">
                    <ShieldAlert className="mr-1 h-3 w-3" />
                    Liquidated
                  </Badge>
                )}
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  <span className="text-xs text-muted-foreground">
                    {formatDate(trade.closedAt ?? trade.openedAt)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => onJournalOpen(trade)}
                    title="Add/edit note"
                  >
                    <StickyNote
                      className={cn(
                        "h-3 w-3",
                        trade.notes
                          ? "text-warning"
                          : "text-muted-foreground/40",
                      )}
                    />
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
