import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSalaryCsv, lineupSlots, type SalaryPlayer } from '../../artifacts/gridiron-sim/src/lib/lineups';
import { optimizeLineups } from '../../artifacts/gridiron-sim/src/lib/lineup-optimizer';
import { buildManualLineupPool, manualSalaryGame, manualContestSignature, readManualPicks, saveManualPicks, type ManualPicks } from '../../artifacts/gridiron-sim/src/lib/manual-lineups';

const now = Date.parse('2026-10-06T20:00:00Z');
const positions = ['QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'DST', 'DST'] as const;
const costs = [7000, 6000, 8000, 7000, 3000, 9000, 6000, 5000, 3000, 4000, 2500, 3500, 2500];
const points = [30.5, 24, 29, 27, 12, 33, 23, 20, 11, 18, 9, 12, 8];
const csv = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev\n' + positions.map((pos, i) =>
  [pos, `Player ${i}`, 100 + i, pos === 'RB' || pos === 'WR' || pos === 'TE' ? `${pos}/FLEX` : pos,
    costs[i], i % 2 ? 'DAL@SF 10/11/2026 04:25PM ET' : 'PHI@JAX 10/11/2026 01:00PM ET', i % 2 ? 'SF' : 'PHI'].join(',')).join('\n');
const salaries = parseSalaryCsv(csv);
const picks: ManualPicks = Object.fromEntries(salaries.map((p, i) => [p.id, { selected: true, points: String(points[i]) }]));

test('finds the exact highest-point legal lineup using only selected players and official salaries', () => {
  const list = structuredClone(picks);
  list[salaries[1]!.id]!.selected = false;
  list[salaries[1]!.id]!.points = '999';
  const pool = buildManualLineupPool(salaries, list, now);
  assert.equal(pool.some(p => p.id === salaries[1]!.id), false);
  for (const player of pool) assert.equal(player.salary, salaries.find(p => p.id === player.id)!.salary);
  const [best] = optimizeLineups(pool, 1);
  assert.ok(best);
  assert.equal(best.players.length, 9);
  assert.ok(best.salary <= 50000);
  assert.equal(new Set(best.players.map(p => p.id)).size, 9);
  assert.equal(lineupSlots(best).map(s => s.slot).join(','), 'QB,RB,RB,WR,WR,WR,TE,FLEX,DST');
  let exactPoints = -Infinity, exactCost = Infinity;
  function visit(index: number, selected: typeof pool) {
    if (selected.length === 9) {
      const salary = selected.reduce((sum, p) => sum + p.salary, 0);
      const total = selected.reduce((sum, p) => sum + p.mean, 0);
      try { lineupSlots({ players: selected, salary, points: total }); }
      catch { return; }
      if (total > exactPoints || (total === exactPoints && salary < exactCost)) { exactPoints = total; exactCost = salary; }
      return;
    }
    if (index === pool.length) return;
    visit(index + 1, selected);
    visit(index + 1, [...selected, pool[index]!]);
  }
  visit(0, []);
  assert.equal(best.points, exactPoints);
  assert.equal(best.salary, exactCost);
  assert.deepEqual(picks, Object.fromEntries(salaries.map((p, i) => [p.id, { selected: true, points: String(points[i]) }])));
});

test('insufficient positions, single-game lists and over-budget pools produce no legal lineup', () => {
  const pool = buildManualLineupPool(salaries, picks, now);
  assert.deepEqual(optimizeLineups(pool.filter(p => p.position !== 'DST'), 1), []);
  assert.deepEqual(optimizeLineups(pool.map(p => ({ ...p, salary: 10000 })), 1), []);
  assert.deepEqual(optimizeLineups(pool.map(p => ({ ...p, gameId: 'one-game' })), 1), []);
});

test('blank points are not silently zero; explicit zero and negatives are accepted', () => {
  const list = structuredClone(picks);
  list['100']!.points = '';
  assert.throws(() => buildManualLineupPool(salaries, list, now), /Player 0.*valid projected points/);
  for (const invalid of ['Infinity', 'NaN', 'hello', '1e999']) {
    list['100']!.points = invalid;
    assert.throws(() => buildManualLineupPool(salaries, list, now));
  }
  list['100']!.points = '0'; list['101']!.points = '-2.25';
  const pool = buildManualLineupPool(salaries, list, now);
  assert.equal(pool.find(p => p.id === '100')!.mean, 0);
  assert.equal(pool.find(p => p.id === '101')!.mean, -2.25);
  assert.throws(() => buildManualLineupPool(salaries, {}, now), /Select players/);
  assert.throws(() => buildManualLineupPool(salaries, picks, Date.parse('2027-01-01')), /kickoff has passed/);
});

test('CSV matchup and Eastern kickoff conversion supports summer and winter, rejects invalid dates and teams', () => {
  assert.equal(manualSalaryGame(salaries[0]!).kickoff, '2026-10-11T17:00:00.000Z');
  const winter = { ...salaries[0]!, gameInfo: 'PHI@JAX 12/13/2026 01:00PM ET' };
  assert.equal(manualSalaryGame(winter).kickoff, '2026-12-13T18:00:00.000Z');
  for (const gameInfo of ['PHI@JAX 02/30/2026 01:00PM ET', 'PHI@JAX 10/11/2026 13:00PM ET', 'PHI@JAX 10/11/2026 01:00PM EST', '', 'SF@DAL 10/11/2026 01:00PM ET']) {
    assert.throws(() => manualSalaryGame({ ...salaries[0]!, gameInfo }));
  }
});

test('manual drafts round-trip, remain contest-specific and preserve corrupt storage on read', () => {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  const signature = manualContestSignature(salaries);
  assert.equal(manualContestSignature([...salaries].reverse()), signature);
  saveManualPicks(storage, signature, picks);
  assert.deepEqual(readManualPicks(storage, signature), picks);
  assert.deepEqual(readManualPicks(storage, manualContestSignature(salaries.map((p, i) => ({ ...p, salary: p.salary + (i ? 0 : 100) })))), {});
  assert.deepEqual(readManualPicks(storage, manualContestSignature(salaries.map(p => ({ ...p, gameInfo: p.gameInfo.replace('10/11', '10/18') })))), {});
  const saved = raw;
  raw = '{broken';
  assert.throws(() => readManualPicks(storage, signature), /could not be read/);
  assert.equal(raw, '{broken');
  raw = saved;
  assert.throws(() => saveManualPicks({ setItem: () => { throw new Error('quota'); } }, signature, picks), /quota/);
});
