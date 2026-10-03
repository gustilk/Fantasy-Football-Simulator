/**
 * Read-only evidence audit. Never backfills odds, treats current rosters as
 * historical eligibility, runs a claimed accuracy backtest, or writes teams.
 * Usage: tsx src/market-history-audit.ts <teams-json> <season> [schedule-json]
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TeamSeasonRecord, NflSchedule } from '../../lib/api-client-react/src/generated/api.schemas';
import { ListSeasonTeamsResponse, GetNflScheduleResponse } from '../../lib/api-zod/src/generated/api';
import { auditHistory } from './h2h-history-audit';

export function auditMarketHistory(teams: TeamSeasonRecord[], season: number, schedule?: NflSchedule, now = Date.now()) {
  const history = auditHistory(teams, season);
  if (schedule && schedule.season !== season) throw new Error('Schedule belongs to a different season.');
  const groups = Object.values(history.counts);
  const sum = (field: keyof typeof history.counts.divisional) =>
    groups.reduce((count, group) => count + (typeof group[field] === 'number' ? group[field] as number : 0), 0);
  const sourceIds = new Set(teams.flatMap(team => team.weeks
    .filter(game => game.status === 'played' && game.source?.eventId)
    .map(game => game.source!.eventId!)));
  const upcoming = schedule?.games.filter(game => Number.isFinite(Date.parse(game.date)) && Date.parse(game.date) > now) ?? [];
  const quoteCount = upcoming.filter(game => {
    const quote = game.odds;
    return quote && Number.isFinite(quote.homeSpread) && Number.isFinite(quote.total) &&
      Math.abs(quote.homeSpread) <= 40 && quote.total >= 10 && quote.total <= 100 && quote.total > Math.abs(quote.homeSpread);
  }).length;
  return {
    kind: 'evidence-feasibility-audit' as const,
    season,
    saved: {
      teams: history.savedTeams,
      teamGameRows: history.teamGameRows,
      uniqueGames: sum('savedGames'),
      uniqueSourceEventIds: sourceIds.size,
      missingCounterpartGames: sum('missingCounterpart'),
      conflictingCounterpartGames: sum('conflictingCounterpart'),
      pairedGames: sum('savedGames') - sum('missingCounterpart') - sum('conflictingCounterpart'),
      scoredGamesWithPriorHistoryBothTeams: sum('scoredHeldOutGames'),
      gamesWithThreePriorGamesBothTeams: sum('withThreePriorGamesBothTeams'),
      priorSeenObservedPlayerRows: sum('priorSeenPlayerRows'),
      completeDraftKingsTargetRows: sum('completeDkPlayerRows'),
      currentAvailabilityReportRows: teams.reduce((count, team) => count + team.players.filter(player => player.availabilityReport).length, 0),
      currentAvailabilityOverrideRows: teams.reduce((count, team) => count + team.players.filter(player => player.availabilityOverride).length, 0),
    },
    upcoming: schedule ? {
      games: upcoming.length,
      usablePublicQuotes: quoteCount,
      missingPublicQuotes: upcoming.length - quoteCount,
      sourceFetchedAt: schedule.fetchedAt,
      historicalAccuracyEvidence: false,
    } : null,
    archivedEvidence: {
      // These are capabilities of the inspected storage contract, not a claim
      // that no independently archived dataset exists elsewhere.
      historicalPregameOddsSnapshots: 'not stored in Team Library',
      independentlyArchivedPregameEligibility: 'not stored in Team Library',
      immutablePregameInputSnapshots: 'not stored in Team Library',
      sportsbookPublicationTimes: 'not supplied by current public schedule quotes',
    },
    eligibleAccuracyComparisons: 0,
    metrics: null,
    exclusions: [
      'Current/future odds cannot stand in for independently archived pregame odds.',
      'Current active flags, depth ranks, availability reports and retrospective overrides cannot establish historical pregame eligibility.',
      'Prior-week history cutoffs do not prove that imported statistics or inputs were available at the prediction time.',
      'Missing DraftKings scoring components and absent player rows remain unknown, not zero.',
      'No baseline/market accuracy metrics can be computed from this evidence contract.',
    ],
    conclusion: 'Insufficient point-in-time evidence. Keep the experimental market weight unchanged; collect immutable pregame quotes, eligibility and input snapshots before measuring accuracy.',
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [teamPath, requestedSeason, schedulePath] = process.argv.slice(2);
  if (!teamPath || !requestedSeason) throw new Error('Usage: market-history-audit.ts <teams-json> <season> [schedule-json]');
  const rawTeams = readFileSync(teamPath, 'utf8');
  const teams: TeamSeasonRecord[] = JSON.parse(JSON.stringify(ListSeasonTeamsResponse.parse(JSON.parse(rawTeams))));
  const schedule: NflSchedule | undefined = schedulePath
    ? JSON.parse(JSON.stringify(GetNflScheduleResponse.parse(JSON.parse(readFileSync(schedulePath, 'utf8')))))
    : undefined;
  console.log(JSON.stringify({
    auditedAt: new Date().toISOString(),
    librarySnapshotSha256: createHash('sha256').update(rawTeams).digest('hex'),
    ...auditMarketHistory(teams, Number(requestedSeason), schedule),
  }, null, 2));
}