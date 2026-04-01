'use client'

import { TrendingUp, TrendingDown, Shield, PieChart } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import type { PortfolioSnapshot } from '@/lib/types'
import { cn } from '@/lib/utils'

interface PortfolioSnapshotProps {
  portfolio: PortfolioSnapshot
  onCapitalProtectionToggle: (enabled: boolean) => void
}

export function PortfolioSnapshotCard({ portfolio, onCapitalProtectionToggle }: PortfolioSnapshotProps) {
  const isPositive = portfolio.pnl24h >= 0

  return (
    <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <PieChart className="h-4 w-4 text-primary" />
            Portfolio Snapshot
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            Personal
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Total Balance */}
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">Total Balance</p>
          <p className="text-3xl font-bold tracking-tight">
            ${portfolio.totalBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </p>
        </div>

        {/* 24h PnL */}
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex items-center gap-1 rounded-lg px-2.5 py-1.5",
            isPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
          )}>
            {isPositive ? (
              <TrendingUp className="h-4 w-4" />
            ) : (
              <TrendingDown className="h-4 w-4" />
            )}
            <span className="text-sm font-semibold">
              {isPositive ? '+' : ''}{portfolio.pnlPercent24h.toFixed(2)}%
            </span>
          </div>
          <span className={cn(
            "text-sm font-medium",
            isPositive ? "text-success" : "text-destructive"
          )}>
            {isPositive ? '+' : ''}${Math.abs(portfolio.pnl24h).toLocaleString(undefined, { minimumFractionDigits: 2 })}
          </span>
          <span className="text-xs text-muted-foreground">24h</span>
        </div>

        {/* Allocation */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Allocation</span>
          </div>
          <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
            {portfolio.assets.map((asset, index) => (
              <div
                key={asset.coinId}
                className={cn(
                  "h-full",
                  index === 0 && "bg-primary",
                  index === 1 && "bg-accent",
                  index === 2 && "bg-chart-3",
                  index > 2 && "bg-muted-foreground"
                )}
                style={{ width: `${asset.allocation}%` }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {portfolio.assets.map((asset, index) => (
              <div key={asset.coinId} className="flex items-center gap-1.5 text-xs">
                <div className={cn(
                  "h-2 w-2 rounded-full",
                  index === 0 && "bg-primary",
                  index === 1 && "bg-accent",
                  index === 2 && "bg-chart-3",
                  index > 2 && "bg-muted-foreground"
                )} />
                <span className="text-muted-foreground">
                  {asset.symbol} {asset.allocation.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Score */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Risk Score</span>
            <span className={cn(
              "font-semibold",
              portfolio.riskScore <= 33 && "text-success",
              portfolio.riskScore > 33 && portfolio.riskScore <= 66 && "text-warning",
              portfolio.riskScore > 66 && "text-destructive"
            )}>
              {portfolio.riskScore}/100
            </span>
          </div>
          <Progress 
            value={portfolio.riskScore} 
            className={cn(
              "h-1.5",
              portfolio.riskScore <= 33 && "[&>div]:bg-success",
              portfolio.riskScore > 33 && portfolio.riskScore <= 66 && "[&>div]:bg-warning",
              portfolio.riskScore > 66 && "[&>div]:bg-destructive"
            )}
          />
        </div>

        {/* Capital Protection Toggle */}
        <div className="flex items-center justify-between rounded-xl border border-border/50 bg-secondary/30 p-3">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <div>
              <p className="text-sm font-medium">Capital Protection</p>
              <p className="text-xs text-muted-foreground">Auto-reduce on high risk</p>
            </div>
          </div>
          <Switch
            checked={portfolio.capitalProtectionMode}
            onCheckedChange={onCapitalProtectionToggle}
          />
        </div>
      </CardContent>
    </Card>
  )
}
