import type { SalaryPlayer } from './lineups';

/** Use the football player identity, not a Captain/FLEX-specific DraftKings ID. */
export function exclusionKey(player: Pick<SalaryPlayer, 'team' | 'name'>) {
  return `${player.team}:${player.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '')}`;
}

export function applyLineupExclusions<T extends Pick<SalaryPlayer, 'team' | 'name'>>(players: T[], excluded: ReadonlySet<string>): T[] {
  return players.filter(player => !excluded.has(exclusionKey(player)));
}

export function exclusionScope(season: number, format: string, players: Pick<SalaryPlayer, 'gameInfo'>[]) {
  return `gridiron-lineup-exclusions-v1:${JSON.stringify([season, format,
    [...new Set(players.map(p => p.gameInfo.trim().toUpperCase()))].sort()])}`;
}
