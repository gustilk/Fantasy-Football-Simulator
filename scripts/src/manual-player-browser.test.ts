import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EMPTY_MANUAL_PLAYER_FILTERS, filterManualPlayers, manualPlayerPage } from '../../artifacts/gridiron-sim/src/lib/manual-player-browser';
import type { SalaryPlayer } from '../../artifacts/gridiron-sim/src/lib/lineups';
import type { ManualPicks } from '../../artifacts/gridiron-sim/src/lib/manual-lineups';

const players: SalaryPlayer[] = [
  { id: '1', name: 'Patrick Mahomes', team: 'KC', position: 'QB', salary: 7000, gameInfo: 'KC@BUF 10/11/2026 01:00PM ET', rosterPosition: 'QB' },
  { id: '2', name: 'KC backup', team: 'KC', position: 'QB', salary: 4000, gameInfo: 'KC@BUF 10/11/2026 01:00PM ET', rosterPosition: 'QB' },
  { id: '3', name: 'Josh Allen', team: 'BUF', position: 'QB', salary: 8000, gameInfo: 'KC@BUF 10/11/2026 01:00PM ET', rosterPosition: 'QB' },
  { id: '4', name: 'Amon-Ra St. Brown', team: 'DET', position: 'WR', salary: 7500, gameInfo: 'DET@SF 10/11/2026 04:25PM ET', rosterPosition: 'WR/FLEX' },
];
const picks: ManualPicks = { '1': { selected: true, points: '21.5' }, '4': { selected: true, points: '0' } };
const ids = (rows: SalaryPlayer[]) => rows.map(p => p.id);
test('team, game, position and selection filters compose without changing picks or salaries', () => {
  const original = JSON.stringify({ players, picks });
  assert.deepEqual(ids(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, team: 'KC' })), ['1', '2']);
  assert.deepEqual(ids(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, game: players[0]!.gameInfo })), ['3', '1', '2']);
  assert.deepEqual(ids(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, team: 'KC', position: 'QB', selectedOnly: true })), ['1']);
  assert.deepEqual(ids(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, selectedOnly: true })), ['4', '1']);
  assert.deepEqual(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, team: 'DET', position: 'QB' }), []);
  assert.equal(JSON.stringify({ players, picks }), original);
});
test('search accepts full team names, codes, punctuation and combined name/team queries', () => {
  for (const query of ['Kansas City', 'mahomes KC', 'PATRICK', 'Chiefs Mahomes']) {
    assert.ok(ids(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, query })).includes('1'));
  }
  assert.deepEqual(ids(filterManualPlayers(players, picks, { ...EMPTY_MANUAL_PLAYER_FILTERS, query: 'st brown' })), ['4']);
});
test('short pages cover every player once and clamp safely when filters shrink the list', () => {
  const rows = Array.from({ length: 57 }, (_, i) => i);
  assert.equal(manualPlayerPage(rows, 1).rows.length, 25);
  assert.deepEqual(manualPlayerPage(rows, 2).rows, rows.slice(25, 50));
  const last = manualPlayerPage(rows, 3);
  assert.deepEqual([last.start, last.end, last.pages], [51, 57, 3]);
  assert.deepEqual([1, 2, 3].flatMap(page => manualPlayerPage(rows, page).rows), rows);
  assert.equal(manualPlayerPage([1, 2], 3).page, 1);
  assert.deepEqual(manualPlayerPage([], 4), { rows: [], page: 1, pages: 1, start: 0, end: 0 });
});
