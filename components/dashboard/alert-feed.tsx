'use client'

import { Bell, AlertTriangle, AlertCircle, Info } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { Alert, AlertSeverity } from '@/lib/types'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'

interface AlertFeedProps {
  alerts: Alert[]
  isLoading?: boolean
}

const severityConfig: Record<AlertSeverity, { 
  icon: typeof AlertCircle
  containerClass: string
  iconClass: string
  dotClass: string
}> = {
  info: {
    icon: Info,
    containerClass: 'border-info/20 bg-info/5',
    iconClass: 'text-info',
    dotClass: 'bg-info'
  },
  warning: {
    icon: AlertTriangle,
    containerClass: 'border-warning/20 bg-warning/5',
    iconClass: 'text-warning',
    dotClass: 'bg-warning'
  },
  critical: {
    icon: AlertCircle,
    containerClass: 'border-destructive/20 bg-destructive/5',
    iconClass: 'text-destructive',
    dotClass: 'bg-destructive animate-pulse'
  }
}

export function AlertFeed({ alerts, isLoading }: AlertFeedProps) {
  return (
    <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          <Bell className="h-4 w-4 text-primary" />
          AI Alert Feed
          {alerts.some(a => a.severity === 'critical') && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-destructive" />
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[300px] px-4 pb-4">
          <div className="space-y-2">
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-lg bg-secondary/50" />
              ))
            ) : alerts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Bell className="h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm text-muted-foreground">No alerts at this time</p>
              </div>
            ) : (
              alerts.map((alert, index) => {
                const config = severityConfig[alert.severity]
                const Icon = config.icon
                
                return (
                  <div
                    key={alert.id}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-3 transition-colors",
                      config.containerClass,
                      "animate-in fade-in slide-in-from-right-2",
                      index === 0 && "animate-stagger-1",
                      index === 1 && "animate-stagger-2",
                      index === 2 && "animate-stagger-3"
                    )}
                  >
                    <div className={cn("mt-0.5 shrink-0", config.iconClass)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm leading-relaxed text-foreground">
                        {alert.message}
                      </p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <span className={cn("h-1.5 w-1.5 rounded-full", config.dotClass)} />
                        <span className="text-xs text-muted-foreground">
                          {formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true })}
                        </span>
                        {alert.coinSymbol && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 text-xs font-medium">
                            {alert.coinSymbol}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
