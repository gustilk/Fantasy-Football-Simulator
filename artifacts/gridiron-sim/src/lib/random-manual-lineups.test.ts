import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generateRandomManualLineups } from './random-manual-lineups.ts';

const kickoff = '2099-11-26T18:00:00.000Z';
function player(id: number, position: string, salary: number, game = id % 3) {
  const team = ['CHI', 'DET', 'DAL'][game]!;
  return {
    id: String(id), name: `${position} Player ${id}`, position,
    team, salary, gameInfo: `${team}@DET 11/26/2099 01:00PM ET`, rosterPosition: position,
    gameId: `game-${game}`, kickoff,
  };
}
function makePool() {
  const players = [
    ...Array.from({ length: 8 }, (_, i) => player(i + 1, 'QB', 4500 + i * 100)),
    ...Array.from({ length: 18 }, (_, i) => player(i + 20, 'RB', 4300 + i * 100)),
    ...Array.from({ length: 24 }, (_, i) => player(i + 50, 'WR', 3900 + i * 100)),
    ...Array.from({ length: 12 }, (_, i) => player(i + 80, 'TE', 3500 + i * 100)),
    ...Array.from({ length: 6 }, (_, i) => player(i + 100, 'DST', 2800 + i * 100)),
  ];
  return players;
}
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}
function key(lineup: { players: { id: string }[] }) {
  return lineup.players.map(p => p.id).sort().join(',');
}

test('generates 150 distinct legal Classic lineups without point inputs', () => {
  const pool = makePool();
  const before = structuredClone(pool);
  const lineups = generateRandomManualLineups(pool, 150, seededRandom(7421));

  assert.equal(lineups.length, 150);
  assert.equal(new Set(lineups.map(key)).size, 150);
  assert.deepEqual(pool, before);
  for (const lineup of lineups) {
    const players = lineup.players;
    const positions = players.map(p => p.position);
    assert.equal(players.length, 9);
    assert.equal(new Set(players.map(p => p.id)).size, 9);
    assert.equal(positions.filter(p => p === 'QB').length, 1);
    assert.ok(positions.filter(p => p === 'RB').length >= 2);
    assert.ok(positions.filter(p => p === 'WR').length >= 3);
    assert.ok(positions.filter(p => p === 'TE').length >= 1);
    assert.equal(positions.filter(p => p === 'DST').length, 1);
    assert.equal(new Set(players.map(p => p.gameId)).size >= 2, true);
    assert.equal(lineup.salary, players.reduce((sum, p) => sum + p.salary, 0));
    assert.ok(lineup.salary <= 50000);
    assert.equal('mean' in players[0]!, false);
  }
});

test('returns the feasible unique lineup count when fewer than requested exist', () => {
  const onlyLineup = [
    player(1, 'QB', 5000, 0),
    player(2, 'RB', 5000, 0), player(3, 'RB', 5000, 0),
    player(4, 'WR', 5000, 1), player(5, 'WR', 5000, 1), player(6, 'WR', 5000, 1),
    player(7, 'TE', 5000, 1), player(8, 'TE', 5000, 1),
    player(9, 'DST', 5000, 0),
  ];

  const lineups = generateRandomManualLineups(onlyLineup, 150, seededRandom(14));
  assert.equal(lineups.length, 1);
  assert.deepEqual(lineups[0]!.players.map(p => p.id).sort(), onlyLineup.map(p => p.id).sort());
});

test('returns no lineups for a one-game pool or an over-budget minimum roster', () => {
  const oneGame = makePool().map(p => ({ ...p, gameId: 'one-game' }));
  assert.deepEqual(generateRandomManualLineups(oneGame, 150, seededRandom(2)), []);

  const expensive = makePool().map(p => ({ ...p, salary: 8000 }));
  assert.deepEqual(generateRandomManualLineups(expensive, 150, seededRandom(3)), []);
});

test('rejects invalid counts and duplicate players', () => {
  const pool = makePool();
  assert.throws(() => generateRandomManualLineups(pool, 151), /1–150/);
  assert.throws(() => generateRandomManualLineups([...pool, pool[0]!]), /Invalid, duplicate/);
});
