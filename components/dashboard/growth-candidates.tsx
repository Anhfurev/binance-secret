'use client'

import { Sparkles, ArrowUp, ArrowDown, Minus, TrendingUp, AlertTriangle, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { GrowthCandidate, TrendLabel, SuggestedAction, RiskTag } from '@/lib/types'
import { cn } from '@/lib/utils'

interface GrowthCandidatesProps {
  candidates: GrowthCandidate[]
  signalsChanged: boolean
  isLoading?: boolean
}

const trendColors: Record<TrendLabel, string> = {
  'Strong': 'bg-success/10 text-success border-success/30',
  'Watch': 'bg-warning/10 text-warning border-warning/30',
  'Weak': 'bg-destructive/10 text-destructive border-destructive/30'
}

const actionColors: Record<SuggestedAction, string> = {
  'Buy small': 'bg-success/20 text-success',
  'Hold': 'bg-muted text-muted-foreground',
  'Reduce': 'bg-warning/20 text-warning',
  'Avoid': 'bg-destructive/20 text-destructive'
}

const riskColors: Record<RiskTag, string> = {
  'Low': 'text-success',
  'Medium': 'text-warning',
  'High': 'text-destructive'
}

function RankChangeIndicator({ change }: { change: 'up' | 'down' | 'same' }) {
  if (change === 'up') {
    return (
      <div className="flex items-center gap-0.5 text-success">
        <ArrowUp className="h-3 w-3" />
      </div>
    )
  }
  if (change === 'down') {
    return (
      <div className="flex items-center gap-0.5 text-destructive">
        <ArrowDown className="h-3 w-3" />
      </div>
    )
  }
  return <Minus className="h-3 w-3 text-muted-foreground" />
}

function FactorBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground capitalize">{label}</span>
        <span className="font-medium">{value}%</span>
      </div>
      <Progress 
        value={value} 
        className={cn(
          "h-1",
          value >= 70 && "[&>div]:bg-success",
          value >= 40 && value < 70 && "[&>div]:bg-warning",
          value < 40 && "[&>div]:bg-destructive"
        )}
      />
    </div>
  )
}

export function GrowthCandidates({ candidates, signalsChanged, isLoading }: GrowthCandidatesProps) {
  return (
    <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-accent" />
            AI Growth Candidates
          </CardTitle>
          {signalsChanged && (
            <Badge 
              variant="outline" 
              className="w-fit animate-pulse border-accent/30 bg-accent/10 text-accent"
            >
              <TrendingUp className="mr-1 h-3 w-3" />
              Signals Updated
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Top 5 coins with highest short-term growth potential
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-32 animate-pulse rounded-xl bg-secondary/50" />
          ))
        ) : (
          candidates.map((candidate, index) => (
            <div
              key={candidate.id}
              className={cn(
                "rounded-xl border border-border/50 bg-secondary/20 p-4 transition-all hover:bg-secondary/40",
                "animate-in fade-in slide-in-from-bottom-2",
                index === 0 && "animate-stagger-1",
                index === 1 && "animate-stagger-2",
                index === 2 && "animate-stagger-3",
                index === 3 && "animate-stagger-4",
                index === 4 && "animate-stagger-5"
              )}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                {/* Left: Coin info */}
                <div className="flex items-start gap-3">
                  <div className="relative">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-sm font-bold text-primary">
                      #{candidate.currentRank}
                    </div>
                    <div className="absolute -bottom-1 -right-1">
                      <RankChangeIndicator change={candidate.rankChange} />
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <img 
                      src={candidate.image} 
                      alt={candidate.name}
                      className="h-8 w-8 rounded-full"
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-semibold">{candidate.name}</p>
                        <span className="text-xs text-muted-foreground">{candidate.symbol}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge 
                          variant="outline" 
                          className={cn("text-xs px-1.5 py-0", trendColors[candidate.trend])}
                        >
                          {candidate.trend}
                        </Badge>
                        <span className={cn("text-xs font-medium", riskColors[candidate.riskTag])}>
                          {candidate.riskTag} Risk
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right: Scores */}
                <div className="flex items-center gap-4 sm:text-right">
                  <div>
                    <p className="text-xs text-muted-foreground">Growth Score</p>
                    <p className={cn(
                      "text-2xl font-bold",
                      candidate.growthScore >= 70 && "text-success",
                      candidate.growthScore >= 40 && candidate.growthScore < 70 && "text-warning",
                      candidate.growthScore < 40 && "text-destructive"
                    )}>
                      {candidate.growthScore}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Confidence</p>
                    <p className="text-lg font-semibold text-foreground">
                      {candidate.confidence}%
                    </p>
                  </div>
                </div>
              </div>

              {/* AI Reason */}
              <div className="mt-3 flex items-start gap-2 rounded-lg bg-background/50 p-2.5">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-xs text-muted-foreground">
                  {candidate.aiReason}
                </p>
              </div>

              {/* Factors */}
              <TooltipProvider>
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {Object.entries(candidate.factors).map(([key, value]) => (
                    <Tooltip key={key}>
                      <TooltipTrigger asChild>
                        <div className="cursor-help">
                          <FactorBar label={key.slice(0, 3)} value={value} />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p className="capitalize">{key}: {value}%</p>
                      </TooltipContent>
                    </Tooltip>
                  ))}
                </div>
              </TooltipProvider>

              {/* Action */}
              <div className="mt-3 flex items-center justify-between">
                <div className={cn(
                  "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold",
                  actionColors[candidate.suggestedAction]
                )}>
                  {candidate.suggestedAction === 'Avoid' && <AlertTriangle className="h-3 w-3" />}
                  Suggested: {candidate.suggestedAction}
                </div>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  )
}
