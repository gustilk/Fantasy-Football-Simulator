import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manualLineupIssue, manualRosterReadiness } from '../../artifacts/gridiron-sim/src/lib/manual-lineup-readiness';
import { optimizeLineups } from '../../artifacts/gridiron-sim/src/lib/lineup-optimizer';
import type { LineupPlayer } from '../../artifacts/gridiron-sim/src/lib/lineups';

const positions = ['QB', 'RB', 'RB', 'WR', 'WR', 'WR', 'TE', 'RB', 'DST'] as const;
const pool: LineupPlayer[] = positions.map((position, i) => ({
  id: String(i), name: `Candidate ${i}`, team: i % 2 ? 'SF' : 'KC', position,
  rosterPosition: position, salary: 5000, mean: 20, gameId: `game-${i % 2}`,
  gameInfo: '', kickoff: '2099-01-01T18:00:00Z', projectionSource: 'manual',
}));
const picks = Object.fromEntries(pool.map(p => [p.id, { selected: true, points: '20' }]));
test('missing defense is specific, and extra QBs do not substitute for DST or FLEX', () => {
  const noDefense = pool.filter(p => p.position !== 'DST');
  assert.match(manualLineupIssue(noDefense), /1 DST \(team defense\)/);
  const missingFlex = pool.filter(p => p.id !== '7');
  assert.match(manualLineupIssue(missingFlex), /more RB, WR, or TE for FLEX/);
  const extraQb = [...missingFlex, { ...pool[0]!, id: 'extra', name: 'Extra QB' }];
  assert.match(manualLineupIssue(extraQb), /for FLEX/);
  assert.equal(manualRosterReadiness(pool, picks).issues.length, 0);
});
test('single-game and over-cap lists have distinct reasons and an exact minimum cost', () => {
  assert.match(manualLineupIssue(pool.map(p => ({ ...p, gameId: 'same' }))), /2 different games/);
  assert.match(manualLineupIssue(pool.map(p => ({ ...p, salary: 6000 }))), /\$54,000.*\$4,000 over/);
  assert.equal(manualLineupIssue(pool), '');
  const alternative = { ...pool[1]!, id: 'cheap', name: 'Cheap candidate', salary: 1000 };
  assert.equal(manualLineupIssue([...pool.map(p => ({ ...p, salary: 6000 })), alternative]), '');
});
test('diagnostics keep salaries, point estimates and selections unchanged', () => {
  const before = JSON.stringify({ pool, picks });
  manualRosterReadiness(pool, picks); manualLineupIssue(pool);
  assert.equal(JSON.stringify({ pool, picks }), before);
});
test('all candidates are considered: more than nine picks, a pool salary above cap, and a winner on a later page', () => {
  const many = [...pool, ...Array.from({ length: 50 }, (_, i) => ({
    ...pool[0]!, id: `extra-${i}`, name: `Extra quarterback ${i}`, mean: i === 49 ? 300 : 1,
  }))];
  assert.ok(many.length > 25);
  assert.ok(many.reduce((sum, p) => sum + p.salary, 0) > 50000);
  const [best] = optimizeLineups(many, 1);
  assert.ok(best);
  assert.equal(best.players.length, 9);
  assert.ok(best.players.some(p => p.id === 'extra-49'));
  assert.equal(best.points, 460);
  assert.equal(best.salary, 45000);
  assert.equal(many.length, 59);
});
