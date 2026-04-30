"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type TechnicalPulseItem = {
  id: string;
  createdAt: string;
  symbol: string;
  techScore: number | null;
  rsi: number | null;
  aiConfidence: number | null;
  note: string;
};

interface TechnicalPulseCardProps {
  traces: TechnicalPulseItem[];
}

function formatValue(value: number | null, digits = 0) {
  if (value === null || Number.isNaN(value)) return "--";
  return value.toFixed(digits);
}

function formatTime(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "--";
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function isNearBuy(trace: TechnicalPulseItem) {
  return (
    trace.techScore !== null &&
    trace.aiConfidence !== null &&
    trace.techScore >= 6 &&
    trace.aiConfidence >= 70
  );
}

function isWarmConfidence(aiConfidence: number | null) {
  return aiConfidence !== null && aiConfidence > 60;
}

export function TechnicalPulseCard({ traces }: TechnicalPulseCardProps) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div>
          <p className="text-sm font-semibold">Technical Pulse</p>
          <p className="text-[11px] text-muted-foreground">
            Latest model diagnostics before potential entries.
          </p>
        </div>

        {traces.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No technical traces yet.
          </p>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Time</TableHead>
                <TableHead>Symbol</TableHead>
                <TableHead className="text-right">Tech Score</TableHead>
                <TableHead className="text-right">RSI</TableHead>
                <TableHead className="text-right">AI Conf</TableHead>
                <TableHead>Note</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {traces.map((trace) => (
                <TableRow key={trace.id}>
                  <TableCell>{formatTime(trace.createdAt)}</TableCell>
                  <TableCell className="font-medium">{trace.symbol}</TableCell>
                  <TableCell className="text-right">
                    {formatValue(trace.techScore)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatValue(trace.rsi, 1)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <span
                        className={
                          isWarmConfidence(trace.aiConfidence) ? "text-warning" : ""
                        }
                      >
                        {trace.aiConfidence === null
                          ? "--"
                          : `${Math.round(trace.aiConfidence)}%`}
                      </span>
                      {isNearBuy(trace) ? (
                        <Badge
                          variant="secondary"
                          className="h-5 rounded-full px-2 text-[10px]"
                        >
                          Near Buy
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[210px] truncate text-muted-foreground">
                    {trace.note || "--"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
