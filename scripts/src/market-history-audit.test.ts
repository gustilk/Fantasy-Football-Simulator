import assert from 'node:assert/strict';
import type { TeamSeasonRecord, NflSchedule } from '../../lib/api-client-react/src/generated/api.schemas';
import { auditMarketHistory } from './market-history-audit';
import { dkFields } from './h2h-history-audit';

const makeTeam = (team: string, opponent: string, venue: 'away' | 'home'): TeamSeasonRecord => ({
  season: 2026, team, version: 1,
  players: [{ id: 'qb', name: 'QB', position: 'QB', side: 'offense', active: true }],
  weeks: [1, 2].map(week => ({
    week, status: 'played', opponent, venue, result: 'T', teamScore: 21, opponentScore: 21,
    playerStats: { qb: { passYards: 200, passTD: 1 } }, teamDefense: {},
    source: { provider: 'ESPN', eventId: `event-${week}`, url: 'https://www.espn.com/nfl/', fetchedAt: '2026-10-03T12:00:00Z' },
  })),
});
const teams = [
  makeTeam('Los Angeles Rams', 'Seattle Seahawks', 'away'),
  makeTeam('Seattle Seahawks', 'Los Angeles Rams', 'home'),
];
const schedule: NflSchedule = {
  season: 2026, fetchedAt: '2026-10-03T12:00:00Z', sourceUrl: 'https://www.espn.com/nfl/schedule', unannouncedGames: 0,
  games: [
    { id: 'upcoming', date: '2026-10-04T17:00:00Z', awayTeam: teams[0].team, homeTeam: teams[1].team, week: 4, seasonType: 'regular', timeConfirmed: true, odds: { homeSpread: -6, total: 48, provider: 'Public book' } },
    { id: 'missing-quote', date: '2026-10-11T17:00:00Z', awayTeam: teams[0].team, homeTeam: teams[1].team, week: 5, seasonType: 'regular', timeConfirmed: true },
    { id: 'already-past', date: '2026-09-01T17:00:00Z', awayTeam: teams[0].team, homeTeam: teams[1].team, week: 1, seasonType: 'regular', timeConfirmed: true },
  ],
};
const now = Date.parse('2026-10-03T12:00:00Z');
const before = JSON.stringify({ teams, schedule });
const result = auditMarketHistory(teams, 2026, schedule, now);
assert.equal(result.saved.teamGameRows, 4);
assert.equal(result.saved.uniqueGames, 2);
assert.equal(result.saved.uniqueSourceEventIds, 2);
assert.equal(result.saved.pairedGames, 2);
assert.equal(result.saved.scoredGamesWithPriorHistoryBothTeams, 1);
assert.equal(result.saved.gamesWithThreePriorGamesBothTeams, 0);
assert.equal(result.saved.completeDraftKingsTargetRows, 0);
assert.equal(result.upcoming?.games, 2);
assert.equal(result.upcoming?.usablePublicQuotes, 1);
assert.equal(result.upcoming?.missingPublicQuotes, 1);
assert.equal(result.eligibleAccuracyComparisons, 0);
assert.equal(result.metrics, null);
assert.equal(JSON.stringify({ teams, schedule }), before, 'An audit must not mutate saved teams or quotes');
assert.throws(() => auditMarketHistory(teams, 2025), /different season/);
assert.throws(() => auditMarketHistory(teams, 2026, { ...schedule, season: 2025 }, now), /different season/);
assert.throws(() => auditMarketHistory([...teams, teams[0]], 2026), /Duplicate saved team/);
const complete = structuredClone(teams);
complete.forEach(team => {
  team.weeks[1].playerStats.qb = Object.fromEntries(dkFields.map(field => [field, 0]));
  team.players[0].availabilityReport = { status: 'available', rosterActive: true, source: { provider: 'ESPN', url: 'https://www.espn.com/', fetchedAt: '2026-10-03T12:00:00Z' } };
  team.players[0].availabilityOverride = { week: 2, status: 'available', updatedAt: '2026-10-03T12:00:00Z' };
});
const stillIneligible = auditMarketHistory(complete, 2026, schedule, now);
assert.equal(stillIneligible.saved.completeDraftKingsTargetRows, 2, 'Observed zero differs from unknown');
assert.equal(stillIneligible.saved.currentAvailabilityReportRows, 2);
assert.equal(stillIneligible.saved.currentAvailabilityOverrideRows, 2);
assert.equal(stillIneligible.eligibleAccuracyComparisons, 0, 'Complete targets and current flags do not establish pregame evidence');
assert.equal(stillIneligible.metrics, null, 'Functional weighting tests cannot become accuracy claims');
assert.equal(auditMarketHistory([], 2026).saved.uniqueGames, 0);
assert.equal(auditMarketHistory([], 2026).upcoming, null);
console.log('Market audit: season isolation, counterpart deduplication, cutoffs, no leakage, unknown-vs-zero, future quote exclusion and read-only behavior passed.');