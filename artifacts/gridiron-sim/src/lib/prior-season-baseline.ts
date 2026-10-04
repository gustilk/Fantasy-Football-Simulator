import data from '../data/baseline-2025.json' with { type: 'json' };
import type { NumericStats, RosterPlayer } from '@workspace/api-client-react';

export const PRIOR_GAMES = 3;
type HistoricalRecord = { games: number; starts?: number; stats: NumericStats; samples: Record<string, number> };
export type HistoricalPlayer = { id: string; name: string; positions: string[]; teams: Record<string, HistoricalRecord> };
export type HistoricalTeam = {
  name: string; offense: NumericStats; defense: NumericStats;
  defenseVsPosition: Record<string, { games: number; total: number; perGame: number }>;
};
export const baseline2025 = data as unknown as {
  season: number; seasonType: string; retrievedAt: string;
  sources: { name: string; url: string; sha256: string; rows: number; use: string }[];
  players: HistoricalPlayer[]; teams: Record<string, HistoricalTeam>;
};
export interface PriorSeasonEvidence {
  season: number; policy: 'three-game-prior-v1'; retrievedAt: string;
  effectivePriorGames: number; matchedPlayers: string[];
  unmatchedPlayers: string[]; teamChangedPlayers: string[];
}
export const normalizePlayerName = (name: string) => name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const byName = new Map<string, HistoricalPlayer[]>();
for (const player of baseline2025.players) {
  const key = normalizePlayerName(player.name);
  byName.set(key, [...(byName.get(key) ?? []), player]);
}
export function priorTeam(season: number, name: string) {
  if (season !== baseline2025.season + 1) return undefined;
  const entry = Object.entries(baseline2025.teams).find(([, team]) => team.name === name);
  return entry ? { code: entry[0], ...entry[1] } : undefined;
}
const groups: Record<string, string[]> = {
  QB: ['QB'], RB: ['RB', 'FB'], WR: ['WR'], TE: ['TE'], K: ['K'], P: ['P'],
  EDGE: ['DE', 'OLB', 'LB', 'DL'], DL: ['DT', 'NT', 'DE', 'DL'],
  LB: ['LB', 'ILB', 'MLB', 'OLB'], CB: ['CB', 'DB'], S: ['S', 'FS', 'SS', 'DB'],
};
/** Exact normalized identity AND compatible position; no fuzzy guessed matches. */
export function matchPriorPlayer(player: Pick<RosterPlayer, 'name' | 'position'>): HistoricalPlayer | undefined {
  const compatible = groups[player.position] ?? [player.position];
  const candidates = (byName.get(normalizePlayerName(player.name)) ?? [])
    .filter(candidate => candidate.positions.some(position => compatible.includes(position)));
  return candidates.length === 1 ? candidates[0] : undefined;
}
export function priorPlayer(season: number, teamName: string, player: Pick<RosterPlayer, 'name' | 'position' | 'depthRank'>) {
  const team = priorTeam(season, teamName);
  const matched = team ? matchPriorPlayer(player) : undefined;
  const record = team && matched?.teams[team.code];
  // A new QB1 who was mostly a backup last season needs current QB1 evidence,
  // not last year's tiny per-appearance attempt count as a starting workload.
  const changedQBRole = player.position === 'QB' && player.depthRank === 1 && record &&
    record.starts !== undefined && record.starts < record.games / 2;
  return { matched, record: changedQBRole ? undefined : record,
    teamChanged: !!matched && !record, roleChanged: !!changedQBRole };
}
const present = (value: number | undefined): value is number => typeof value === 'number' && Number.isFinite(value);
export const priorWeight = (observations: number, priorObservations = PRIOR_GAMES) =>
  priorObservations > 0 ? priorObservations / (Math.max(0, observations) + priorObservations) : 0;

export function blendPriorStats(current: NumericStats, rows: NumericStats[], record?: HistoricalRecord): NumericStats {
  if (!record) return current;
  const blended = { ...current };
  for (const [key, total] of Object.entries(record.stats)) {
    const samples = record.samples[key];
    if (!present(total) || !samples) continue;
    const historical = total / samples;
    const observations = rows.filter(row => present(row[key])).length;
    const weight = priorWeight(observations, Math.min(PRIOR_GAMES, samples));
    blended[key] = present(current[key]) ? current[key]! * (1 - weight) + historical * weight : historical;
  }
  for (const [made, attempts] of [['passCompletions', 'passAttempts'], ['receptions', 'targets']] as const) {
    if (!present(record.stats[made]) || !present(record.stats[attempts])) continue;
    const samples = record.samples[made];
    if (!samples || samples !== record.samples[attempts]) continue;
    const paired = rows.filter(row => present(row[made]) && present(row[attempts]) && row[made]! <= row[attempts]!);
    const weight = priorWeight(paired.length, Math.min(PRIOR_GAMES, samples));
    for (const key of [made, attempts]) {
      blended[key] = paired.length && present(current[made]) && present(current[attempts])
        ? current[key]! * (1 - weight) + record.stats[key]! / samples * weight : record.stats[key]! / samples;
    }
    // Contradictory input averages cannot establish a valid success rate.
    if (blended[made]! > blended[attempts]!) {
      blended[made] = record.stats[made]! / samples;
      blended[attempts] = record.stats[attempts]! / samples;
    }
  }
  return blended;
}

export function priorDefenderRecord(record?: HistoricalRecord): HistoricalRecord | undefined {
  if (!record) return undefined;
  return { ...record, stats: { ...record.stats, interceptions: record.stats.defensiveInterceptions },
    samples: { ...record.samples, interceptions: record.samples.defensiveInterceptions! } };
}

export function blendPriorUsage(
  current: { targetShare: number | undefined; targetGames: number; carryShare: number | undefined; carryGames: number },
  team?: ReturnType<typeof priorTeam>, record?: HistoricalRecord,
) {
  if (!team || !record) return current;
  const result = { ...current };
  for (const [stat, share, samples, total] of [
    ['targets', 'targetShare', 'targetGames', 'targets'],
    ['rushAttempts', 'carryShare', 'carryGames', 'rushAttempts'],
  ] as const) {
    const games = record.samples[stat];
    const seasonTotal = team.offense[total], teamGames = team.offense.games;
    if (!games || !present(record.stats[stat]) || !seasonTotal || !teamGames) continue;
    const observedPrior = Math.min(PRIOR_GAMES, games);
    const historicalShare = Math.max(0, Math.min(1, (record.stats[stat]! / games) / (seasonTotal / teamGames)));
    const weight = priorWeight(current[samples], observedPrior);
    result[share] = present(current[share]) ? current[share]! * (1 - weight) + historicalShare * weight : historicalShare;
    // These are effective observations, not fabricated 2026 game rows.
    result[samples] = current[samples] + observedPrior;
  }
  return result;
}

export function priorBackfieldEvidence(record?: HistoricalRecord) {
  const paired = (attempts: string, yards: string) => {
    const samples = record?.samples[attempts];
    if (!record || !samples || record.samples[yards] !== samples || !present(record.stats[attempts]) || !present(record.stats[yards])) return { attempts: 0, yards: 0 };
    const scale = Math.min(PRIOR_GAMES, samples) / samples;
    return { attempts: record.stats[attempts]! * scale, yards: record.stats[yards]! * scale };
  };
  const rush = paired('rushAttempts', 'rushYards'), receiving = paired('receptions', 'receivingYards');
  return { rushAttempts: rush.attempts, rushYards: rush.yards, receivingCatches: receiving.attempts, receivingYards: receiving.yards };
}

export function priorTeamStrength(team: NonNullable<ReturnType<typeof priorTeam>>) {
  const rating = (value: number, reference: number, games: number, direction = 1) =>
    Math.round(Math.max(35, Math.min(75, 55 + direction * (value / reference - 1) * 30 * games / (games + 5))));
  const { offense, defense } = team;
  // Team passing yards are net of sacks, unlike player passing yards. Use
  // paired QB totals instead of mixing those definitions.
  const passers = baseline2025.players.filter(player => player.positions.includes('QB')).map(player => player.teams[team.code]);
  const paired = passers.filter(record => record?.stats.passAttempts && present(record.stats.passYards));
  const passAttempts = paired.reduce((sum, record) => sum + record.stats.passAttempts!, 0);
  const passYards = paired.reduce((sum, record) => sum + record.stats.passYards!, 0);
  return {
    passRating: passAttempts > 0 ? rating(passYards / passAttempts, 7, offense.games!) : undefined,
    rushRating: offense.rushAttempts ? rating(offense.rushYards! / offense.rushAttempts, 4.3, offense.games!) : undefined,
    passDefenseRating: present(defense.passYardsAllowed) ? rating(defense.passYardsAllowed / defense.games!, 225, defense.games!, -1) : undefined,
    rushDefenseRating: present(defense.rushYardsAllowed) ? rating(defense.rushYardsAllowed / defense.games!, 115, defense.games!, -1) : undefined,
    defenseRating: present(defense.passYardsAllowed) && present(defense.rushYardsAllowed) ? Math.round(
      (rating(defense.passYardsAllowed / defense.games!, 225, defense.games!, -1) +
        rating(defense.rushYardsAllowed / defense.games!, 115, defense.games!, -1)) / 2) : undefined,
  };
}

export function priorDefenseRecord(team: NonNullable<ReturnType<typeof priorTeam>>): HistoricalRecord {
  const keys = ['passYardsAllowed', 'passTDAllowed', 'rushYardsAllowed', 'rushTDAllowed', 'interceptions', 'sacks'];
  const stats = Object.fromEntries(keys.filter(key => present(team.defense[key])).map(key => [key, team.defense[key]!]));
  return { games: team.defense.games!, stats, samples: Object.fromEntries(Object.keys(stats).map(key => [key, team.defense.games!])) };
}