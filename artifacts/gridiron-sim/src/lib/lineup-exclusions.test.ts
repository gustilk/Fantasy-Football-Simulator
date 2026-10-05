import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLineupExclusions, exclusionKey, exclusionScope } from './lineup-exclusions.ts';

const player = { name: 'Receiver Jr.', team: 'CHI', gameInfo: 'CHI@GB 10/11/2026 01:00PM ET' };
test('excluded players are removed without modifying the original pool', () => {
  const pool = [{ ...player, id: '1' }, { ...player, name: 'Other Player', id: '2' }];
  const filtered = applyLineupExclusions(pool, new Set([exclusionKey(player)]));
  assert.deepEqual(filtered.map(p => p.id), ['2']);
  assert.equal(pool.length, 2);
});
test('excluding a player removes both Captain and FLEX entries', () => {
  const pool = [{ ...player, id: '1', rosterPosition: 'CPT' }, { ...player, name: 'Receiver', id: '2', rosterPosition: 'FLEX' }];
  assert.deepEqual(applyLineupExclusions(pool, new Set([exclusionKey(player)])), []);
});
test('exclusions do not remove an identically named player on another team', () => {
  assert.equal(applyLineupExclusions([{ ...player, team: 'GB' }], new Set([exclusionKey(player)])).length, 1);
});
test('clear exclusions restores the pool', () => {
  assert.deepEqual(applyLineupExclusions([player], new Set()), [player]);
});
test('preference scope separates weeks, seasons and formats but tolerates row order', () => {
  const scope = exclusionScope(2026, 'classic', [player]);
  assert.notEqual(scope, exclusionScope(2025, 'classic', [player]));
  assert.notEqual(scope, exclusionScope(2026, 'showdown', [player]));
  assert.notEqual(scope, exclusionScope(2026, 'classic', [{ gameInfo: 'CHI@GB 10/18/2026 01:00PM ET' }]));
  assert.equal(scope, exclusionScope(2026, 'classic', [player, player]));
});
