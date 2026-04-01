"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { DollarSign } from "lucide-react";
import { useLanguage } from "@/components/language-provider";

interface DepositDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  depositAmount: string;
  setDepositAmount: (v: string) => void;
  onDeposit: () => void;
  currentBalance: number;
}

export function DepositDialog({
  open,
  onOpenChange,
  depositAmount,
  setDepositAmount,
  onDeposit,
  currentBalance,
}: DepositDialogProps) {
  const { t } = useLanguage();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5 text-success" />
            {t("Add Funds to Demo Account", "Демо данс цэнэглэх")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Add virtual money to practice trading with larger positions.",
              "Том позицд дадлага хийхийн тулд виртуал мөнгө нэмнэ үү.",
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-4 gap-2">
            {[1000, 5000, 10000, 25000].map((amt) => (
              <Button
                key={amt}
                variant={depositAmount === String(amt) ? "default" : "outline"}
                size="sm"
                onClick={() => setDepositAmount(String(amt))}
              >
                {`${(amt / 1000).toFixed(0)}K`}
              </Button>
            ))}
          </div>
          <Input
            type="number"
            placeholder={t(
              "Or enter custom amount...",
              "Эсвэл дүнгээ оруул...",
            )}
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            min={1}
            max={1000000}
          />
          {depositAmount && parseFloat(depositAmount) > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("New balance will be", "Шинэ үлдэгдэл")}:{" "}
              <span className="font-bold text-foreground">
                $
                {(
                  currentBalance + parseFloat(depositAmount || "0")
                ).toLocaleString()}
              </span>
            </p>
          )}
        </div>
        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setDepositAmount("");
            }}
          >
            {t("Cancel", "Цуцлах")}
          </Button>
          <Button
            onClick={onDeposit}
            disabled={!depositAmount || parseFloat(depositAmount) <= 0}
            className="bg-success hover:bg-success/90 text-success-foreground"
          >
            <DollarSign className="mr-2 h-4 w-4" />
            {t("Add Funds", "Нэмэх")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
