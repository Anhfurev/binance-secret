import type { 
  CoinData, 
  PortfolioSnapshot, 
  Alert, 
  NewsItem, 
  SentimentData,
  GrowthCandidate 
} from './types'

export const mockCoins: CoinData[] = [
  {
    id: 'bitcoin',
    symbol: 'btc',
    name: 'Bitcoin',
    image: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
    current_price: 97542.00,
    market_cap: 1932000000000,
    market_cap_rank: 1,
    price_change_percentage_24h: 2.45,
    total_volume: 42500000000,
    high_24h: 98200.00,
    low_24h: 95100.00,
    circulating_supply: 19800000
  },
  {
    id: 'ethereum',
    symbol: 'eth',
    name: 'Ethereum',
    image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    current_price: 3842.50,
    market_cap: 462000000000,
    market_cap_rank: 2,
    price_change_percentage_24h: 3.12,
    total_volume: 18500000000,
    high_24h: 3920.00,
    low_24h: 3720.00,
    circulating_supply: 120200000
  },
  {
    id: 'solana',
    symbol: 'sol',
    name: 'Solana',
    image: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    current_price: 198.45,
    market_cap: 96500000000,
    market_cap_rank: 4,
    price_change_percentage_24h: 5.67,
    total_volume: 4200000000,
    high_24h: 205.00,
    low_24h: 186.50,
    circulating_supply: 486000000
  },
  {
    id: 'ripple',
    symbol: 'xrp',
    name: 'XRP',
    image: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
    current_price: 2.34,
    market_cap: 134000000000,
    market_cap_rank: 3,
    price_change_percentage_24h: -1.23,
    total_volume: 8900000000,
    high_24h: 2.42,
    low_24h: 2.28,
    circulating_supply: 57200000000
  },
  {
    id: 'binancecoin',
    symbol: 'bnb',
    name: 'BNB',
    image: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    current_price: 712.80,
    market_cap: 106000000000,
    market_cap_rank: 5,
    price_change_percentage_24h: 1.85,
    total_volume: 1850000000,
    high_24h: 725.00,
    low_24h: 698.00,
    circulating_supply: 149000000
  },
  {
    id: 'dogecoin',
    symbol: 'doge',
    name: 'Dogecoin',
    image: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
    current_price: 0.3842,
    market_cap: 57200000000,
    market_cap_rank: 7,
    price_change_percentage_24h: 8.92,
    total_volume: 5600000000,
    high_24h: 0.4100,
    low_24h: 0.3450,
    circulating_supply: 148900000000
  }
]

export const mockPortfolio: PortfolioSnapshot = {
  totalBalance: 125842.50,
  pnl24h: 3245.80,
  pnlPercent24h: 2.65,
  riskScore: 42,
  capitalProtectionMode: false,
  assets: [
    {
      coinId: 'bitcoin',
      symbol: 'BTC',
      name: 'Bitcoin',
      amount: 0.85,
      value: 82910.70,
      allocation: 65.9,
      pnl24h: 1987.50,
      pnlPercent24h: 2.45
    },
    {
      coinId: 'ethereum',
      symbol: 'ETH',
      name: 'Ethereum',
      amount: 8.5,
      value: 32661.25,
      allocation: 26.0,
      pnl24h: 985.30,
      pnlPercent24h: 3.12
    },
    {
      coinId: 'solana',
      symbol: 'SOL',
      name: 'Solana',
      amount: 51.5,
      value: 10220.18,
      allocation: 8.1,
      pnl24h: 556.40,
      pnlPercent24h: 5.76
    }
  ]
}

export const mockAlerts: Alert[] = [
  {
    id: '1',
    message: 'Breakout setup detected on SOL - Price crossing resistance at $195',
    severity: 'info',
    timestamp: new Date(Date.now() - 5 * 60 * 1000),
    coinId: 'solana',
    coinSymbol: 'SOL'
  },
  {
    id: '2',
    message: 'High volatility warning: DOGE showing 15% price swings',
    severity: 'warning',
    timestamp: new Date(Date.now() - 12 * 60 * 1000),
    coinId: 'dogecoin',
    coinSymbol: 'DOGE'
  },
  {
    id: '3',
    message: 'XRP falling fast: Consider reducing exposure below $2.25',
    severity: 'critical',
    timestamp: new Date(Date.now() - 25 * 60 * 1000),
    coinId: 'ripple',
    coinSymbol: 'XRP'
  },
  {
    id: '4',
    message: 'BTC dominance increasing - Potential altcoin weakness ahead',
    severity: 'warning',
    timestamp: new Date(Date.now() - 45 * 60 * 1000)
  },
  {
    id: '5',
    message: 'ETH gas fees at 3-month low - Good time for on-chain activity',
    severity: 'info',
    timestamp: new Date(Date.now() - 60 * 60 * 1000),
    coinId: 'ethereum',
    coinSymbol: 'ETH'
  }
]

export const mockNews: NewsItem[] = [
  {
    id: '1',
    title: 'Bitcoin ETF sees record $2.1B inflows as institutional demand surges',
    source: 'CoinDesk',
    url: '#',
    publishedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    aiSummary: 'Major institutional buying pressure continues. BlackRock and Fidelity leading inflows.',
    marketImpact: 'positive'
  },
  {
    id: '2',
    title: 'Ethereum Dencun upgrade shows 90% reduction in L2 fees',
    source: 'The Block',
    url: '#',
    publishedAt: new Date(Date.now() - 4 * 60 * 60 * 1000),
    aiSummary: 'Layer 2 solutions now significantly cheaper, boosting ecosystem adoption.',
    marketImpact: 'positive'
  },
  {
    id: '3',
    title: 'SEC delays decision on multiple spot Solana ETF applications',
    source: 'Reuters',
    url: '#',
    publishedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
    aiSummary: 'Regulatory uncertainty continues. Decision pushed to Q3 2026.',
    marketImpact: 'neutral'
  },
  {
    id: '4',
    title: 'Whale alert: 15,000 BTC moved to exchanges in past 24 hours',
    source: 'Whale Alert',
    url: '#',
    publishedAt: new Date(Date.now() - 8 * 60 * 60 * 1000),
    aiSummary: 'Large holder movement detected. Could indicate selling pressure or exchange rebalancing.',
    marketImpact: 'negative'
  }
]

export const mockSentiment: SentimentData = {
  fearGreedIndex: 72,
  fearGreedLabel: 'Greed',
  socialSentiment: 68,
  socialSentimentLabel: 'Bullish'
}

export const mockGrowthCandidates: GrowthCandidate[] = [
  {
    id: 'solana',
    symbol: 'SOL',
    name: 'Solana',
    image: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
    growthScore: 82,
    confidence: 78,
    trend: 'Strong',
    aiReason: 'Strong momentum, high volume signal, market leader',
    suggestedAction: 'Buy small',
    riskTag: 'Medium',
    rankChange: 'up',
    previousRank: 2,
    currentRank: 1,
    factors: { momentum: 85, volume: 78, sentiment: 72, dominance: 60, volatility: 65 }
  },
  {
    id: 'ethereum',
    symbol: 'ETH',
    name: 'Ethereum',
    image: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
    growthScore: 76,
    confidence: 85,
    trend: 'Strong',
    aiReason: 'Strong momentum, positive sentiment, stable price action',
    suggestedAction: 'Buy small',
    riskTag: 'Low',
    rankChange: 'same',
    currentRank: 2,
    factors: { momentum: 72, volume: 65, sentiment: 80, dominance: 90, volatility: 82 }
  },
  {
    id: 'bitcoin',
    symbol: 'BTC',
    name: 'Bitcoin',
    image: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
    growthScore: 71,
    confidence: 92,
    trend: 'Watch',
    aiReason: 'Market leader, stable price action, moderate momentum',
    suggestedAction: 'Hold',
    riskTag: 'Low',
    rankChange: 'down',
    previousRank: 2,
    currentRank: 3,
    factors: { momentum: 58, volume: 55, sentiment: 75, dominance: 100, volatility: 88 }
  },
  {
    id: 'dogecoin',
    symbol: 'DOGE',
    name: 'Dogecoin',
    image: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
    growthScore: 65,
    confidence: 55,
    trend: 'Watch',
    aiReason: 'High volume signal, elevated volatility risk',
    suggestedAction: 'Hold',
    riskTag: 'High',
    rankChange: 'up',
    previousRank: 5,
    currentRank: 4,
    factors: { momentum: 90, volume: 82, sentiment: 45, dominance: 40, volatility: 35 }
  },
  {
    id: 'binancecoin',
    symbol: 'BNB',
    name: 'BNB',
    image: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
    growthScore: 58,
    confidence: 72,
    trend: 'Watch',
    aiReason: 'Market leader, low trading activity, stable price action',
    suggestedAction: 'Hold',
    riskTag: 'Low',
    rankChange: 'same',
    currentRank: 5,
    factors: { momentum: 52, volume: 38, sentiment: 60, dominance: 75, volatility: 78 }
  }
]

export const mockGlobalData = {
  total_market_cap: { usd: 3420000000000 },
  total_volume: { usd: 142000000000 },
  market_cap_percentage: { btc: 56.5, eth: 13.5 },
  market_cap_change_percentage_24h_usd: 2.15
}
