import assert from 'node:assert/strict';
import { NFL_DIVISIONS, NFL_TEAM_NAMES, getDivision, isDivisionGame } from '../artifacts/gridiron-sim/src/lib/nfl-divisions';
import { headToHeadWeight, setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateGame, type TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';

type Team = Parameters<typeof setupFromHistory>[0];
type Week = Team['weeks'][number];
assert.equal(NFL_TEAM_NAMES.length, 32);
assert.equal(new Set(NFL_TEAM_NAMES).size, 32);
for (const [division, teams] of Object.entries(NFL_DIVISIONS)) {
  assert.equal(teams.length, 4);
  teams.forEach(team => assert.equal(getDivision(team), division));
}
assert.equal(getDivision('  seattle seahawks '), 'NFC West');
assert.equal(getDivision('Custom team'), undefined);
assert.equal(isDivisionGame('Arizona Cardinals', 'San Francisco 49ers'), true);
assert.equal(isDivisionGame('Dallas Cowboys', 'Philadelphia Eagles'), true);
assert.equal(isDivisionGame('Arizona Cardinals', 'Arizona Cardinals'), false);
assert.equal(isDivisionGame('Arizona Cardinals', 'Detroit Lions'), false);
assert.equal(isDivisionGame('Custom team', 'Other custom team'), false);
assert.equal(headToHeadWeight(1), .05);
assert.equal(headToHeadWeight(2), .1);
assert.equal(headToHeadWeight(20), .15);

const game = (week: number, opponent: string, stats: Record<string, number>, extra: Partial<Week> = {}): Week => ({
  week, opponent, status: 'played', venue: 'away', result: 'W', teamScore: 30, opponentScore: 20,
  teamDefense: { passYardsAllowed: stats.passYards ?? 0 }, playerStats: { qb: stats }, ...extra,
});
const fixture = (weeks: Week[]): Team => ({
  season: 2026, team: 'Arizona Cardinals', version: 1, updatedAt: new Date().toISOString(),
  players: [
    { id: 'qb', name: 'QB', position: 'QB', side: 'offense', active: true },
    { id: 'rb', name: 'RB', position: 'RB', side: 'offense', active: true },
  ], weeks,
} as Team);
const first = game(1, 'San Francisco 49ers', { passYards: 200, passAttempts: 20, passCompletions: 10, interceptions: 0 });
const second = game(2, 'Seattle Seahawks', { passYards: 400, passAttempts: 40, passCompletions: 20, interceptions: 1 });
second.playerStats.rb = { rushYards: 20, rushAttempts: 5 };
const team = fixture([
  first, second, game(3, 'San Francisco 49ers', { passYards: 1000 }),
  game(4, 'San Francisco 49ers', { passYards: 900 }),
  game(2, 'San Francisco 49ers', { passYards: 500 }, { status: 'bye' }),
]);
const before = JSON.stringify(team);
const baseline = setupFromHistory(team, 3, 'away');
const h2h = setupFromHistory(team, 3, 'away', 'San Francisco 49ers');
const high = setupFromHistory(team, 3, 'away', 'Seattle Seahawks');
const none = setupFromHistory(team, 3, 'away', 'Detroit Lions');
assert.equal(baseline.roster![0]!.recentStats!.passYards, 300);
assert.equal(h2h.roster![0]!.recentStats!.passYards, 295);
assert.equal(high.roster![0]!.recentStats!.passYards, 305);
assert.equal(h2h.defenseRecent!.passYardsAllowed, 295);
assert.deepEqual(none.roster, baseline.roster);
assert.deepEqual(none.defenseRecent, baseline.defenseRecent);
assert.deepEqual(h2h.headToHead, { opponent: 'San Francisco 49ers', games: 1, usableGames: 1, maxWeight: .05 });
assert.equal(none.headToHead!.games, 0);
assert.equal(h2h.roster!.find(p => p.id === 'rb')!.recentStats!.rushYards, 20, 'A DNP must not become a zero or opponent sample');
assert.equal(h2h.roster![0]!.recentStats!.rushYards, undefined, 'Missing fields remain unknown');
assert.equal(h2h.roster![0]!.recentStats!.interceptions, .475, 'Reported zeros are valid evidence');
assert.equal(JSON.stringify(team), before, 'Building inputs must not modify saved data');
assert.equal(setupFromHistory(team, 1, 'away', 'San Francisco 49ers').headToHead!.games, 0);

const empty = fixture([game(1, 'San Francisco 49ers', {}, { teamDefense: {} })]);
const noStats = setupFromHistory(empty, 2, 'away', 'San Francisco 49ers');
assert.equal(noStats.headToHead!.games, 1);
assert.equal(noStats.headToHead!.usableGames, 0);
assert.equal(noStats.headToHead!.maxWeight, 0);
assert.deepEqual(noStats.roster![0]!.recentStats, {});

const paired = fixture([
  game(1, 'San Francisco 49ers', { passAttempts: 1 }, { teamDefense: {} }),
  game(2, 'Seattle Seahawks', { passAttempts: 99, passCompletions: 49 }, { teamDefense: {} }),
]);
const safePair = setupFromHistory(paired, 3, 'away', 'San Francisco 49ers').roster![0]!.recentStats!;
assert.equal(safePair.passAttempts, 50, 'Skip an opponent adjustment that would contradict completions');
assert.equal(safePair.passCompletions, 49);

const outlier = fixture(Array.from({ length: 7 }, (_, i) => game(i + 1, i === 0 ? 'San Francisco 49ers' : 'Seattle Seahawks', { passYards: i === 0 ? 1000 : 100 })));
const normal = setupFromHistory(outlier, 8, 'away').roster![0]!.recentStats!.passYards!;
const bounded = setupFromHistory(outlier, 8, 'away', 'San Francisco 49ers').roster![0]!.recentStats!.passYards!;
assert.ok(bounded > normal);
assert.ok(bounded <= normal * 1.2 + 1e-9);

const manual: TeamSetup = { name: 'Arizona Cardinals', qb: 'QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 65, rushRating: 65, defenseRating: 60, context: '' };
const conditions = { seed: 42, weather: { temperatureF: 68, windMph: 7, precipitation: 'none' as const } };
const divisional = simulateGame({ ...conditions, away: manual, home: { ...manual, name: 'San Francisco 49ers' } });
const nonDivision = simulateGame({ ...conditions, away: manual, home: { ...manual, name: 'Detroit Lions' } });
assert.equal(divisional.awayScore, nonDivision.awayScore);
assert.equal(divisional.homeScore, nonDivision.homeScore);
assert.deepEqual(divisional.players.map(p => p.draftKings), nonDivision.players.map(p => p.draftKings), 'Division membership alone must not change fantasy points');
assert.ok(divisional.overview.some(note => note.startsWith('Division game:')));
assert.ok(nonDivision.overview.some(note => note.startsWith('Non-division')));
assert.ok(divisional.overview.some(note => note.includes('No opponent-specific history adjustment')));
console.log('All 32 division mappings, cutoff/bye safety, head-to-head direction, sparse-field bounds, paired-stat safety and no blanket rivalry penalty passed.');