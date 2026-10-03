export const FANTASY_POSITION_GROUPS = [
  { position: 'QB', label: 'QB' },
  { position: 'WR', label: 'Receivers' },
  { position: 'RB', label: 'RB' },
  { position: 'TE', label: 'Tight End' },
] as const;

/** Uses example-game DK points, not ensemble-average projections. */
export function groupFantasyLeaders<T extends { position: string; draftKings: number }>(players: readonly T[]) {
  return FANTASY_POSITION_GROUPS.map(group => ({
    ...group,
    players: players
      .filter(player => player.position === group.position && Number.isFinite(player.draftKings) && player.draftKings >= 20)
      .sort((a, b) => b.draftKings - a.draftKings),
  }));
}