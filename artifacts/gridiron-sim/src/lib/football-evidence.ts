import type { NflAdvancedPlayer, NflAdvancedReport, TeamSeasonRecord } from '@workspace/api-client-react';
import { setupFromHistory } from './season-model';
import type { TeamSetup } from './simulator';
import type { PossessionRates } from './possession-drive';
import type { SecondaryEvidence } from './secondary-matchup';

export interface FootballPlayerEvidence {
  targetShare?: number; carryShare?: number; snapShare?: number; airYardsPerTarget?: number;
  redZoneTargetShare?: number; goalLineCarryShare?: number; observations: number;
}
export interface FootballEvidence {
  version: 'football-v2';
  passDefenseRating: number; rushDefenseRating: number;
  dropbackShare?: number; playsPerGame?: number;
  driveOffense?: PossessionRates; driveDefense?: PossessionRates;
  secondaryOffense?: SecondaryEvidence; secondaryDefense?: SecondaryEvidence;
  passEpaAllowed?: number; rushEpaAllowed?: number; sackRate?: number; nonSackHitRate?: number;
  passSamples: number; rushSamples: number;
  positionMatchups: Record<string, { delta: number; samples: number }>;
  sources: { season: number; games: number; weeks: number[]; fetchedAt: string; status: string; urls: string[] }[];
  warnings: string[]; matchedPlayers: number;
}
export interface FootballReports { current?: NflAdvancedReport; prior?: NflAdvancedReport; issues: string[] }
const known = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const bound = (n: number, low: number, high: number) => Math.max(low, Math.min(high, n));
/** Prior season contributes at most three game-equivalents, never synthetic
 * current-season games. Missing fields are excluded from each denominator. */
export function footballBlend(current: number | null | undefined, prior: number | null | undefined, n: number, p: number): number | undefined {
  const currentWeight = known(current) ? Math.max(0, n) : 0;
  const priorWeight = known(prior) ? Math.min(3, Math.max(0, p)) : 0;
  return currentWeight + priorWeight > 0
    ? ((known(current) ? current * currentWeight : 0) + (known(prior) ? prior * priorWeight : 0)) / (currentWeight + priorWeight) : undefined;
}
function match(report: NflAdvancedReport | undefined, id: string, position: string) {
  const rows = report?.players.filter(p => p.playerId === id && p.position === position);
  return rows?.length === 1 ? rows[0] : undefined;
}
function playerEvidence(current?: NflAdvancedPlayer, prior?: NflAdvancedPlayer): FootballPlayerEvidence {
  const value = (field: keyof NflAdvancedPlayer, snap = false, air = false) =>
    footballBlend(current?.[field] as number | null | undefined, prior?.[field] as number | null | undefined,
      air ? (current?.airYardTargets ?? 0) : snap ? current?.snapGames ?? 0 : current?.opportunityGames ?? 0,
      air ? Math.min(3, (prior?.airYardTargets ?? 0) / 6) : snap ? prior?.snapGames ?? 0 : prior?.opportunityGames ?? 0);
  return { targetShare: value('targetShare'), carryShare: value('carryShare'), snapShare: value('snapShare', true),
    airYardsPerTarget: value('airYardsPerTarget', false, true), redZoneTargetShare: value('redZoneTargetShare'),
    goalLineCarryShare: value('goalLineCarryShare'), observations: (current?.opportunityGames ?? 0) + Math.min(3, prior?.opportunityGames ?? 0) };
}
export function footballSetup(team: TeamSeasonRecord, week: number, venue: 'home' | 'away', opponent: string, reports: FootballReports): TeamSetup {
  const base = setupFromHistory(team, week, venue, opponent, { recentWindow: 4 });
  const eligible = (report: NflAdvancedReport | undefined, season: number, cutoff: number, maxGames: number) =>
    report && report.season === season && report.team === team.team && report.beforeWeek === cutoff &&
    report.status !== 'unavailable' && report.games <= maxGames && report.games > 0 &&
    (report.dataThroughWeek ?? 99) < cutoff && report.sampleWeeks?.length === report.games &&
    report.sampleWeeks.every(w => Number.isInteger(w) && w > 0 && w < cutoff) ? report : undefined;
  const current = eligible(reports.current, team.season, week, 4);
  const prior = eligible(reports.prior, team.season - 1, 19, 18);
  const n = current?.games ?? 0, p = prior?.games ?? 0;
  const secondaryEvidence = (side: 'offense' | 'defense'): SecondaryEvidence => ({
    current: current?.[side]?.passingDepth, prior: prior?.[side]?.passingDepth,
    season: team.season, weeks: current ? [...current.sampleWeeks!] : [],
    priorSeason: prior?.season,
  });
  const driveEvidence = (side: 'offense' | 'defense'): PossessionRates => {
    const result: PossessionRates = {};
    for (const key of ['successRate', 'explosivePlayRate', 'redZoneTdRate'] as const) {
      const sample = key === 'successRate' ? 'successSamples' : key === 'explosivePlayRate' ? 'explosiveSamples' : 'redZoneTrips';
      const read = (report?: NflAdvancedReport) => side === 'offense' ? report?.offense?.[key]
        : key === 'successRate' ? report?.defense.successRateAllowed
        : key === 'explosivePlayRate' ? report?.defense.explosivePlayRateAllowed : report?.defense.redZoneTdRateAllowed;
      const a = read(current), b = read(prior);
      const count = (report?: NflAdvancedReport) => (side === 'offense' ? report?.offense?.[sample] : report?.defense[sample]) ?? 0;
      const ca = known(a) ? count(current) : 0;
      // Separate, capped prior evidence: approximately three games, not a
      // synthetic addition to the current-season game count.
      const cb = known(b) ? Math.min(key === 'redZoneTdRate' ? 12 : 180, count(prior)) : 0;
      result[sample] = ca + cb;
      if (ca + cb > 0) result[key] = ((known(a) ? a * ca : 0) + (known(b) ? b * cb : 0)) / (ca + cb);
    }
    return result;
  };
  const blend = (a: number | null | undefined, b: number | null | undefined) => footballBlend(a, b, n, p);
  const passSamples = (current?.defense.passEpaPlays ?? 0) + Math.min(150, prior?.defense.passEpaPlays ?? 0);
  const rushSamples = (current?.defense.rushEpaPlays ?? 0) + Math.min(100, prior?.defense.rushEpaPlays ?? 0);
  const passEpaAllowed = blend(current?.defense.passEpaAllowed, prior?.defense.passEpaAllowed);
  const rushEpaAllowed = blend(current?.defense.rushEpaAllowed, prior?.defense.rushEpaAllowed);
  // Replace/average efficiency estimates; never stack EPA on top of the same
  // yards-based efficiency as an additional fantasy-point multiplier.
  const rating = (old: number, epa: number | undefined, samples: number, defense = false) =>
    epa === undefined ? old : bound(old * (1 - Math.min(0.65, samples / (samples + 150))) +
      bound(55 + epa * (defense ? -35 : 35), 30, 80) * Math.min(0.65, samples / (samples + 150)), 30, 80);
  const passYardsRating = base.defenseRecent?.passYardsAllowed === undefined ? base.defenseRating
    : bound(55 - (base.defenseRecent.passYardsAllowed / 225 - 1) * 30, 35, 75);
  const rushYardsRating = base.defenseRecent?.rushYardsAllowed === undefined ? base.defenseRating
    : bound(55 - (base.defenseRecent.rushYardsAllowed / 115 - 1) * 30, 35, 75);
  const sackRate = blend(current?.defense.sackRate, prior?.defense.sackRate);
  const hits = blend(current?.defense.sackHitRate, prior?.defense.sackHitRate);
  const warnings = [...reports.issues];
  const receivingEpa = blend(current?.defense.receivingEpaAllowed, prior?.defense.receivingEpaAllowed);
  const positionMatchups: FootballEvidence['positionMatchups'] = {};
  for (const position of ['RB', 'WR', 'TE']) {
    const epa = blend(current?.defense.positionEpaAllowed?.[position], prior?.defense.positionEpaAllowed?.[position]);
    const samples = (current?.defense.positionEpaSamples?.[position] ?? 0) + Math.min(20, prior?.defense.positionEpaSamples?.[position] ?? 0);
    if (epa !== undefined && receivingEpa !== undefined && samples >= 10) positionMatchups[position] = { delta: epa - receivingEpa, samples };
  }
  if (!current) warnings.push(`${team.season} last-four play-by-play unavailable or ineligible; only known box-score history and eligible prior evidence can contribute.`);
  if (!prior) warnings.push(`${team.season - 1} play-by-play unavailable or ineligible; no guessed prior advanced data.`);
  if (current?.status === 'partial' || prior?.status === 'partial') warnings.push('Advanced coverage is partial; only verified fields and uniquely identified players are used.');
  let matchedPlayers = 0;
  const roster = base.roster?.map(player => {
    const now = match(current, player.id, player.position);
    const candidate = match(prior, player.id, player.position);
    // Backup appearances aren't a starter workload prior. Unlike team-level
    // scheme/efficiency, individual QB opportunities require compatible roles.
    const old = player.position !== 'QB' || (base.quarterbackStrategy?.backup === false && (candidate?.snapShare ?? 0) >= 0.55)
      ? candidate : undefined;
    if (!now && !old) return player;
    matchedPlayers++;
    return { ...player, football: playerEvidence(now, old) };
  });
  if (matchedPlayers < (roster?.length ?? 0)) warnings.push(`${matchedPlayers}/${roster?.length ?? 0} eligible offensive players have unique advanced-stat matches. Unmatched players retain box-score/depth-chart evidence, not guessed PBP identities.`);
  const evidence: FootballEvidence = { version: 'football-v2',
    passDefenseRating: rating(passYardsRating, passEpaAllowed, passSamples, true),
    rushDefenseRating: rating(rushYardsRating, rushEpaAllowed, rushSamples, true),
    passEpaAllowed, rushEpaAllowed, sackRate,
    nonSackHitRate: hits !== undefined && sackRate !== undefined ? Math.max(0, hits - sackRate) : undefined,
    passSamples, rushSamples, positionMatchups, dropbackShare: blend(current?.offense?.dropbackShare, prior?.offense?.dropbackShare),
    playsPerGame: blend(current?.offense?.playsPerGame, prior?.offense?.playsPerGame),
    driveOffense: driveEvidence('offense'), driveDefense: driveEvidence('defense'),
    secondaryOffense: secondaryEvidence('offense'), secondaryDefense: secondaryEvidence('defense'),
    sources: [current, prior].filter((r): r is NflAdvancedReport => !!r).map(r => ({
      season: r.season, games: r.games, weeks: [...r.sampleWeeks!], fetchedAt: r.fetchedAt, status: r.status, urls: r.sources.map(s => s.url),
    })), warnings, matchedPlayers };
  return { ...base, roster, footballEvidence: evidence,
    modelEvidence: base.modelEvidence ? { ...base.modelEvidence, warnings: base.modelEvidence.warnings.map(w => w.replace(/recent-five/g, 'recent-four')) } : undefined,
    passRating: rating(base.passRating, blend(current?.offense?.passEpa, prior?.offense?.passEpa), (current?.offense?.passSamples ?? 0) + Math.min(150, prior?.offense?.passSamples ?? 0)),
    rushRating: rating(base.rushRating, blend(current?.offense?.rushEpa, prior?.offense?.rushEpa), (current?.offense?.rushSamples ?? 0) + Math.min(100, prior?.offense?.rushSamples ?? 0)),
    context: base.context.replace('recent-five', 'recent-four') + ' Football evidence model: recent four completed games, separate prior season, passing/rushing matchup ratings, PBP workload and efficiency. Heuristic mappings; improved accuracy is not yet established.' };
}
