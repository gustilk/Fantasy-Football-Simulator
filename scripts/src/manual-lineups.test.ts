import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseSalaryCsv, lineupSlots, exportLineups } from '../../artifacts/gridiron-sim/src/lib/lineups';
import { generateRandomManualLineups } from '../../artifacts/gridiron-sim/src/lib/random-manual-lineups';
import { buildManualLineupPool, manualSalaryGame, manualContestSignature, readManualPicks, saveManualPicks, MANUAL_LINEUP_COUNT, type ManualPicks, type ManualSalaryCandidate } from '../../artifacts/gridiron-sim/src/lib/manual-lineups';

// "My Picks" generates random legal lineups from selected players. Salary is only a roster/cap
// constraint, so these tests never rely on projected points or a points-ranked optimizer.
const now = Date.parse('2026-10-06T20:00:00Z');
const FUTURE = '2099-10-11T17:00:00.000Z';
const positions = ['QB', 'QB', 'RB', 'RB', 'RB', 'WR', 'WR', 'WR', 'WR', 'TE', 'TE', 'DST', 'DST'] as const;
const costs = [7000, 6000, 8000, 7000, 3000, 9000, 6000, 5000, 3000, 4000, 2500, 3500, 2500];
const csv = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev\n' + positions.map((pos, i) =>
  [pos, `Player ${i}`, 100 + i, pos === 'RB' || pos === 'WR' || pos === 'TE' ? `${pos}/FLEX` : pos,
    costs[i], i % 2 ? 'DAL@SF 10/11/2026 04:25PM ET' : 'PHI@JAX 10/11/2026 01:00PM ET', i % 2 ? 'SF' : 'PHI'].join(',')).join('\n');
const salaries = parseSalaryCsv(csv);
const picks: ManualPicks = Object.fromEntries(salaries.map(p => [p.id, { selected: true, points: '' }]));

/** The pool builder is pregame-checked against the clock; generation is checked against the real clock. */
const futurePool = (pool: ManualSalaryCandidate[]) => pool.map(p => ({ ...p, kickoff: FUTURE }));
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
const key = (lineup: { players: { id: string }[] }) => lineup.players.map(p => p.id).sort().join(',');
/** Brute-force every legal 9-player Classic roster in the pool. */
function allLegal(pool: ManualSalaryCandidate[]) {
  const legal: { players: ManualSalaryCandidate[]; salary: number }[] = [];
  function visit(index: number, chosen: ManualSalaryCandidate[]) {
    if (chosen.length === 9) {
      const salary = chosen.reduce((sum, p) => sum + p.salary, 0);
      try { lineupSlots({ players: chosen, salary }); } catch { return; }
      if (salary <= 50000) legal.push({ players: chosen, salary });
      return;
    }
    if (index === pool.length) return;
    visit(index + 1, chosen);
    visit(index + 1, [...chosen, pool[index]!]);
  }
  visit(0, []);
  return legal;
}

test('the candidate pool contains only selected players with official salaries and carries no points', () => {
  const list = structuredClone(picks);
  list[salaries[1]!.id] = { selected: false, points: '999' };
  const before = structuredClone({ salaries, list });
  const pool = buildManualLineupPool(salaries, list, now);
  assert.equal(pool.length, salaries.length - 1);
  assert.equal(pool.some(p => p.id === salaries[1]!.id), false);
  for (const player of pool) {
    assert.equal(player.salary, salaries.find(p => p.id === player.id)!.salary);
    assert.equal('mean' in player, false);
    assert.equal('points' in player, false);
  }
  assert.deepEqual({ salaries, list }, before);
});

test('every generated lineup is a legal Classic roster, distinct, within the cap, and uses only pool players with their DraftKings IDs', () => {
  const pool = futurePool(buildManualLineupPool(salaries, picks, now));
  const exact = allLegal(pool);
  assert.ok(exact.length > 0 && exact.length < MANUAL_LINEUP_COUNT, 'fixture must be small enough to enumerate fully');
  const lineups = generateRandomManualLineups(pool, MANUAL_LINEUP_COUNT, seededRandom(11));
  assert.equal(new Set(lineups.map(key)).size, lineups.length);
  const exactKeys = new Set(exact.map(key));
  for (const lineup of lineups) {
    assert.ok(exactKeys.has(key(lineup)), 'generated an illegal or unknown roster');
    assert.ok(lineup.salary <= 50000);
    assert.equal(lineup.salary, lineup.players.reduce((sum, p) => sum + p.salary, 0));
    assert.equal(new Set(lineup.players.map(p => p.gameId)).size >= 2, true);
    for (const player of lineup.players) assert.equal(player.salary, salaries.find(s => s.id === player.id)!.salary);
    assert.equal(lineupSlots(lineup).map(s => s.slot).join(','), 'QB,RB,RB,WR,WR,WR,TE,FLEX,DST');
  }
  // With fewer feasible rosters than requested, every distinct feasible roster is returned.
  assert.equal(lineups.length, exact.length);
});

test('unselected players are never used and exports list DraftKings IDs in slot order', () => {
  const list = structuredClone(picks);
  list['101'] = { selected: false, points: '99999' };
  const pool = futurePool(buildManualLineupPool(salaries, list, now));
  const lineups = generateRandomManualLineups(pool, 5, seededRandom(3));
  assert.ok(lineups.length > 0);
  assert.ok(lineups.every(l => l.players.every(p => p.id !== '101')));
  const exported = exportLineups(lineups).trim().split('\r\n');
  assert.equal(exported[0], 'QB,RB,RB,WR,WR,WR,TE,FLEX,DST');
  assert.equal(exported.length, lineups.length + 1);
  lineups.forEach((lineup, index) => assert.equal(exported[index + 1], lineupSlots(lineup).map(({ player }) => player.id).join(',')));
});

test('insufficient positions, a single game and over-budget pools produce no lineup instead of an invalid one', () => {
  const pool = futurePool(buildManualLineupPool(salaries, picks, now));
  assert.deepEqual(generateRandomManualLineups(pool.filter(p => p.position !== 'DST'), 5, seededRandom(1)), []);
  assert.deepEqual(generateRandomManualLineups(pool.map(p => ({ ...p, salary: 10000 })), 5, seededRandom(1)), []);
  assert.deepEqual(generateRandomManualLineups(pool.map(p => ({ ...p, gameId: 'one-game' })), 5, seededRandom(1)), []);
});

test('invalid generator requests and malformed pools are rejected', () => {
  const pool = futurePool(buildManualLineupPool(salaries, picks, now));
  assert.throws(() => generateRandomManualLineups(pool, 0), /Choose 1–150 lineups/);
  assert.throws(() => generateRandomManualLineups(pool, 151), /Choose 1–150 lineups/);
  assert.throws(() => generateRandomManualLineups([...pool, pool[0]!], 5), /duplicate/i);
  assert.throws(() => generateRandomManualLineups(pool.map(p => ({ ...p, kickoff: '2020-01-01T00:00:00.000Z' })), 5), /started/i);
  assert.throws(() => generateRandomManualLineups(pool, 5, () => 1), /Random source/);
});

test('pool building ignores point text, requires a selection and rejects started games', () => {
  const noisy = structuredClone(picks);
  noisy['100']!.points = 'hello'; noisy['101']!.points = '1e999'; noisy['102']!.points = '-2.25';
  assert.deepEqual(buildManualLineupPool(salaries, noisy, now), buildManualLineupPool(salaries, picks, now));
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
