"use client";

import { Save, SlidersHorizontal, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { SavedCustomStrategy } from "@/lib/trading/custom-strategy";
import type { BuilderConfig, RiskProfile, StopLossMode } from "./types";

interface StrategyBuilderCardProps {
  t: (en: string, mn: string) => string;
  builder: BuilderConfig;
  marketOptions: string[];
  builderRuleSummary: string[];
  savedStrategies: SavedCustomStrategy[];
  activeStrategyId: string | null;
  onUpdateBuilder: (patch: Partial<BuilderConfig>) => void;
  onSaveCustomStrategy: () => void;
  onSetActiveStrategy: (strategyId: string | null) => void;
}

export function StrategyBuilderCard({
  t,
  builder,
  marketOptions,
  builderRuleSummary,
  savedStrategies,
  activeStrategyId,
  onUpdateBuilder,
  onSaveCustomStrategy,
  onSetActiveStrategy,
}: StrategyBuilderCardProps) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/70 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">{t("Strategy Builder", "Стратеги бүтээгч")}</p>
        </div>
        <Badge variant="outline" className="text-[10px]">{t("No coding required", "Код бичих шаардлагагүй")}</Badge>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="space-y-3">
          <Input
            value={builder.name}
            onChange={(event) => onUpdateBuilder({ name: event.target.value })}
            placeholder={t("e.g. ETH Momentum Breakout", "ж. ETH Моментум Тасалт")}
          />
          <Select value={builder.market} onValueChange={(value) => onUpdateBuilder({ market: value })}>
            <SelectTrigger className="w-full"><SelectValue placeholder={t("Select market", "Зах сонгох")} /></SelectTrigger>
            <SelectContent>
              {marketOptions.map((market) => (
                <SelectItem key={market} value={market}>{market === "any" ? t("Any market", "Бүх зах") : market}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t("Minimum confidence", "Хамгийн бага итгэлцэл")}</span>
              <span>{builder.minSignalConfidence}%</span>
            </div>
            <Slider value={[builder.minSignalConfidence]} onValueChange={([value]) => onUpdateBuilder({ minSignalConfidence: value })} max={95} min={40} step={1} />
            <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex items-center gap-2 text-muted-foreground">
                <Checkbox checked={builder.allowLong} onCheckedChange={(checked) => onUpdateBuilder({ allowLong: checked === true })} />
                LONG
              </label>
              <label className="flex items-center gap-2 text-muted-foreground">
                <Checkbox checked={builder.allowShort} onCheckedChange={(checked) => onUpdateBuilder({ allowShort: checked === true })} />
                SHORT
              </label>
            </div>
          </div>

          <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <label className="flex items-center gap-2 text-muted-foreground"><Checkbox checked={builder.useRsi} onCheckedChange={(checked) => onUpdateBuilder({ useRsi: checked === true })} />RSI</label>
              <label className="flex items-center gap-2 text-muted-foreground"><Checkbox checked={builder.useMacd} onCheckedChange={(checked) => onUpdateBuilder({ useMacd: checked === true })} />MACD</label>
              <label className="flex items-center gap-2 text-muted-foreground"><Checkbox checked={builder.useMovingAverage} onCheckedChange={(checked) => onUpdateBuilder({ useMovingAverage: checked === true })} />MA Trend</label>
              <label className="flex items-center gap-2 text-muted-foreground"><Checkbox checked={builder.useVolumeSpike} onCheckedChange={(checked) => onUpdateBuilder({ useVolumeSpike: checked === true })} />Volume Spike</label>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
            <Select value={builder.riskProfile} onValueChange={(value) => onUpdateBuilder({ riskProfile: value as RiskProfile })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="conservative">{t("Conservative", "Болгоомжтой")}</SelectItem>
                <SelectItem value="balanced">{t("Balanced", "Тэнцвэртэй")}</SelectItem>
                <SelectItem value="aggressive">{t("Aggressive", "Идэвхтэй")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{t("Max position size", "Нэг позицийн дээд хэмжээ")}</span><span>{builder.maxPositionSize}%</span></div>
            <Slider value={[builder.maxPositionSize]} onValueChange={([value]) => onUpdateBuilder({ maxPositionSize: value })} max={35} min={3} step={1} />
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{t("Max daily loss", "Өдрийн алдагдлын дээд хэмжээ")}</span><span>{builder.maxDailyLoss}%</span></div>
            <Slider value={[builder.maxDailyLoss]} onValueChange={([value]) => onUpdateBuilder({ maxDailyLoss: value })} max={15} min={1} step={1} />
          </div>

          <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
            <Select value={builder.stopLossMode} onValueChange={(value) => onUpdateBuilder({ stopLossMode: value as StopLossMode })}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">{t("Fixed percent", "Тогтмол хувь")}</SelectItem>
                <SelectItem value="dynamic">{t("Dynamic by volatility", "Хэлбэлзлээр динамик")}</SelectItem>
              </SelectContent>
            </Select>
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{t("Stop loss", "Stop loss")}</span><span>{builder.stopLossPct.toFixed(1)}%</span></div>
            <Slider value={[builder.stopLossPct]} onValueChange={([value]) => onUpdateBuilder({ stopLossPct: Number(value.toFixed(1)) })} max={12} min={0.5} step={0.1} />
            <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground"><span>{t("Take profit", "Take profit")}</span><span>{builder.takeProfitPct.toFixed(1)}%</span></div>
            <Slider value={[builder.takeProfitPct]} onValueChange={([value]) => onUpdateBuilder({ takeProfitPct: Number(value.toFixed(1)) })} max={25} min={1} step={0.1} />
            <div className="mt-2 flex items-center justify-between rounded-md border border-border/60 bg-background/60 p-2">
              <span className="text-[11px] text-muted-foreground">{t("Enable trailing stop", "Trailing stop идэвхжүүлэх")}</span>
              <Switch checked={builder.useTrailingStop} onCheckedChange={(checked) => onUpdateBuilder({ useTrailingStop: checked })} />
            </div>
          </div>

          <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <p className="text-[11px] font-medium text-foreground">{t("Generated Strategy Logic", "Үүсгэсэн стратегийн логик")}</p>
            </div>
            <div className="mt-2 space-y-1">
              {builderRuleSummary.map((line, index) => (
                <p key={`builder-line-${index}`} className="text-[11px] text-muted-foreground">{index + 1}. {line}</p>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] text-muted-foreground">{t("Strategies are saved locally to your browser.", "Стратеги таны browser-д локал хадгалагдана.")}</p>
            <Button size="sm" className="h-8 gap-1" disabled={!builder.name.trim() || (!builder.allowLong && !builder.allowShort)} onClick={onSaveCustomStrategy}>
              <Save className="h-3.5 w-3.5" />
              {t("Save Strategy", "Стратеги хадгалах")}
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-3">
        <p className="mb-2 text-[11px] font-medium text-muted-foreground">{t("Your Custom Strategies", "Таны өөрийн стратегиуд")} ({savedStrategies.length})</p>
        {savedStrategies.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">{t("No custom strategy yet. Configure and save your first one.", "Одоогоор custom стратеги алга. Анхны стратегиа тохируулаад хадгална уу.")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {savedStrategies.map((entry) => (
              <div key={entry.id} className="rounded-md border border-border/60 bg-background/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="line-clamp-1 text-xs font-semibold text-foreground">{entry.config.name}</p>
                  <Badge variant="outline" className="text-[9px]">{entry.config.market === "any" ? t("Any", "Бүх") : entry.config.market}</Badge>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{t("AI >=", "AI >=")} {entry.config.minSignalConfidence}% · {t("SL", "SL")} {entry.config.stopLossPct.toFixed(1)}% · {t("TP", "TP")} {entry.config.takeProfitPct.toFixed(1)}%</p>
                <div className="mt-2">
                  <Button size="sm" variant={activeStrategyId === entry.id ? "default" : "outline"} className="h-7 text-[10px]" onClick={() => onSetActiveStrategy(activeStrategyId === entry.id ? null : entry.id)}>
                    {activeStrategyId === entry.id ? t("Active for AI Trading", "AI арилжаанд идэвхтэй") : t("Use For AI Trading", "AI арилжаанд ашиглах")}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
