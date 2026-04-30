import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { BookOpen, XCircle } from "lucide-react";

interface OpenPositionsTableProps {
  positions: any[];
  onClose: (trade: any) => void;
  onJournalOpen: (trade: any) => void;
  formatDate: (date: Date) => string;
  formatPrice: (price: number) => string;
}

export function OpenPositionsTable({
  positions,
  onClose,
  onJournalOpen,
  formatDate,
  formatPrice,
}: OpenPositionsTableProps) {
  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Asset</TableHead>
            <TableHead>Entry</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>PnL</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {positions.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={5}
                className="text-center py-10 text-muted-foreground"
              >
                No active trades
              </TableCell>
            </TableRow>
          ) : (
            positions.map((trade) => (
              <TableRow key={trade.id}>
                <TableCell className="font-medium">{trade.symbol}</TableCell>
                <TableCell>{formatPrice(trade.entryPrice)}</TableCell>
                <TableCell>{trade.amount}</TableCell>
                <TableCell
                  className={trade.pnl >= 0 ? "text-green-500" : "text-red-500"}
                >
                  {trade.pnl >= 0 ? "+" : ""}
                  {formatPrice(trade.pnl)}
                </TableCell>
                <TableCell className="text-right space-x-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onJournalOpen(trade)}
                  >
                    <BookOpen className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-red-500"
                    onClick={() => onClose(trade)}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
