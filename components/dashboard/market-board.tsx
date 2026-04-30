'use client'

import Image from 'next/image'
import { useState, useMemo } from 'react'
import { ArrowUpDown, TrendingUp, TrendingDown, Search, BarChart3 } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { CoinData } from '@/lib/types'
import { cn } from '@/lib/utils'

interface MarketBoardProps {
  coins: CoinData[]
  isLoading?: boolean
}

type SortKey = 'market_cap_rank' | 'current_price' | 'price_change_percentage_24h' | 'market_cap' | 'total_volume'
type SortOrder = 'asc' | 'desc'

type MarketSortableHeaderProps = {
  label: string
  sortKeyName: SortKey
  onSort: (key: SortKey) => void
}

function MarketSortableHeader({ label, sortKeyName, onSort }: MarketSortableHeaderProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8 gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
      onClick={() => onSort(sortKeyName)}
    >
      {label}
      <ArrowUpDown className="h-3 w-3" />
    </Button>
  )
}

export function MarketBoard({ coins, isLoading }: MarketBoardProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('market_cap_rank')
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc')

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortOrder(key === 'market_cap_rank' ? 'asc' : 'desc')
    }
  }

  const filteredAndSortedCoins = useMemo(() => {
    let result = [...coins]
    
    // Filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      result = result.filter(coin => 
        coin.name.toLowerCase().includes(query) ||
        coin.symbol.toLowerCase().includes(query)
      )
    }
    
    // Sort
    result.sort((a, b) => {
      const aVal = a[sortKey] ?? 0
      const bVal = b[sortKey] ?? 0
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal
    })
    
    return result
  }, [coins, searchQuery, sortKey, sortOrder])

  const formatNumber = (num: number, type: 'price' | 'marketCap' | 'volume') => {
    if (type === 'price') {
      if (num >= 1) return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      return `$${num.toFixed(4)}`
    }
    if (num >= 1e12) return `$${(num / 1e12).toFixed(2)}T`
    if (num >= 1e9) return `$${(num / 1e9).toFixed(2)}B`
    if (num >= 1e6) return `$${(num / 1e6).toFixed(2)}M`
    return `$${num.toLocaleString()}`
  }

  return (
    <Card className="card-hover border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <BarChart3 className="h-4 w-4 text-primary" />
            Live Market Board
            <Badge variant="outline" className="ml-1 animate-pulse-glow bg-success/10 text-success border-success/30">
              Live
            </Badge>
          </CardTitle>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search coins..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-sm bg-secondary/50 border-border/50"
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="w-12 text-center">#</TableHead>
                <TableHead>Coin</TableHead>
                <TableHead className="text-right">
                  <MarketSortableHeader label="Price" sortKeyName="current_price" onSort={handleSort} />
                </TableHead>
                <TableHead className="text-right">
                  <MarketSortableHeader label="24h %" sortKeyName="price_change_percentage_24h" onSort={handleSort} />
                </TableHead>
                <TableHead className="hidden text-right md:table-cell">
                  <MarketSortableHeader label="Market Cap" sortKeyName="market_cap" onSort={handleSort} />
                </TableHead>
                <TableHead className="hidden text-right lg:table-cell">
                  <MarketSortableHeader label="Volume" sortKeyName="total_volume" onSort={handleSort} />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-border/50">
                    <TableCell colSpan={6}>
                      <div className="h-12 animate-pulse rounded bg-secondary/50" />
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                filteredAndSortedCoins.map((coin) => {
                  const isPositive = coin.price_change_percentage_24h >= 0
                  return (
                    <TableRow 
                      key={coin.id} 
                      className="border-border/50 transition-colors hover:bg-secondary/30"
                    >
                      <TableCell className="text-center text-sm text-muted-foreground">
                        {coin.market_cap_rank}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2.5">
                          <Image
                            src={coin.image}
                            alt={coin.name}
                            width={28}
                            height={28}
                            className="h-7 w-7 rounded-full"
                            unoptimized
                          />
                          <div>
                            <p className="font-medium">{coin.name}</p>
                            <p className="text-xs text-muted-foreground uppercase">
                              {coin.symbol}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-medium">
                        {formatNumber(coin.current_price, 'price')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold",
                          isPositive 
                            ? "bg-success/10 text-success" 
                            : "bg-destructive/10 text-destructive"
                        )}>
                          {isPositive ? (
                            <TrendingUp className="h-3 w-3" />
                          ) : (
                            <TrendingDown className="h-3 w-3" />
                          )}
                          {isPositive ? '+' : ''}{coin.price_change_percentage_24h.toFixed(2)}%
                        </div>
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-sm md:table-cell">
                        {formatNumber(coin.market_cap, 'marketCap')}
                      </TableCell>
                      <TableCell className="hidden text-right font-mono text-sm text-muted-foreground lg:table-cell">
                        {formatNumber(coin.total_volume, 'volume')}
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
