export interface MarketOdds {
  enabled: boolean;
  homeSpread?: number;
  total?: number;
  recordedAt?: string;
  provider?: string;
  source: 'ESPN' | 'manual';
  awayTeam: string;
  homeTeam: string;
  season?: number;
  week?: number;
  gameId?: string;
  kickoff?: string;
}

export interface MarketEvidence {
  source: MarketOdds['source'];
  provider: string;
  recordedAt: string;
  homeSpread: number;
  total: number;
  blend: number;
  implied: { away: number; home: number };
  baseline: { away: number; home: number };
  weighted: { away: number; home: number };
  effectiveRuns: number;
  warnings: string[];
}

export const MARKET_BLEND = 0.35;
const rounded = (value: number) => Math.round(value * 100) / 100;

/** Negative home spread means home is favored: total 48, home -6 => home 27 / away 21. */
export function impliedMarketScores(homeSpread: number, total: number) {
  if (!Number.isFinite(homeSpread) || Math.abs(homeSpread) > 40 ||
      !Number.isFinite(total) || total < 10 || total > 100 || total <= Math.abs(homeSpread)) {
    throw new Error('Enter a home spread between -40 and +40 and a total between 10 and 100, larger than the absolute spread.');
  }
  return { away: (total + homeSpread) / 2, home: (total - homeSpread) / 2 };
}

export function validateMarketOdds(market: MarketOdds | undefined, away: string, home: string, now = Date.now()) {
  if (!market?.enabled) return undefined;
  if (market.awayTeam !== away || market.homeTeam !== home) {
    throw new Error('These odds belong to a different matchup. Select or enter odds for the current teams.');
  }
  if (typeof market.homeSpread !== 'number' || typeof market.total !== 'number') {
    throw new Error('Market blending needs both the home spread and over/under. Enter both, or turn it off.');
  }
  const implied = impliedMarketScores(market.homeSpread, market.total);
  const recorded = Date.parse(market.recordedAt ?? '');
  if (!Number.isFinite(recorded) || recorded > now + 300_000) {
    throw new Error('Enter a valid odds recorded-at time that is not in the future.');
  }
  if (market.kickoff && (!Number.isFinite(Date.parse(market.kickoff)) || recorded >= Date.parse(market.kickoff))) {
    throw new Error('Use odds recorded before kickoff, or turn market blending off.');
  }
  return { market, implied, recorded };
}

/** Reweights complete generated games; never changes scores or player stats after the fact. */
export function marketOutcomeWeights(
  scores: { away: number; home: number }[],
  valid: NonNullable<ReturnType<typeof validateMarketOdds>>,
  now = Date.now(),
): { weights: number[]; evidence: MarketEvidence } {
  if (scores.length < 20) throw new Error('Market blending needs at least 20 simulated games.');
  const n = scores.length;
  const mean = (side: 'away' | 'home') => scores.reduce((sum, score) => sum + score[side], 0) / n;
  const baseline = { away: mean('away'), home: mean('home') };
  // At least a 7-point bandwidth avoids treating the line as an exact score.
  const variance = (side: 'away' | 'home') => Math.max(49, scores.reduce((sum, score) => sum + (score[side] - baseline[side]) ** 2, 0) / n);
  const awayVariance = variance('away'), homeVariance = variance('home');
  const logWeights = scores.map(score => -0.5 * (
    (score.away - valid.implied.away) ** 2 / awayVariance +
    (score.home - valid.implied.home) ** 2 / homeVariance
  ));
  const maximum = Math.max(...logWeights);
  const marketWeights = logWeights.map(value => Math.exp(value - maximum));
  const totalWeight = marketWeights.reduce((sum, value) => sum + value, 0);
  const weights = marketWeights.map(value => (1 - MARKET_BLEND) / n + MARKET_BLEND * value / totalWeight);
  const effectiveRuns = 1 / weights.reduce((sum, weight) => sum + weight * weight, 0);
  const warnings: string[] = [];
  if (now - valid.recorded > 24 * 60 * 60_000) warnings.push('Odds were recorded more than 24 hours ago; verify the line before running.');
  if (valid.market.source === 'ESPN') warnings.push('Timestamp is the public-feed retrieval time, not a sportsbook publication time or guaranteed live quote.');
  else warnings.push('Manual odds and their recorded-at time are user supplied, not independently verified.');
  if (effectiveRuns < n * 0.6) warnings.push('Market weighting concentrates on fewer outcomes; treat these estimates cautiously.');
  if ((['away', 'home'] as const).some(side => valid.implied[side] < Math.min(...scores.map(score => score[side])) ||
      valid.implied[side] > Math.max(...scores.map(score => score[side])))) {
    warnings.push('A market-implied team score is outside the generated scoring range; this model cannot reproduce that expectation reliably.');
  }
  return {
    weights,
    evidence: {
      source: valid.market.source, provider: valid.market.provider?.trim() || 'Manual entry',
      recordedAt: valid.market.recordedAt!, homeSpread: valid.market.homeSpread!, total: valid.market.total!,
      blend: MARKET_BLEND, implied: valid.implied,
      baseline: { away: rounded(baseline.away), home: rounded(baseline.home) },
      weighted: {
        away: rounded(scores.reduce((sum, score, index) => sum + score.away * weights[index], 0)),
        home: rounded(scores.reduce((sum, score, index) => sum + score.home * weights[index], 0)),
      },
      effectiveRuns: rounded(effectiveRuns), warnings,
    },
  };
}

export function weightedFantasySummary(points: number[], weights: number[]) {
  const sorted = points.map((points, index) => ({ points, weight: weights[index] })).sort((a, b) => a.points - b.points);
  const percentile = (threshold: number) => {
    let cumulative = 0;
    for (const item of sorted) {
      cumulative += item.weight;
      if (cumulative >= threshold) return item.points;
    }
    return sorted[sorted.length - 1].points;
  };
  return {
    mean: rounded(points.reduce((sum, points, index) => sum + points * weights[index], 0)),
    p10: percentile(0.1), p90: percentile(0.9),
  };
}