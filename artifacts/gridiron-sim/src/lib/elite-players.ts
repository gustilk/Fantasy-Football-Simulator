/** User-approved starting list, researched October 3, 2026. Not a live ranking. */
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
type ElitePlayer = { name: string; position: string; side?: string; elite1x?: boolean };

export function isElite1x(player: ElitePlayer): boolean {
  if ((player.side !== undefined && player.side !== 'offense') ||
      !['QB', 'RB', 'WR', 'TE'].includes(player.position)) return false;
  if (player.elite1x !== undefined) return player.elite1x;
  return ELITE_1X_CANDIDATES.some(([name, position]) =>
    position === player.position && nameKey(name) === nameKey(player.name));
}

/** Multiply selection weights, never points, efficiency, or eligibility. */
export function eliteOpportunityWeight(weight: number, elite1x: boolean): number {
  return weight * (elite1x ? 1.2 : 1);
}