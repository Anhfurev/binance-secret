"use client";

import { cn } from "@/lib/utils";
import {
  isHighRawBearishCap,
  type AiReasoningSummary,
} from "@/lib/ai-reasoning";

type ProTipCalloutProps = {
  aiReasoning?: AiReasoningSummary | null;
  className?: string;
};

/**
 * Surfaces `pro_tip` from buy-flow JSON. When `one_h_bearish_cap_applied` is true,
 * uses amber (caution) or red-tinted + pulse (very high conviction vs cap) backgrounds.
 */
export function ProTipCallout({ aiReasoning, className }: ProTipCalloutProps) {
  if (!aiReasoning) return null;
  const tip = aiReasoning.proTip?.trim();
  const cap = aiReasoning.oneHBearishCapApplied === true;
  const raw = aiReasoning.rawWeightedConfidence;
  const pre = aiReasoning.weightedPreSentimentVibe;
  const eff = aiReasoning.effectiveConfidence;
  const pen = aiReasoning.sentimentPenaltyApplied === true;
  const penF = aiReasoning.sentimentPenaltyFactor;
  const wrGov = aiReasoning.warRoomGovernance?.trim();
  const newsVeto = wrGov === "veto_blocked" && aiReasoning.warRoomNewsVote === "veto";
  const whaleWarn =
    aiReasoning.warRoomWhaleVote === "warning" &&
    wrGov === "whale_penalty_applied";

  const showCapVsEff =
    typeof eff === "number" &&
    typeof raw === "number" &&
    raw > eff + 0.25;
  const showSentimentHaircut =
    pen &&
    typeof pre === "number" &&
    typeof raw === "number" &&
    pre > raw + 0.25;

  if (!tip && !cap && !showCapVsEff && !showSentimentHaircut && !newsVeto && !whaleWarn) {
    return null;
  }

  const dangerCap = isHighRawBearishCap(aiReasoning);
  const shell = newsVeto
    ? "border-destructive/70 bg-destructive/20 text-foreground"
    : cap
    ? dangerCap
      ? "border-destructive/60 bg-destructive/15 text-foreground"
      : "border-warning/50 bg-warning/15 text-foreground"
    : whaleWarn
    ? "border-amber-500/50 bg-amber-500/10 text-foreground"
    : "border-border/70 bg-muted/40 text-muted-foreground";

  return (
    <div
      className={cn(
        "w-full min-w-0 rounded-md border px-2 py-2 text-[11px] leading-snug sm:px-3 sm:py-2 sm:text-xs",
        shell,
        dangerCap && cap && "animate-pulse shadow-sm shadow-destructive/20",
        className,
      )}
      role="note"
    >
      {newsVeto ? (
        <p className="mb-1 font-semibold text-destructive wrap-anywhere">
          News veto active: trade blocked despite high chart confidence.
          {typeof aiReasoning.warRoomTechnicianScore === "number"
            ? ` Technician ${aiReasoning.warRoomTechnicianScore.toFixed(1)}% vs floor ${typeof aiReasoning.warRoomGovernanceFloor === "number" ? `${aiReasoning.warRoomGovernanceFloor}%` : "—"}.`
            : null}
        </p>
      ) : null}
      {whaleWarn && !newsVeto ? (
        <p className="mb-1 font-semibold text-amber-800 dark:text-amber-200 wrap-anywhere">
          Whale watch: order book skew triggered a stricter confidence floor
          {typeof aiReasoning.warRoomGovernanceFloor === "number"
            ? ` (+10 → ${aiReasoning.warRoomGovernanceFloor}%).`
            : "."}
        </p>
      ) : null}
      {cap ? (
        <p
          className={cn(
            "mb-1 font-semibold wrap-anywhere",
            dangerCap ? "text-destructive" : "text-warning",
          )}
        >
          {dangerCap
            ? "1h downtrend vs EMA200 — high conviction was capped (bounce watch)."
            : "1h downtrend vs EMA200 — long entries run against the bigger trend."}
        </p>
      ) : null}
      {tip ? (
        <p
          className={cn(
            "wrap-anywhere whitespace-pre-wrap text-pretty",
            !cap ? "text-foreground/90" : "text-foreground/95",
          )}
        >
          <span className="font-medium text-foreground/80">Pro tip: </span>
          {tip}
        </p>
      ) : cap ? (
        <p className="wrap-anywhere text-foreground/85">
          Autopilot still scans for entries, but MTF risk filter compressed the
          execution score.
        </p>
      ) : null}
      {showSentimentHaircut ? (
        <p className="mt-1.5 font-mono text-[10px] opacity-90 sm:text-[11px]">
          Pre-sentiment weighted {pre!.toFixed(1)}%
          {typeof penF === "number" && Number.isFinite(penF)
            ? ` (×${penF} scorecard)`
            : " (sentiment haircut)"}
          {" → "}
          post {raw!.toFixed(1)}%
        </p>
      ) : null}
      {showCapVsEff ? (
        <p className="mt-1 font-mono text-[10px] opacity-90 sm:text-[11px]">
          Post-sentiment weighted {raw!.toFixed(1)}% → final (1h cap) {eff!.toFixed(1)}%
        </p>
      ) : null}
      {!showCapVsEff &&
      !showSentimentHaircut &&
      typeof raw === "number" &&
      typeof eff === "number" &&
      Math.abs(raw - eff) > 0.25 ? (
        <p className="mt-1 font-mono text-[10px] opacity-90 sm:text-[11px]">
          Weighted {raw.toFixed(1)}% → final {eff.toFixed(1)}%
        </p>
      ) : null}
    </div>
  );
}
