import assert from 'node:assert/strict';
import type { TeamSeasonRecord, NflScheduledGame } from '../../lib/api-client-react/src/generated/api.schemas';
import {
  availableSundays, centralDay, dkHistory, gameForecast, groupDKPlayers, slateBoard, sundayGames,
  validateOfficialScore, type DKOfficialScore, type DKSlate,
} from '../../artifacts/gridiron-sim/src/lib/draftkings-board';
import {
  DK_ARCHIVE_KEY, addDKSlate, emptyDKArchive, readDKArchive, setOfficialScore, writeDKArchive,
} from '../../artifacts/gridiron-sim/src/lib/draftkings-archive';
import { simulateEnsemble } from '../../artifacts/gridiron-sim/src/lib/ensemble';
import { setupFromHistory } from '../../artifacts/gridiron-sim/src/lib/season-model';
import { dkFields } from './h2h-history-audit';

const makeTeam = (name: string): TeamSeasonRecord => ({
  team: name, season: 2026, version: 1,
  players: [
    { id: 'qb', name: `${name} QB`, position: 'QB', side: 'offense', active: true, depthRank: 1 },
    { id: 'rb', name: `${name} RB`, position: 'RB', side: 'offense', active: true, depthRank: 1 },
    { id: 'wr', name: `${name} WR`, position: 'WR', side: 'offense', active: true, depthRank: 1 },
    { id: 'te', name: `${name} TE`, position: 'TE', side: 'offense', active: false, depthRank: 1 },
  ],
  weeks: [
    { week: 1, opponent: 'Opponent', status: 'played', venue: 'home', result: 'W', teamScore: 21, opponentScore: 10,
      playerStats: { qb: { passYards: 200, passTD: 2 }, rb: { rushYards: 0 }, te: { receptions: 2, receivingYards: 20 } }, teamDefense: {} },
    { week: 2, opponent: 'Opponent', status: 'played', venue: 'away', result: 'L', teamScore: 10, opponentScore: 21,
      playerStats: { qb: { passYards: 100, passTD: 1 }, wr: { passAttempts: 1 } }, teamDefense: {} },
  ],
});
const game = (id: string, date: string): NflScheduledGame => ({
  id, date, homeTeam: 'Detroit Lions', awayTeam: 'San Francisco 49ers', week: 4, seasonType: 'regular', timeConfirmed: true,
});
const games = [
  game('morning', '2026-10-04T13:30:00Z'), game('afternoon', '2026-10-04T17:00:00Z'),
  game('sunday-night', '2026-10-05T00:20:00Z'), game('monday', '2026-10-06T00:15:00Z'),
  game('next-sunday', '2026-10-11T17:00:00Z'),
];
const now = Date.parse('2026-10-03T19:00:00Z');
assert.equal(centralDay(games[2].date), '2026-10-04', 'Sunday evening must not become Monday due to UTC');
assert.deepEqual(sundayGames(games, '2026-10-04', now).map(game => game.id), ['morning', 'afternoon', 'sunday-night']);
assert.equal(sundayGames(games, '2026-10-04', Date.parse('2026-10-04T18:00:00Z')).length, 1, 'Exclude kickoffs that have passed');
assert.deepEqual(availableSundays(games), ['2026-10-04', '2026-10-11']);
assert.throws(() => sundayGames(games, '2026-10-05', now), /Sunday/);
const teams = [makeTeam('Detroit Lions'), makeTeam('San Francisco 49ers')];
const before = JSON.stringify(teams);
const actual = dkHistory(teams, 2026);
const qb = actual.find(row => row.team === 'Detroit Lions' && row.playerId === 'qb')!;
assert.equal(qb.recordedTotal, 24, 'Cumulative points sum real observed weeks, not simulation draws');
assert.equal(qb.recordedAverage, 12);
assert.equal(qb.observedGames, 2);
assert.equal(qb.partial, true, 'Unreported scoring components stay partial');
const rb = actual.find(row => row.team === 'Detroit Lions' && row.playerId === 'rb')!;
assert.equal(rb.weeks[0].points, 0, 'Explicit observed zero differs from absent stat rows');
assert.equal(rb.weeks[1].points, null, 'Missing/DNP rows do not become zero');
assert.equal(rb.unknownGames, 1);
assert.equal(actual.find(row => row.team === 'Detroit Lions' && row.playerId === 'wr')!.recordedTotal, null, 'Attempts alone do not establish DK scoring');
assert.ok(actual.some(row => row.playerId === 'te'), 'Inactive players retain actual history');
assert.equal(dkHistory(teams, 2025).length, 0, 'Never combine seasons');
const official: DKOfficialScore = { season: 2026, team: 'Detroit Lions', playerId: 'qb', week: 2, points: -1.25, enteredAt: '2026-10-03T19:00:00Z' };
validateOfficialScore(official, teams);
assert.equal(dkHistory(teams, 2026, [official]).find(row => row.team === official.team && row.playerId === official.playerId)!.recordedTotal, 14.75);
assert.throws(() => validateOfficialScore({ ...official, week: 4 }, teams), /completed game/);
assert.throws(() => validateOfficialScore({ ...official, points: NaN }, teams), /actual DK points/);
assert.throws(() => validateOfficialScore({ ...official, season: 2025 }, teams), /completed game/);
const fullStats = structuredClone(teams);
fullStats[0].weeks[0].playerStats.qb = Object.fromEntries(dkFields.map(field => [field, 0]));
assert.equal(dkHistory(fullStats, 2026)[0].weeks[0].partial, false, 'Complete explicit zeros form a complete target');

const input = {
  away: setupFromHistory(teams[1], 4, 'away', teams[0].team),
  home: setupFromHistory(teams[0], 4, 'home', teams[1].team),
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' as const }, seed: 8143,
};
const result = simulateEnsemble(input, 200);
assert.ok(result.players.every(player => player.id), 'History simulations retain stable player identities');
const forecast = gameForecast(games[1], input, result);
assert.equal(forecast.runs, 200);
forecast.players.forEach((player, index) => assert.equal(player.mean, result.ensemble!.fantasy[index].mean, 'Use ensemble mean, not example score or sum of 200 outcomes'));
assert.deepEqual(forecast.input, input, 'Freeze inputs to make the saved projection reproducible');
const slate: DKSlate = {
  id: 'slate-a', season: 2026, sunday: '2026-10-04', createdAt: '2026-10-03T19:00:00Z',
  timezone: 'America/Chicago', forecasts: [forecast], failures: [],
};
const rows = slateBoard(slate, actual);
assert.ok(rows.every((row, index) => index === 0 || rows[index - 1].mean >= row.mean), 'Rank highest projection first');
assert.equal(rows[0].difference, null, 'Upcoming weeks have no fabricated actual score');
assert.deepEqual(groupDKPlayers(rows).map(group => group.position), ['QB', 'RB', 'WR', 'TE']);
assert.throws(() => slateBoard({ ...slate, forecasts: [forecast, forecast] }, actual), /twice/);
const comparedSlate = { ...slate, forecasts: [{ ...forecast, week: 2 }] };
assert.equal(slateBoard(comparedSlate, actual).find(row => row.playerId === 'qb')!.difference, null, 'A partial subtotal must not become a full accuracy error');
const compared = slateBoard(comparedSlate, dkHistory(teams, 2026, [official])).find(row => row.team === official.team && row.playerId === official.playerId)!;
assert.equal(compared.difference, Math.round((official.points - compared.mean) * 100) / 100);

let raw: string | null = null;
const storage = { getItem: (_key: string) => raw, setItem: (_key: string, value: string) => { raw = value; } };
assert.deepEqual(readDKArchive(storage), emptyDKArchive());
let archive = addDKSlate(emptyDKArchive(), slate);
archive = setOfficialScore(archive, official);
archive = setOfficialScore(archive, { ...official, points: 0 });
assert.equal(archive.official.length, 1, 'Editing a week replaces its actual entry instead of accumulating it');
writeDKArchive(storage, archive);
assert.deepEqual(readDKArchive(storage), JSON.parse(JSON.stringify(archive)), 'Slates and official scores survive the JSON wire-format roundtrip');
assert.throws(() => addDKSlate(archive, slate), /already saved/);
const savedRaw = raw;
assert.throws(() => writeDKArchive({ ...storage, setItem: () => { throw new Error('quota exceeded'); } }, emptyDKArchive()), /quota/);
assert.equal(raw, savedRaw, 'Save failure preserves previous data');
raw = '{broken';
assert.throws(() => readDKArchive(storage), /invalid JSON/);
assert.equal(raw, '{broken', 'Corrupt archives must never be silently replaced');
raw = JSON.stringify({ version: 2, slates: [] });
assert.throws(() => readDKArchive(storage), /could not be read/);
assert.equal(DK_ARCHIVE_KEY, 'gridiron-draftkings-archive-v1');
assert.equal(JSON.stringify(teams), before, 'Forecasting, official score entry and totals never overwrite Team Library');
console.log('DraftKings board: Sunday/UTC boundaries, ensemble means, stable identities, position ranking, actual/partial/unknown scoring, official-score edits, paired comparisons and loss-safe persistence passed.');