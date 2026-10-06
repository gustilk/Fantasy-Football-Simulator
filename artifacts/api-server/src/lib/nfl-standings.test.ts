import test from 'node:test';
import assert from 'node:assert/strict';
import { parseNflStandings } from './nfl-standings.ts';

const now = Date.parse('2026-10-05T12:00Z');
const names = Array.from({ length: 32 }, (_, i) => `Team ${i}`);
const tree = { season: { year: 2026 }, children: [{ standings: {
  season: 2026, seasonType: 2, entries: names.map(displayName => ({ team: { displayName } })),
} }] };
const game = (id: string, week: number, away = '20', home = '10', completed = true) => ({
  id, date: `2026-09-${String(week * 7).padStart(2, '0')}T18:00Z`, season: { year: 2026, type: 2 }, week: { number: week },
  competitions: [{ status: { type: { completed } }, competitors: [
    { homeAway: 'away', team: { displayName: names[0]! }, score: away },
    { homeAway: 'home', team: { displayName: names[1]! }, score: home },
  ] }],
});
test('all 32 records, home/away, PF/PA, ties, and chronological streak', () => {
  const result = parseNflStandings(tree, [game('2', 2, '7', '7'), game('1', 1), game('3', 3, '0', '14')], 2026, 4, now);
  assert.equal(result.entries.length, 32);
  assert.deepEqual(result.entries[0]?.record, { wins: 1, losses: 1, ties: 1 });
  assert.deepEqual(result.entries[0]?.tableStats, { pointsFor: 27, pointsAgainst: 31, home: '0-0-0', away: '1-1-1', streak: 'L1' });
  assert.deepEqual(result.entries[2]?.record, { wins: 0, losses: 0, ties: 0 });
});
test('only final games before selected week; neutral manual flags', () => {
  const result = parseNflStandings(tree, [game('1', 1), game('2', 2), game('3', 3, '0', '0', false)], 2026, 2, now);
  assert.deepEqual(result.entries[0]?.record, { wins: 1, losses: 0, ties: 0 });
  assert.equal(result.completedGames, 1);
  assert.ok(result.entries.every(e => e.needsWin === false));
  assert.equal(parseNflStandings(tree, [game('1', 1)], 2026, 1, now).completedGames, 0);
});
test('current entering week and incomplete-game warnings are explicit', () => {
  const result = parseNflStandings(tree, [game('1', 1), game('2', 2), game('pending', 2, '30', '10', false)], 2026, undefined, now);
  assert.equal(result.week, 3);
  assert.equal(result.completedGames, 2);
  assert.equal(result.warnings.length, 1);
});
test('wrong seasons, preseason/postseason and incomplete league do not leak', () => {
  assert.throws(() => parseNflStandings({ ...tree, season: { year: 2025 } }, [game('1', 1)], 2026, 2, now));
  assert.throws(() => parseNflStandings({ ...tree, children: [] }, [game('1', 1)], 2026, 2, now));
  for (const season of [{ year: 2025, type: 2 }, { year: 2026, type: 1 }, { year: 2026, type: 3 }]) {
    const result = parseNflStandings(tree, [game('1', 1), { ...game('excluded', 1), season }], 2026, 2, now);
    assert.equal(result.completedGames, 1);
  }
});
test('bad final scores, duplicate games, unknown teams and future results fail explicitly', () => {
  const invalid = game('1', 1);
  invalid.competitions[0]!.competitors[0]!.score = '';
  assert.throws(() => parseNflStandings(tree, [invalid], 2026, 2, now));
  assert.throws(() => parseNflStandings(tree, [game('1', 1), game('1', 1)], 2026, 2, now));
  const unknown = game('1', 1); unknown.competitions[0]!.competitors[0]!.team.displayName = 'Unknown';
  assert.throws(() => parseNflStandings(tree, [unknown], 2026, 2, now));
  assert.throws(() => parseNflStandings(tree, [{ ...game('1', 1), date: '2027-01-01T18:00Z' }], 2026, 2, now));
});
