import assert from 'node:assert/strict';
import { parseDepthChart, type SourceDepthChart } from '../artifacts/api-server/src/lib/nfl-depth-chart';
import { withDepthChart } from '../artifacts/gridiron-sim/src/lib/depth-chart';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { receivingRoleWeight, rushingRoleWeight, roleGuidedWeight, simulateGame } from '../artifacts/gridiron-sim/src/lib/simulator';
import { mergeNflImport } from '../artifacts/gridiron-sim/src/lib/nfl-import-merge';
import { SaveSeasonTeamBody, ListSeasonTeamsResponse } from '../lib/api-zod/src/generated/api';

type Team = Parameters<typeof setupFromHistory>[0];
const slot = (position: string, ids: string[]) => ({ position: { abbreviation: position }, athletes: ids.map(id => ({ id })) });
const raw: SourceDepthChart = { season: { year: 2026 }, team: { id: '14' }, depthchart: [
  { positions: { de: slot('DE', ['d1']) } },
  { positions: { wr1: slot('WR', ['puka', 'wr4']), wr2: slot('WR', ['adams', 'wr5']), wr3: slot('WR', ['wr3', 'wr6']), qb: slot('QB', ['qb', 'qb2']), rb: slot('RB', ['rb', 'rb2']), te: slot('TE', ['te', 'te2']) } },
] };
const roles = parseDepthChart(raw, 2026, '14');
assert.deepEqual(roles.filter(r => r.position === 'WR').map(r => [r.athleteId, r.depthRank]), [['puka', 1], ['adams', 2], ['wr3', 3], ['wr4', 4], ['wr5', 5], ['wr6', 6]]);
assert.throws(() => parseDepthChart(raw, 2025, '14'), /season/);
assert.throws(() => parseDepthChart(raw, 2026, '21'), /season\/team/);
assert.throws(() => parseDepthChart({ season: raw.season, team: raw.team, depthchart: [] }, 2026, '14'), /offensive/);
const chart = { season: 2026, team: 'Los Angeles Rams', roles, source: { provider: 'ESPN' as const, url: 'https://www.espn.com/nfl/team/depth/_/name/lar', fetchedAt: '2026-10-03T12:00:00Z' } };
const team: Team = {
  season: 2026, team: chart.team, version: 1, updatedAt: '2026-10-03T12:00:00Z',
  players: roles.map(r => ({ id: `espn:${r.athleteId}`, name: r.athleteId, position: r.position, side: 'offense', active: true })),
  weeks: [1, 2, 3].map(week => ({
    week, status: 'played', opponent: 'Philadelphia Eagles', venue: 'home', result: 'W', teamScore: 21, opponentScore: 14, teamDefense: {},
    playerStats: {
      'espn:qb': { passAttempts: 30, passCompletions: 20, passYards: 250 },
      'espn:qb2': { passAttempts: 50, passCompletions: 30, rushAttempts: 5 },
      ...(week === 1 ? { 'espn:puka': { targets: 9, receptions: 5, receivingYards: 74 } } : {}),
      'espn:adams': { targets: 10, receptions: 6, receivingYards: 100 },
    },
  })),
};
const before = JSON.stringify(team);
const ranked = withDepthChart(team, chart);
const setup = setupFromHistory(ranked, 4, 'away');
assert.equal(setup.qb, 'qb', 'QB1 starts, even when QB2 has more historical attempts');
assert.equal(setup.wr1, 'puka', 'Source WR1 is not replaced by the player with more recent targets');
assert.equal(setup.wr2, 'adams');
assert.equal(setup.rb, 'rb');
assert.equal(setup.te, 'te');
const puka = setup.roster!.find(p => p.name === 'puka')!;
assert.equal(puka.recentStats!.targets, 9, 'Two missing injury games must not turn 9 targets into an average of 3');
assert.equal(puka.historyObservations, 1);
assert.equal(puka.depthRank, 1);
assert.equal(puka.depthRankBasis, 'ESPN');
assert.deepEqual(setup.depthChartSource, chart.source);
assert.equal(JSON.stringify(team), before, 'Live chart overlay is read-only');
assert.throws(() => withDepthChart(team, { ...chart, season: 2025 }), /season/);

const overridden = structuredClone(team);
overridden.players.find(p => p.name === 'adams')!.depthRank = 1;
const custom = withDepthChart(overridden, chart);
assert.equal(custom.players.find(p => p.name === 'adams')!.depthRank, 1);
assert.equal(custom.players.find(p => p.name === 'puka')!.depthRank, 2, 'An automatic rank yields to the saved manual role');
const inactive = structuredClone(ranked);
inactive.players.find(p => p.name === 'puka')!.active = false;
assert.ok(!setupFromHistory(inactive, 4, 'away').roster!.some(p => p.name === 'puka'));
assert.equal(inactive.players.find(p => p.name === 'puka')!.depthRank, 1, 'Injury exclusion preserves the stored role');
for (const position of ['WR', 'RB', 'TE']) {
  assert.ok(receivingRoleWeight(position, 1) > receivingRoleWeight(position, 2));
  assert.ok(receivingRoleWeight(position, 2) > receivingRoleWeight(position, 3));
}
assert.ok(rushingRoleWeight(1) > rushingRoleWeight(2));
assert.ok(rushingRoleWeight(2) > rushingRoleWeight(3));
assert.ok(roleGuidedWeight(receivingRoleWeight('WR', 6), 20, 1) < receivingRoleWeight('WR', 3), 'An old starter stint cannot inflate a current deep backup to starter volume');

const preview = { season: 2026, team: team.team, fetchedAt: chart.source.fetchedAt, rosterUrl: chart.source.url, players: ranked.players, weeks: [], warnings: [] };
for (const updateRoster of [false, true]) {
  const merged = mergeNflImport({ players: overridden.players, weeks: team.weeks }, preview, { updateRoster, replaceStats: false });
  assert.equal(merged.draft.players.find(p => p.name === 'adams')!.depthRank, 1);
  assert.equal(merged.draft.players.find(p => p.name === 'adams')!.depthSource, undefined);
  assert.equal(merged.draft.players.find(p => p.name === 'puka')!.depthRank, 2);
}
const request = SaveSeasonTeamBody.parse({ expectedVersion: 1, players: custom.players, weeks: team.weeks });
assert.equal(request.players.find(p => p.name === 'adams')!.depthRank, 1);
const response = ListSeasonTeamsResponse.parse([{ ...team, ...request, updatedAt: new Date(), version: 2 }]);
assert.equal(response[0]!.players.find(p => p.name === 'adams')!.depthRank, 1, 'Save/read contracts retain depth fields');
assert.equal(response[0]!.players.find(p => p.name === 'puka')!.depthSource!.provider, 'ESPN');
assert.equal(SaveSeasonTeamBody.safeParse({ ...request, players: [{ ...request.players[0]!, depthRank: 0 }] }).success, false);
const simulation = simulateGame({ away: setup, home: { ...setup, name: 'Philadelphia Eagles' }, seed: 42, weather: { temperatureF: 68, windMph: 7, precipitation: 'none' } });
assert.equal(simulation.players.find(p => p.name === 'qb2')!.played, false, 'Backup QBs do not inherit historical rushing opportunities');
const frozen = JSON.parse(JSON.stringify(setup));
assert.equal(frozen.roster.find(p => p.name === 'puka').depthRank, 1, 'Saved input snapshots retain roles');
console.log('Depth ordering, source season validation, QB starter choice, injury/DNP safety, workload priority, manual override preservation, save/read contracts and frozen roles passed.');