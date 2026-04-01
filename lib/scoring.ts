import type { CoinData, GrowthCandidate, TrendLabel, SuggestedAction, RiskTag, RankChange } from './types'

/**
 * Calculate Growth Score for a coin
 * Formula combines:
 * - 24h momentum (price change)
 * - Market cap ranking (lower = better)
 * - Relative volume signal
 * - Sentiment factor (simulated)
 * - Volatility penalty
 */
export function calculateGrowthScore(
  coin: CoinData,
  globalVolume: number,
  previousRanks: Map<string, number>
): GrowthCandidate {
  // Momentum score (0-30 points): Based on 24h price change
  const momentum = coin.price_change_percentage_24h || 0
  const momentumScore = Math.min(30, Math.max(0, 15 + momentum * 1.5))
  
  // Market cap ranking score (0-20 points): Top coins get higher scores
  const rankScore = Math.max(0, 20 - (coin.market_cap_rank - 1) * 2)
  
  // Volume signal (0-25 points): Higher relative volume = more interest
  const volumeRatio = coin.total_volume / (coin.market_cap || 1)
  const volumeScore = Math.min(25, volumeRatio * 250)
  
  // Sentiment factor (0-15 points): Simulated based on momentum + volume
  const sentimentBase = (momentum > 0 ? 10 : 5) + (volumeRatio > 0.1 ? 5 : 0)
  const sentimentScore = Math.min(15, sentimentBase)
  
  // Volatility penalty (0-10 points deduction)
  const priceRange = coin.high_24h && coin.low_24h 
    ? ((coin.high_24h - coin.low_24h) / coin.low_24h) * 100 
    : 0
  const volatilityPenalty = Math.min(10, priceRange * 0.5)
  
  // Calculate total growth score
  const rawScore = momentumScore + rankScore + volumeScore + sentimentScore - volatilityPenalty
  const growthScore = Math.round(Math.min(100, Math.max(0, rawScore)))
  
  // Calculate confidence based on data quality
  const confidence = calculateConfidence(coin, volumeRatio)
  
  // Determine trend label
  const trend = getTrendLabel(growthScore, momentum)
  
  // Determine suggested action
  const suggestedAction = getSuggestedAction(growthScore, confidence, trend)
  
  // Determine risk tag
  const riskTag = getRiskTag(volatilityPenalty, coin.market_cap_rank)
  
  // Determine rank change
  const previousRank = previousRanks.get(coin.id)
  const rankChange = getRankChange(previousRank, coin.market_cap_rank)
  
  // Generate AI reason
  const aiReason = generateAIReason({
    momentum: momentumScore / 30,
    volume: volumeScore / 25,
    sentiment: sentimentScore / 15,
    dominance: rankScore / 20,
    volatility: 1 - (volatilityPenalty / 10)
  })
  
  return {
    id: coin.id,
    symbol: coin.symbol.toUpperCase(),
    name: coin.name,
    image: coin.image,
    growthScore,
    confidence,
    trend,
    aiReason,
    suggestedAction,
    riskTag,
    rankChange,
    previousRank,
    currentRank: coin.market_cap_rank,
    factors: {
      momentum: Math.round((momentumScore / 30) * 100),
      volume: Math.round((volumeScore / 25) * 100),
      sentiment: Math.round((sentimentScore / 15) * 100),
      dominance: Math.round((rankScore / 20) * 100),
      volatility: Math.round((1 - volatilityPenalty / 10) * 100)
    }
  }
}

function calculateConfidence(coin: CoinData, volumeRatio: number): number {
  let confidence = 50
  
  // Higher market cap = more reliable data
  if (coin.market_cap_rank <= 10) confidence += 25
  else if (coin.market_cap_rank <= 50) confidence += 15
  else confidence += 5
  
  // Good volume = more confidence
  if (volumeRatio > 0.1) confidence += 15
  else if (volumeRatio > 0.05) confidence += 10
  else confidence += 5
  
  // Has price data
  if (coin.high_24h && coin.low_24h) confidence += 10
  
  return Math.min(95, confidence)
}

function getTrendLabel(score: number, momentum: number): TrendLabel {
  if (score >= 65 && momentum > 2) return 'Strong'
  if (score >= 40 || momentum > 0) return 'Watch'
  return 'Weak'
}

function getSuggestedAction(score: number, confidence: number, trend: TrendLabel): SuggestedAction {
  if (trend === 'Strong' && confidence >= 70) return 'Buy small'
  if (trend === 'Watch' || (trend === 'Strong' && confidence < 70)) return 'Hold'
  if (score < 30) return 'Avoid'
  return 'Reduce'
}

function getRiskTag(volatilityPenalty: number, rank: number): RiskTag {
  if (volatilityPenalty < 3 && rank <= 20) return 'Low'
  if (volatilityPenalty < 6 || rank <= 50) return 'Medium'
  return 'High'
}

function getRankChange(previousRank: number | undefined, currentRank: number): RankChange {
  if (previousRank === undefined) return 'same'
  if (currentRank < previousRank) return 'up'
  if (currentRank > previousRank) return 'down'
  return 'same'
}

function generateAIReason(factors: {
  momentum: number
  volume: number
  sentiment: number
  dominance: number
  volatility: number
}): string {
  const reasons: string[] = []
  
  if (factors.momentum > 0.6) reasons.push('strong momentum')
  else if (factors.momentum < 0.3) reasons.push('weak momentum')
  
  if (factors.volume > 0.7) reasons.push('high volume signal')
  else if (factors.volume < 0.3) reasons.push('low trading activity')
  
  if (factors.sentiment > 0.7) reasons.push('positive sentiment')
  
  if (factors.dominance > 0.6) reasons.push('market leader')
  else if (factors.dominance < 0.3) reasons.push('smaller cap')
  
  if (factors.volatility < 0.5) reasons.push('elevated volatility risk')
  else if (factors.volatility > 0.8) reasons.push('stable price action')
  
  if (reasons.length === 0) reasons.push('neutral indicators')
  
  return reasons.slice(0, 3).join(', ').replace(/^./, s => s.toUpperCase())
}

/**
 * Rank candidates by growth score and return top N
 */
export function rankGrowthCandidates(
  coins: CoinData[],
  globalVolume: number,
  previousRanks: Map<string, number>,
  limit: number = 5
): GrowthCandidate[] {
  const candidates = coins.map(coin => 
    calculateGrowthScore(coin, globalVolume, previousRanks)
  )
  
  return candidates
    .sort((a, b) => b.growthScore - a.growthScore)
    .slice(0, limit)
    .map((candidate, index) => ({
      ...candidate,
      currentRank: index + 1
    }))
}
