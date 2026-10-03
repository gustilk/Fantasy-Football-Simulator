import type { RosterPlayer } from '@workspace/api-client-react';

/** Original approved list. Unlisted players keep their original 1x default. */
export const ELITE_1X_CANDIDATES = [
  ['Josh Allen', 'QB'], ['Lamar Jackson', 'QB'], ['Jalen Hurts', 'QB'],
  ['Jayden Daniels', 'QB'], ['Caleb Williams', 'QB'],
  ['Bijan Robinson', 'RB'], ['Jahmyr Gibbs', 'RB'], ['James Cook III', 'RB'],
  ['Kenneth Walker III', 'RB'], ['Derrick Henry', 'RB'], ['Jonathan Taylor', 'RB'],
  ['Christian McCaffrey', 'RB'],
  ['Chris Olave', 'WR'], ['Jaxon Smith-Njigba', 'WR'], ['Amon-Ra St. Brown', 'WR'],
  ['Davante Adams', 'WR'], ['Garrett Wilson', 'WR'], ['CeeDee Lamb', 'WR'],
  ['Trey McBride', 'TE'], ['Travis Kelce', 'TE'],
] as const;

const nameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\b(jr|sr|iii|ii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
export type EliteTier = NonNullable<RosterPlayer['eliteTier']>;
export const ELITE_TIER_ASSIGNMENTS = [
  ['Lamar Jackson', 'QB', 2], ['Trey McBride', 'TE', 2], ["Ja'Marr Chase", 'WR', 2],
  ['Amon-Ra St. Brown', 'WR', 2], ['Puka Nacua', 'WR', 2], ['CeeDee Lamb', 'WR', 2],
  ['Jahmyr Gibbs', 'RB', 3], ['Brock Bowers', 'TE', 3], ['Bijan Robinson', 'RB', 3],
  ['Jaxon Smith-Njigba', 'WR', 3], ['Josh Allen', 'QB', 3],
  ['Nico Collins', 'WR', 1], ['Zay Flowers', 'WR', 1], ['Parker Washington', 'WR', 1],
  ['Ashton Jeanty', 'RB', 1],
] as const;
export const ELITE_TIER_OPTIONS = [
  { value: 0, label: 'None' }, { value: 1, label: '1x · +20%' },
  { value: 2, label: '2x · +40%' }, { value: 3, label: '3x · +60%' },
] as const;
type ElitePlayer = { name: string; position: string; side?: string; elite1x?: boolean; eliteTier?: EliteTier };
const matchingName = (name: string) => {
  const key = nameKey(name);
  return key === 'jamarchase' ? 'jamarrchase' : key;
};

export function assignedEliteTier(player: { name: string; position: string }): EliteTier | undefined {
  return ELITE_TIER_ASSIGNMENTS.find(([name, position]) =>
    position === player.position && matchingName(name) === matchingName(player.name))?.[2];
}

export function getEliteTier(player: ElitePlayer): EliteTier {
  if ((player.side !== undefined && player.side !== 'offense') ||
      !['QB', 'RB', 'WR', 'TE'].includes(player.position)) return 0;
  if (player.eliteTier !== undefined) return player.eliteTier;
  if (player.elite1x === false) return 0;
  const assigned = assignedEliteTier(player);
  if (assigned !== undefined) return assigned;
  return player.elite1x || ELITE_1X_CANDIDATES.some(([name, position]) =>
    position === player.position && nameKey(name) === nameKey(player.name)) ? 1 : 0;
}

export function isElite1x(player: ElitePlayer): boolean {
  return getEliteTier(player) > 0;
}

/** Historical results use stored metadata only, never today's defaults. */
export function savedEliteTier(player: { eliteTier?: EliteTier; elite1x?: boolean }): EliteTier {
  return player.eliteTier ?? (player.elite1x ? 1 : 0);
}

/** Multiply selection weights, never points, efficiency, or eligibility. */
export function eliteOpportunityWeight(weight: number, tier: EliteTier | boolean): number {
  const level = typeof tier === 'boolean' ? (tier ? 1 : 0) : tier;
  return weight * [1, 1.2, 1.4, 1.6][level]!;
}