export type DefenderTier = 0 | 1 | 2;
export type TeamDefenseTier = 0 | 1;
export const DEFENSIVE_POSITIONS = ['DL', 'EDGE', 'LB', 'CB', 'S'] as const;
export type DefensivePosition = typeof DEFENSIVE_POSITIONS[number];
export const DEFENDER_ASSIGNMENTS = [
  ['Myles Garrett', 2], ['Will Anderson Jr.', 2], ['Micah Parsons', 2],
  ['Maxx Crosby', 2], ['Danielle Hunter', 2], ['Aidan Hutchinson', 2], ['T.J. Watt', 2],
  ['Pat Surtain II', 1], ['Fred Warner', 1], ['Kyle Hamilton', 1],
  ['Devon Witherspoon', 1], ['Josh Hines-Allen', 1],
] as const;
export const TEAM_DEFENSE_ASSIGNMENTS = [
  'Houston Texans', 'Seattle Seahawks', 'Los Angeles Rams', 'Denver Broncos', 'Baltimore Ravens',
] as const;
export const DEFENDER_TIER_OPTIONS = [
  { value: 0, label: 'None' }, { value: 1, label: '1x · +20%' }, { value: 2, label: '2x · +40%' },
] as const;
const nameKey = (name: string) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\bjr\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const defaults = new Map<string, DefenderTier>(DEFENDER_ASSIGNMENTS.map(([name, tier]) => [nameKey(name), tier]));
export function isDefensivePosition(position: string): position is DefensivePosition {
  return (DEFENSIVE_POSITIONS as readonly string[]).includes(position);
}
export function getDefenderTier(player: { name: string; position: string; side?: string; defensiveTier?: DefenderTier }): DefenderTier {
  if (player.side === 'offense' || !isDefensivePosition(player.position)) return 0;
  return player.defensiveTier ?? defaults.get(nameKey(player.name)) ?? 0;
}
export function getTeamDefenseTier(team: { team: string; defenseTier?: TeamDefenseTier | null }): TeamDefenseTier {
  return team.defenseTier ?? ((TEAM_DEFENSE_ASSIGNMENTS as readonly string[]).includes(team.team) ? 1 : 0);
}
export interface SimulationDefender {
  id: string; name: string; position: DefensivePosition; defensiveTier: DefenderTier;
  active?: boolean; recentStats?: Partial<Record<'sacks' | 'interceptions' | 'fumblesForced' | 'passesDefended', number>>;
}
export type DefenseEvent = 'sacks' | 'interceptions' | 'fumblesForced' | 'passesDefended' | 'runStops';
const roleWeights = {
  rush: { sacks: 1, interceptions: 0, fumblesForced: 1, passesDefended: 0, runStops: 0.8 },
  linebacker: { sacks: 0.35, interceptions: 0.5, fumblesForced: 0.7, passesDefended: 0.6, runStops: 1 },
  secondary: { sacks: 0, interceptions: 1, fumblesForced: 0.35, passesDefended: 1, runStops: 0.2 },
} as const;
/** Aggregate role-weighted priority, not individual fantasy scoring.
 * Known observed zeroes stay zero; only unknown stats use explicit heuristic role priors.
 * Team and player bonuses add (1x team + 2x sole contributor = 1.60), never compound.
 * Defaults resolve when creating NEW inputs; missing snapshot fields remain neutral. */
export function defensiveEventPriorities(setup: { defenseTier?: TeamDefenseTier; defenders?: SimulationDefender[] }): Record<DefenseEvent, number> {
  if (setup.defenseTier !== undefined && setup.defenseTier !== 0 && setup.defenseTier !== 1) throw new Error('Invalid team defense tier.');
  const players = (setup.defenders ?? []).filter(p => p.active !== false);
  const ids = new Set<string>();
  for (const p of players) {
    if (!p.id || ids.has(p.id) || !isDefensivePosition(p.position) || ![0, 1, 2].includes(p.defensiveTier)
      || [p.recentStats?.sacks, p.recentStats?.interceptions, p.recentStats?.fumblesForced, p.recentStats?.passesDefended]
        .some(n => n !== undefined && (!Number.isFinite(n) || n < 0))) throw new Error('Invalid defensive roster or tier.');
    ids.add(p.id);
  }
  const events: DefenseEvent[] = ['sacks', 'interceptions', 'fumblesForced', 'passesDefended', 'runStops'];
  return Object.fromEntries(events.map(event => {
    let weight = 0, bonus = 0;
    for (const p of players) {
      const key = nameKey(p.name);
      const role = p.position === 'EDGE' || p.position === 'DL' || key === 'tjwatt' || key === 'micahparsons'
        ? roleWeights.rush : p.position === 'LB' ? roleWeights.linebacker : roleWeights.secondary;
      if (!role[event]) continue;
      const observed = event === 'runStops' ? undefined : p.recentStats?.[event];
      const opportunity = observed ?? role[event];
      weight += opportunity; bonus += opportunity * p.defensiveTier * 0.2;
    }
    return [event, 1 + (setup.defenseTier ?? 0) * 0.2 + (weight ? bonus / weight : 0)];
  })) as Record<DefenseEvent, number>;
}
export const DEFENSE_TIER_WARNING = 'Defensive tiers are uncalibrated, role-weighted tendencies for sacks, turnovers, pass breakups and run stops—not fantasy-point multipliers or guaranteed event increases. Team and player bonuses add; existing probability limits still apply. Unknown individual event histories use role priors; unavailable players contribute no bonus. Rerun and save forecasts after changes; saved forecasts retain their original inputs.';