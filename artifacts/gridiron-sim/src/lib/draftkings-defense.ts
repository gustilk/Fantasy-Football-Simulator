export interface DefenseStats {
  sacks: number; interceptions: number; fumblesRecovered: number; pointsAllowed: number;
  defensiveTD?: number; returnTD?: number; safeties?: number; blockedKicks?: number; conversionReturns?: number;
}
export const defensePointsAllowed = (points: number) => points === 0 ? 10 : points <= 6 ? 7 : points <= 13 ? 4
  : points <= 20 ? 1 : points <= 27 ? 0 : points <= 34 ? -1 : -4;
export function calculateDefenseDraftKings(stats: DefenseStats): number {
  if ([stats.sacks, stats.interceptions, stats.fumblesRecovered, stats.pointsAllowed,
    stats.defensiveTD ?? 0, stats.returnTD ?? 0, stats.safeties ?? 0, stats.blockedKicks ?? 0, stats.conversionReturns ?? 0]
    .some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid DST stats.');
  return stats.sacks + 2 * stats.interceptions + 2 * stats.fumblesRecovered + defensePointsAllowed(stats.pointsAllowed)
    + 6 * ((stats.defensiveTD ?? 0) + (stats.returnTD ?? 0)) + 2 * ((stats.safeties ?? 0) + (stats.blockedKicks ?? 0) + (stats.conversionReturns ?? 0));
}
export const DST_MODEL_WARNING = 'DST estimates include simulated sacks, interceptions, recovered fumbles and points allowed. Defensive/return touchdowns, safeties and blocked kicks are not modeled; these projections are not accuracy-validated.';