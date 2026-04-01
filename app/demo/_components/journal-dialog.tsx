"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { StickyNote } from "lucide-react";
import { useLanguage } from "@/components/language-provider";
import type { DemoTrade } from "@/lib/types";

interface JournalDialogProps {
  trade: DemoTrade | null;
  note: string;
  setNote: (note: string) => void;
  onSave: () => void;
  onClose: () => void;
}

export function JournalDialog({
  trade,
  note,
  setNote,
  onSave,
  onClose,
}: JournalDialogProps) {
  const { t } = useLanguage();

  return (
    <Dialog
      open={trade !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <StickyNote className="h-4 w-4" />
            {trade?.symbol
              ? `${trade.symbol} — ${t("Journal Note", "Тэмдэглэл")}`
              : t("Trade Journal Note", "Арилжааны тэмдэглэл")}
          </DialogTitle>
          <DialogDescription>
            {t(
              "Add notes about your trading decision, market conditions, or lessons learned.",
              "Арилжааны шийдвэр, зах зээлийн нөхцөл, сурсан зүйлсийнхээ тухай тэмдэглэл нэмнэ үү.",
            )}
          </DialogDescription>
        </DialogHeader>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t(
            "Why did I take this trade? What were the signals?",
            "Яагаад энэ арилжааг хийсэн бэ? Ямар дохио байсан бэ?",
          )}
          className="min-h-30"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("Cancel", "Цуцлах")}
          </Button>
          <Button onClick={onSave}>
            <StickyNote className="mr-2 h-4 w-4" />
            {t("Save Note", "Хадгалах")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
