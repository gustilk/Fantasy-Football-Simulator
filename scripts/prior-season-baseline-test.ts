import assert from 'node:assert/strict';
import { baseline2025, priorTeam, matchPriorPlayer, priorPlayer, priorWeight,
  blendPriorStats, blendPriorUsage, priorBackfieldEvidence, priorDefenderRecord } from '../artifacts/gridiron-sim/src/lib/prior-season-baseline';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import reference from '../artifacts/gridiron-sim/src/data/baseline-2025-reference.json' with { type: 'json' };

assert.equal(baseline2025.season, 2025);
assert.equal(baseline2025.seasonType, 'regular');
assert.equal(baseline2025.sources.length, 19);
assert.equal(Object.keys(baseline2025.teams).length, 32);
assert.equal(Object.keys(reference).length, 19);
assert.ok(baseline2025.players.length > 1700);
assert.ok(baseline2025.sources.every(source => /^[a-f0-9]{64}$/.test(source.sha256)));
assert.ok(baseline2025.sources.every(source => source.url.includes('/2025/')));
const stafford = matchPriorPlayer({ name: 'Matthew Stafford', position: 'QB' })!;
assert.equal(stafford.teams.ram!.stats.passYards, 4707);
assert.equal(stafford.teams.ram!.stats.passAttempts, 597);
assert.equal(stafford.teams.ram!.games, 17, 'Postseason games not appended');
assert.equal(matchPriorPlayer({ name: 'James Cook III', position: 'RB' })!.teams.buf!.stats.rushYards, 1621);
assert.equal(matchPriorPlayer({ name: 'Jaxon Smith-Njigba', position: 'WR' })!.teams.sea!.stats.receivingYards, 1793);
assert.equal(matchPriorPlayer({ name: 'Myles Garrett', position: 'EDGE' })!.teams.cle!.stats.sacks, 23);
assert.equal(matchPriorPlayer({ name: 'Matthew Stafford', position: 'WR' }), undefined, 'Position protects identity');
assert.equal(matchPriorPlayer({ name: 'Matt Stafford', position: 'QB' }), undefined, 'No unverified fuzzy aliases');
assert.equal(priorPlayer(2026, 'Buffalo Bills', { name: 'Matthew Stafford', position: 'QB', depthRank: 1 }).record, undefined, 'Do not transfer historical workload to a new team');
assert.equal(priorPlayer(2026, 'Buffalo Bills', { name: 'Matthew Stafford', position: 'QB', depthRank: 1 }).teamChanged, true);
assert.equal(priorPlayer(2026, 'Buffalo Bills', { name: 'Unknown Rookie', position: 'RB' }).record, undefined);
assert.equal(priorPlayer(2026, 'Los Angeles Rams', { name: 'Jimmy Garoppolo', position: 'QB', depthRank: 1 }).record, undefined, 'Changed backup-to-QB1 role must not inherit tiny attempt rates');
assert.equal(priorTeam(2025, 'Los Angeles Rams'), undefined);
assert.equal(priorTeam(2027, 'Los Angeles Rams'), undefined);
assert.equal(priorWeight(0), 1);
assert.equal(priorWeight(3), .5);
assert.equal(priorWeight(8), 3 / 11);
assert.ok(priorWeight(100) < .03);
const mock = { games: 17, stats: { rushAttempts: 170, rushYards: 680, targets: 85, receptions: 51, receivingYards: 408 },
  samples: { rushAttempts: 17, rushYards: 17, targets: 17, receptions: 17, receivingYards: 17 } };
const rows = Array.from({ length: 3 }, () => ({ rushAttempts: 2, rushYards: 8, targets: 0, receptions: 0 }));
const mixed = blendPriorStats(rows[0]!, rows, mock);
assert.equal(mixed.rushAttempts, 6);
assert.equal(mixed.rushYards, 24);
assert.equal(mixed.targets, 2.5, 'Actual zero targets count as evidence');
assert.equal(mixed.receptions, 1.5);
assert.equal(mixed.passAttempts, undefined, 'Missing passing remains unknown');
const badPairs = blendPriorStats({ receptions: 10, targets: 1 }, [{ receptions: 10, targets: 1 }], mock);
assert.ok(badPairs.receptions! <= badPairs.targets!);
for (const [key, expected] of Object.entries({ rushAttempts: 30, rushYards: 120, receivingCatches: 9, receivingYards: 72 })) {
  assert.ok(Math.abs(priorBackfieldEvidence(mock)[key as keyof ReturnType<typeof priorBackfieldEvidence>] - expected) < 1e-9);
}
const teamPrior = priorTeam(2026, 'Los Angeles Rams')!;
const currentUsage = { targetShare: undefined, carryShare: .1, targetGames: 0, carryGames: 3 };
const priorUsage = blendPriorUsage(currentUsage, teamPrior, mock);
assert.equal(priorUsage.targetGames, 3);
assert.equal(priorUsage.carryGames, 6);
assert.equal(currentUsage.carryGames, 3, 'Do not mutate current observations');
assert.equal(priorDefenderRecord(matchPriorPlayer({ name: 'Myles Garrett', position: 'EDGE' })!.teams.cle)!.stats.interceptions, 0);
for (const team of Object.values(baseline2025.teams)) {
  assert.equal(team.offense.games, 17);
  assert.equal(team.defense.games, 17);
  assert.equal(Object.keys(team.defenseVsPosition).length, 4);
  for (const stats of Object.values(team.defenseVsPosition)) assert.ok(Math.abs(stats.perGame - stats.total / 17) < .0001);
}
assert.ok(!('DKPt' in stafford.teams.ram!.stats), 'Fantasy totals never feed scoring a second time');
assert.equal(reference.passing.length, 1, 'Reference player page also excludes appended playoffs');

type Team = Parameters<typeof setupFromHistory>[0];
const team: Team = {
  season: 2026, team: 'Los Angeles Rams', version: 1,
  players: [
    { id: 'qb', name: 'Matthew Stafford', position: 'QB', side: 'offense', active: true, depthRank: 1 },
    { id: 'rb', name: 'Kyren Williams', position: 'RB', side: 'offense', active: true, depthRank: 1 },
    { id: 'wr', name: 'Puka Nacua', position: 'WR', side: 'offense', active: true, depthRank: 1 },
    { id: 'te', name: 'Tyler Higbee', position: 'TE', side: 'offense', active: true, depthRank: 1 },
    { id: 'out', name: 'Davante Adams', position: 'WR', side: 'offense', active: false, depthRank: 2 },
    { id: 'rookie', name: 'Unknown Rookie', position: 'WR', side: 'offense', active: true, depthRank: 3 },
  ],
  weeks: [3, 4, 5].map(week => ({
    week, status: 'played', opponent: 'Opponent', venue: 'home', result: 'W', teamScore: 24, opponentScore: 20,
    teamDefense: { passYardsAllowed: 210, rushYardsAllowed: 100 },
    playerStats: { qb: { passAttempts: week === 3 ? 30 : 1000, passCompletions: 20, passYards: 240 },
      rb: { rushAttempts: 15, rushYards: 60, targets: 2, receptions: 1, receivingYards: 8 },
      wr: { targets: 10, receptions: 7, receivingYards: 95 } },
  })),
};
const original = JSON.stringify(team);
const setup = setupFromHistory(team, 4, 'away');
assert.equal(setup.historyGames, 1, '2025 priors are not counted as 2026 games');
assert.deepEqual(setup.record, { wins: 1, losses: 0, ties: 0 });
assert.ok(setup.priorSeasonBaseline!.matchedPlayers.includes('Matthew Stafford'));
assert.ok(setup.priorSeasonBaseline!.unmatchedPlayers.includes('Unknown Rookie'));
assert.ok(!setup.roster!.some(player => player.id === 'out'), 'Current availability outranks past production');
assert.equal(setup.roster!.find(player => player.id === 'qb')!.historyObservations, 1);
assert.equal(setup.roster!.find(player => player.id === 'qb')!.recentStats!.passAttempts, 30 * .25 + 597 / 17 * .75);
assert.equal(JSON.stringify(team), original);
assert.ok(setup.modelEvidence!.warnings.some(warning => warning.includes('improved predictive accuracy is not established')));
const legacy = setupFromHistory(team, 4, 'away', undefined, { usePriorSeason: false });
assert.equal(legacy.priorSeasonBaseline, undefined);
assert.equal(legacy.roster!.find(player => player.id === 'qb')!.recentStats!.passAttempts, 30);
assert.equal(setupFromHistory({ ...team, season: 2025 }, 4, 'away').priorSeasonBaseline, undefined);
const frozen = structuredClone({ away: legacy, home: { ...legacy, name: 'Opponent' }, seed: 451, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' as const } });
const previous = simulateEnsemble(frozen, 5);
const withPrior = simulateEnsemble({ ...frozen, away: setup, home: { ...setup, name: 'Opponent' } }, 5);
assert.ok(withPrior.overview.some(warning => warning.includes('2025 regular-season baseline active')));
assert.deepEqual(simulateEnsemble(frozen, 5), previous, 'Frozen forecasts replay unchanged after new baseline runs');
assert.equal(frozen.away.priorSeasonBaseline, undefined);
console.log('2025 baseline: 19 sources, regular-season-only, 32 defenses, known totals, safe identity/role matching, bounded decay, paired evidence, no future-week leakage, separate history, current availability and frozen replay passed.');