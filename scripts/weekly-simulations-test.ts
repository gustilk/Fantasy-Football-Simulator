import assert from 'node:assert/strict';
import { gamesForWeek, runWeeklySimulations, runSingleGameSimulation } from '../artifacts/gridiron-sim/src/lib/weekly-simulations';
import { RESULTS_STORAGE_KEY, readSavedSimulations, saveSimulation } from '../artifacts/gridiron-sim/src/lib/saved-simulations';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { parseUpcomingSchedule, type ScheduleEvent } from '../artifacts/api-server/src/lib/nfl-schedule';

type Team = Parameters<typeof setupFromHistory>[0];
type Game = Parameters<typeof gamesForWeek>[0][number];
const makeTeam = (index: number): Team => ({
  season: 2026, team: `Team ${index}`, version: 1,
  players: ['QB', 'RB', 'WR', 'TE'].map((position, n) => ({
    id: `${index}-${n}`, name: `Player ${index}-${n}`, position: position as 'QB' | 'RB' | 'WR' | 'TE',
    side: 'offense', active: true, depthRank: 1,
  })),
  weeks: [3, 4, 5].map(week => ({
    week, status: 'played', opponent: 'Other', venue: 'home', result: 'W',
    teamScore: 24, opponentScore: 17,
    playerStats: {
      [`${index}-0`]: { passAttempts: week === 3 ? 30 : 1000, passYards: 230 },
      [`${index}-1`]: { rushAttempts: 12, rushYards: 48, targets: 3, receptions: 2, receivingYards: 14 },
      [`${index}-2`]: { targets: 8, receptions: 5, receivingYards: 70 },
      [`${index}-3`]: { targets: 5, receptions: 3, receivingYards: 30 },
    },
    teamDefense: { rushYardsAllowed: 100, passYardsAllowed: 220 },
  })),
});
const teams = Array.from({ length: 32 }, (_, i) => makeTeam(i));
const games: Game[] = Array.from({ length: 16 }, (_, i) => ({
  id: `game-${i}`, week: 4, date: `2026-10-${i === 0 ? '01' : i === 15 ? '05' : '04'}T17:00:00Z`,
  awayTeam: teams[i * 2]!.team, homeTeam: teams[i * 2 + 1]!.team,
  timeConfirmed: true, seasonType: 'regular',
  odds: { homeSpread: -3, total: 44, provider: 'test' },
}));
const wrongWeek = { ...games[1]!, id: 'week-5', week: 5 };
assert.equal(gamesForWeek([...games, games[0]!, wrongWeek], 4).length, 16);
assert.equal(gamesForWeek(games, 4).at(0)!.id, 'game-0', 'Thursday is included');
assert.equal(gamesForWeek(games, 4).at(-1)!.id, 'game-15', 'Monday is included');
assert.deepEqual(gamesForWeek(games, 9), []);
const contents = new Map<string, string>();
const storage = { getItem: (key: string) => contents.get(key) ?? null, setItem: (key: string, value: string) => { contents.set(key, value); } };
const base = simulateEnsemble({
  away: setupFromHistory(teams[0]!, 4, 'away'), home: setupFromHistory(teams[1]!, 4, 'home'),
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 12,
}, 2);
saveSimulation(storage, { id: 'existing', savedAt: '2026-10-01T00:00:00Z', awayName: 'Existing away', homeName: 'Existing home', result: base });
const inputs: Parameters<typeof simulateEnsemble>[0][] = [];
const progress: number[] = [];
const options: Parameters<typeof runWeeklySimulations>[0] = {
  season: 2026, week: 4, games: [...games, games[0]!, wrongWeek], teams,
  fetchedAt: '2026-10-03T00:00:00Z',
  loadDepth: async () => { throw new Error('Offline: use complete saved ranks'); },
  save: entry => { saveSimulation(storage, entry); },
  onProgress: value => { progress.push(value.completed); },
  yieldUI: async () => {},
  simulate: (input, runs) => {
    assert.equal(runs, 200);
    assert.equal(input.away.historyGames, 1, 'Target-week and future history excluded');
    assert.equal(input.away.roster!.find(p => p.position === 'QB')!.recentStats!.passAttempts, 30);
    assert.equal(input.market!.enabled, false, 'Never inherit single-game market adjustment');
    assert.equal(input.market!.season, 2026);
    assert.equal(input.market!.week, 4);
    assert.deepEqual(input.weather, { temperatureF: 68, windMph: 5, precipitation: 'none' });
    inputs.push(input);
    return { ...structuredClone(base), seed: input.seed };
  },
};
const before = JSON.stringify(teams);
const report = await runWeeklySimulations(options);
assert.equal(report.total, 16);
assert.equal(report.saved.length, 16);
assert.equal(report.failures.length, 0);
assert.equal(inputs.length, 16);
assert.equal(new Set(report.saved.map(entry => entry.id)).size, 16);
assert.equal(new Set(inputs.map(input => input.market!.gameId)).size, 16);
assert.equal(readSavedSimulations(storage).length, 17, 'All 16 games and previous results survive reload');
assert.ok(readSavedSimulations(storage).some(entry => entry.id === 'existing'));
assert.equal(progress.at(-1), 16);
assert.equal(JSON.stringify(teams), before, 'Saved team history is not mutated');
assert.ok(report.saved[0]!.result.overview.some(text => text.includes('not an eligible pregame forecast')));

const partial = await runWeeklySimulations({ ...options, teams: teams.filter(team => team.team !== 'Team 0') });
assert.equal(partial.saved.length, 15);
assert.equal(partial.failures.length, 1);
assert.match(partial.failures[0]!.reason, /missing.*Team Library/);
const incomplete = structuredClone(teams);
incomplete[0]!.players[0]!.depthRank = undefined;
const fallback = await runWeeklySimulations({ ...options, games: [games[0]!], teams: incomplete });
assert.match(fallback.failures[0]!.reason, /ranks are incomplete/);
const afterSave = contents.get(RESULTS_STORAGE_KEY);
assert.throws(() => saveSimulation({ getItem: storage.getItem, setItem: () => { throw new Error('Quota'); } }, report.saved[0]!), /previously saved results are unchanged/);
assert.equal(contents.get(RESULTS_STORAGE_KEY), afterSave);
const quota = await runWeeklySimulations({ ...options, games: [games[0]!, games[1]!], save: () => { throw new Error('Storage full'); } });
assert.equal(quota.saved.length, 0);
assert.equal(quota.failures.length, 2, 'Storage failures do not claim saved results');
await assert.rejects(runWeeklySimulations({ ...options, week: 17 }), /No announced games/);
const corrupt = { getItem: () => '{"not":"an array"}', setItem: () => assert.fail('Must not overwrite corrupt data') };
assert.throws(() => saveSimulation(corrupt, report.saved[0]!), /Existing data has not been replaced/);

const names = new Map([['1', 'Team 0'], ['2', 'Team 1']]);
const event = (id: string, state: string, date = '2026-10-04T17:00:00Z'): ScheduleEvent => ({
  id, date, season: { year: 2026, type: 2 }, week: { number: 4 },
  status: { type: { state } },
  competitions: [{ timeValid: true, competitors: [
    { homeAway: 'away', team: { id: '1' } }, { homeAway: 'home', team: { id: '2' } },
  ] }],
});
const events = [event('thursday', 'post', '2026-10-01T17:00:00Z'), event('live', 'in'), event('sunday', 'pre')];
const cancelled = event('cancelled', 'pre');
cancelled.status!.type!.name = 'STATUS_CANCELED';
const wrongSeason = { ...event('wrong-season', 'post'), season: { year: 2025, type: 2 } };
const all = parseUpcomingSchedule([...events, cancelled, wrongSeason], 2026, names, Date.parse('2026-10-03T00:00:00Z'), 'all');
assert.equal(all.games.length, 3, 'Full schedule includes completed, live and upcoming games');
const upcoming = parseUpcomingSchedule(events, 2026, names, Date.parse('2026-10-03T00:00:00Z'));
assert.deepEqual(upcoming.games.map(game => game.id), ['sunday'], 'Sunday forecast schedule stays future-only');
const singleSaves: typeof report.saved = [];
const singleDepth: string[] = [];
const selected = games[9]!;
const single = await runSingleGameSimulation({
  ...options, gameId: selected.id,
  save: entry => { singleSaves.push(entry); },
  loadDepth: async (_season, team) => { singleDepth.push(team); throw new Error('Use saved complete ranks'); },
  onProgress: value => { assert.equal(value.total, 1); },
});
assert.equal(single.total, 1, 'Full schedule cannot expand the single-game selection');
assert.equal(singleSaves.length, 1);
assert.equal(single.saved[0]!.setup!.market!.gameId, selected.id);
assert.equal(single.saved[0]!.awayName, selected.awayTeam);
assert.equal(single.saved[0]!.homeName, selected.homeTeam);
assert.equal(single.saved[0]!.setup!.showdownModel, 'showdown-v1');
assert.ok(single.saved[0]!.weeklyRunId && single.saved[0]!.generatedAt, 'Keep frozen Captain-compatible metadata');
assert.deepEqual(singleDepth.sort(), [selected.awayTeam, selected.homeTeam].sort(), 'Do not fetch unrelated teams');
await assert.rejects(runSingleGameSimulation({ ...options, gameId: 'unknown-game' }), /selected game/);
await assert.rejects(runSingleGameSimulation({ ...options, gameId: wrongWeek.id }), /selected game/);
const singleQuota = await runSingleGameSimulation({ ...options, gameId: selected.id, save: () => { throw new Error('Storage full'); } });
assert.equal(singleQuota.saved.length, 0);
assert.equal(singleQuota.failures.length, 1);
console.log('Single selection: only selected game/teams, one save, week validation, Captain metadata and explicit save failures passed. Legacy weekly pipeline checks passed.');