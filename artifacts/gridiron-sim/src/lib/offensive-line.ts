import type { TeamSeasonRecord } from '@workspace/api-client-react';

export type OffensiveLineTier = NonNullable<TeamSeasonRecord['offensiveLineTier']>;

/** Resolve current preferences only while building NEW inputs, never in replay. */
export function getOffensiveLineTier(team: { team: string; offensiveLineTier?: OffensiveLineTier | null }): OffensiveLineTier {
  return team.offensiveLineTier ?? (team.team === 'San Francisco 49ers' ? 1.5 : 0);
}

/** The approved 1.5x setting is a 30% conditional sack-risk reduction.
 * Apply AFTER defensive matchup/priorities/caps, without another lower clamp.
 * Missing frozen inputs stay exactly neutral; no new random draws. */
export function protectedSackProbability(probability: number, tier: OffensiveLineTier = 0): number {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Invalid sack probability.');
  if (tier !== 0 && tier !== 1.5) throw new Error('Unsupported offensive-line protection tier.');
  return tier === 1.5 ? probability * 0.7 : probability;
}
