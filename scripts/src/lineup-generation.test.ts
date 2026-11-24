import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exportLineups, lineupSlots, parseSalaryCsv, type Lineup, type LineupPlayer } from '../../artifacts/gridiron-sim/src/lib/lineups';
import { optimizeLineups } from '../../artifacts/gridiron-sim/src/lib/lineup-optimizer';

const FUTURE = '2099-10-11T17:00:00Z';
let counter = 0;
function make(position: LineupPlayer['position'], salary: number, mean: number, team: string, gameId: string, name = `${position} ${counter}`): LineupPlayer {
  const id = String(1000 + counter++);
  return { id, name, position, team, salary, gameInfo: 'x', rosterPosition: position === 'DST' || position === 'QB' ? position : `${position}/FLEX`,
    mean, gameId, kickoff: FUTURE, projectionSource: 'test' };
}
// 15 players across two games: enough for many legal rosters, small enough to brute-force.
const pool: LineupPlayer[] = [
  make('QB', 7000, 24, 'BUF', 'g1'), make('QB', 6000, 21, 'DET', 'g1'), make('QB', 5000, 19, 'DAL', 'g2'),
  make('RB', 8000, 19, 'BUF', 'g1'), make('RB', 6500, 16, 'DET', 'g1'), make('RB', 4500, 13, 'DAL', 'g2'), make('RB', 3500, 9, 'SF', 'g2'),
  make('WR', 8500, 21, 'DET', 'g1'), make('WR', 6000, 16, 'BUF', 'g1'), make('WR', 5000, 14, 'SF', 'g2'), make('WR', 4000, 11, 'DAL', 'g2'), make('WR', 3000, 8, 'SF', 'g2'),
  make('TE', 4500, 12, 'BUF', 'g1'), make('TE', 3000, 8, 'DAL', 'g2'),
  make('DST', 3200, 9, 'SF', 'g2'),
];
const compare = (a: Lineup, b: Lineup) => (Math.abs(b.points - a.points) > 1e-9 ? b.points - a.points : 0) || a.salary - b.salary
  || a.players.map(p => p.id).sort().join(',').localeCompare(b.players.map(p => p.id).sort().join(','));
const identity = (lineup: Lineup) => lineup.players.map(p => p.id).sort().join(',');

function bruteForce(players: LineupPlayer[]): Lineup[] {
  const out: Lineup[] = [];
  function visit(index: number, chosen: LineupPlayer[]) {
    if (chosen.length === 9) {
      const salary = chosen.reduce((n, p) => n + p.salary, 0);
      const lineup: Lineup = { players: chosen, salary, points: chosen.reduce((n, p) => n + p.mean, 0) };
      try { lineupSlots(lineup); } catch { return; }
      out.push(lineup);
      return;
    }
    if (index === players.length || chosen.length + (players.length - index) < 9) return;
    visit(index + 1, [...chosen, players[index]!]);
    visit(index + 1, chosen);
  }
  visit(0, []);
  return out.sort(compare);
}

test('top-K optimizer exactly matches exhaustive search for K = 1..5', () => {
  const exact = bruteForce(pool);
  assert.ok(exact.length >= 5, 'fixture must have enough legal rosters');
  for (let k = 1; k <= 5; k++) {
    const top = optimizeLineups(pool, k);
    assert.equal(top.length, k);
    assert.deepEqual(top.map(identity), exact.slice(0, k).map(identity), `K=${k}`);
    top.forEach((lineup, i) => {
      assert.ok(Math.abs(lineup.points - exact[i]!.points) < 1e-9);
      assert.equal(lineup.salary, exact[i]!.salary);
    });
  }
});

test('every optimized lineup obeys the salary cap, roster slots, two-game minimum and uniqueness rules', () => {
  for (const lineup of optimizeLineups(pool, 5)) {
    assert.ok(lineup.salary <= 50000);
    assert.equal(lineup.salary, lineup.players.reduce((n, p) => n + p.salary, 0));
    assert.equal(lineup.players.length, 9);
    assert.equal(new Set(lineup.players.map(p => p.id)).size, 9);
    assert.ok(new Set(lineup.players.map(p => p.gameId)).size >= 2);
    assert.equal(lineupSlots(lineup).map(s => s.slot).join(','), 'QB,RB,RB,WR,WR,WR,TE,FLEX,DST');
  }
});

test('results are deterministic and the salary cap is respected even when higher scorers cost more', () => {
  assert.deepEqual(optimizeLineups(pool, 3).map(identity), optimizeLineups([...pool].reverse(), 3).map(identity));
  const pricey = pool.map(p => (p.position === 'QB' ? { ...p, salary: 12000 } : p));
  for (const lineup of optimizeLineups(pricey, 5)) assert.ok(lineup.salary <= 50000);
  // when every roster is over the cap the optimizer returns nothing instead of an illegal lineup
  assert.deepEqual(optimizeLineups(pool.map(p => ({ ...p, salary: 10000 })), 3), []);
});

test('lineups from a single game are rejected and a missing position yields no lineup', () => {
  assert.deepEqual(optimizeLineups(pool.map(p => ({ ...p, gameId: 'only' })), 3), []);
  assert.deepEqual(optimizeLineups(pool.filter(p => p.position !== 'TE'), 3), []);
});

test('invalid optimizer input is rejected: count range, duplicate IDs, bad salary or points, missing game', () => {
  assert.throws(() => optimizeLineups(pool, 0), /Choose 1–5 lineups/);
  assert.throws(() => optimizeLineups(pool, 6), /Choose 1–5 lineups/);
  assert.throws(() => optimizeLineups([...pool, { ...pool[0]!, name: 'Someone else' }], 1), /duplicate/i);
  assert.throws(() => optimizeLineups([{ ...pool[0]!, mean: Number.NaN }, ...pool.slice(1)], 1), /Invalid/);
  assert.throws(() => optimizeLineups([{ ...pool[0]!, salary: 0 }, ...pool.slice(1)], 1), /Invalid/);
  assert.throws(() => optimizeLineups([{ ...pool[0]!, gameId: '' }, ...pool.slice(1)], 1), /Invalid/);
});

test('CSV export keeps DraftKings IDs in slot order, uses CRLF, and refuses started games or mixed formats', () => {
  const lineups = optimizeLineups(pool, 3);
  const text = exportLineups(lineups);
  assert.ok(text.endsWith('\r\n'));
  const rows = text.trim().split('\r\n');
  assert.equal(rows[0], 'QB,RB,RB,WR,WR,WR,TE,FLEX,DST');
  lineups.forEach((lineup, i) => assert.equal(rows[i + 1], lineupSlots(lineup).map(s => s.player.id).join(',')));
  const started = lineups.map(l => ({ ...l, players: l.players.map(p => ({ ...p, kickoff: '2020-01-01T00:00:00Z' })) }));
  assert.throws(() => exportLineups(started), /game has started/i);
  assert.throws(() => exportLineups([lineups[0]!, { ...lineups[1]!, format: 'showdown' as const }]), /one contest format/i);
  assert.throws(() => exportLineups([]), /one contest format/i);
});

test('salary CSV parsing preserves DraftKings IDs and salaries exactly and rejects bad contest files', () => {
  const header = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev';
  const row = (extra: Partial<Record<string, string>> = {}) => {
    const v = { pos: 'QB', name: 'Josh Allen', id: '12345', roster: 'QB', salary: '8200', info: 'BUF@DET 10/04/2035 01:00PM ET', team: 'BUF', ...extra };
    return [v.pos, v.name, v.id, v.roster, v.salary, v.info, v.team].join(',');
  };
  const parsed = parseSalaryCsv(`${header}\n${row()}\n${row({ pos: 'DST', name: 'Bills', id: '12346', roster: 'DST', salary: '3000' })}`);
  assert.deepEqual(parsed.map(p => [p.id, p.salary, p.position]), [['12345', 8200, 'QB'], ['12346', 3000, 'DST']]);
  assert.throws(() => parseSalaryCsv(`${header}\n${row({ id: 'abc' })}`), /Invalid player/);
  assert.throws(() => parseSalaryCsv(`${header}\n${row({ salary: '8200.5' })}`), /Invalid player/);
  assert.throws(() => parseSalaryCsv(`${header}\n${row({ roster: 'CPT' })}`), /Captain/);
  assert.throws(() => parseSalaryCsv(`${header}\n${row()}\n${row()}`), /Duplicate player/);
  assert.throws(() => parseSalaryCsv('Position,Name,Salary\nQB,A,5000'), /Missing DraftKings column/);
});
