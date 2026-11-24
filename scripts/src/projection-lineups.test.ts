import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lineupSlots, type LineupPlayer } from '../../artifacts/gridiron-sim/src/lib/lineups';
import { buildProjectionPortfolio, combineForecastSlates } from '../../artifacts/gridiron-sim/src/lib/projection-lineups';
import { seededRandom, type JointScenarios } from '../../artifacts/gridiron-sim/src/lib/lineup-scenarios';
import type { DKSlate } from '../../artifacts/gridiron-sim/src/lib/draftkings-board';

const FUTURE = '2099-11-26T17:00:00Z';
let counter = 0;
function make(position: LineupPlayer['position'], salary: number, mean: number, team: string, gameId: string): LineupPlayer {
  const id = String(5000 + counter++);
  return { id, name: `${position} ${id}`, position, team, salary, gameInfo: 'x', rosterPosition: position,
    mean, gameId, kickoff: FUTURE, projectionSource: 'test' };
}
/** Three games, two teams each, 6 teams; deterministic pool. */
function buildPool(): LineupPlayer[] {
  const teams = [['AAA', 'g1'], ['BBB', 'g1'], ['CCC', 'g2'], ['DDD', 'g2'], ['EEE', 'g3'], ['FFF', 'g3']] as const;
  const pool: LineupPlayer[] = [];
  teams.forEach(([team, game], t) => {
    pool.push(make('QB', 5200 + t * 300, 17 + t, team, game));
    for (let i = 0; i < 3; i++) pool.push(make('RB', 4000 + i * 1200 + t * 100, 9 + i * 2 + t * 0.2, team, game));
    for (let i = 0; i < 4; i++) pool.push(make('WR', 3500 + i * 1500 + t * 100, 8 + i * 2 + t * 0.2, team, game));
    pool.push(make('TE', 3000 + (t % 3) * 1000, 6 + (t % 3) * 2, team, game));
    pool.push(make('DST', 2200 + (t % 3) * 400, 6 + (t % 3), team, game));
  });
  return pool;
}
/** Per-game shared shock so same-game players move together; mean-preserving. */
function scenariosFor(pool: LineupPlayer[], count = 600, seed = 7): JointScenarios {
  const make = (offset: number) => {
    const random = seededRandom(seed + offset);
    const shocks = new Map<string, number[]>();
    for (const game of new Set(pool.map(p => p.gameId))) shocks.set(game, Array.from({ length: count }, () => 0.4 + random() * 1.2));
    const samples = new Map<string, Float64Array>();
    for (const player of pool) {
      const shock = shocks.get(player.gameId)!;
      samples.set(player.id, Float64Array.from({ length: count }, (_, s) => Math.max(0, player.mean * shock[s]! + (random() - 0.5) * 6)));
    }
    return { samples, count };
  };
  return { ...make(0), reporting: make(1000) };
}

test('every portfolio lineup is a legal, distinct Classic lineup within the cap', () => {
  const pool = buildPool();
  const result = buildProjectionPortfolio(pool, scenariosFor(pool), { count: 40 });
  assert.equal(result.lineups.length, 40);
  const keys = new Set<string>();
  for (const lineup of result.lineups) {
    lineupSlots(lineup);
    assert.ok(lineup.salary <= 50000);
    assert.ok(new Set(lineup.players.map(p => p.gameId)).size >= 2);
    keys.add(lineup.players.map(p => p.id).sort().join(','));
    assert.ok(lineup.tournament && Number.isFinite(lineup.tournament.p90) && lineup.tournament.scenarios === 600);
  }
  assert.equal(keys.size, result.lineups.length);
});

test('exposure limit and overlap limit are respected', () => {
  const pool = buildPool();
  const result = buildProjectionPortfolio(pool, scenariosFor(pool), { count: 50, maxExposure: 0.4, maxOverlap: 7 });
  assert.ok(result.lineups.length >= 30, 'pool is big enough for a varied portfolio');
  const cap = Math.ceil(0.4 * 50);
  for (const row of result.exposure) assert.ok(row.lineups <= cap, `${row.name} used ${row.lineups} > ${cap}`);
  for (let a = 0; a < result.lineups.length; a++) for (let b = a + 1; b < result.lineups.length; b++) {
    const ids = new Set(result.lineups[a]!.players.map(p => p.id));
    const shared = result.lineups[b]!.players.filter(p => ids.has(p.id)).length;
    assert.ok(shared <= result.overlapUsed, `lineups ${a}/${b} share ${shared}`);
  }
});

test('the same seed gives the same portfolio; a different seed may differ', () => {
  const pool = buildPool(), scenarios = scenariosFor(pool);
  const ids = (r: ReturnType<typeof buildProjectionPortfolio>) => r.lineups.map(l => l.players.map(p => p.id).sort().join(',')).join('|');
  assert.equal(ids(buildProjectionPortfolio(pool, scenarios, { count: 20, seed: 1 })), ids(buildProjectionPortfolio(pool, scenarios, { count: 20, seed: 1 })));
});

test('projections matter: a player whose scenarios are far higher is used heavily', () => {
  const pool = buildPool();
  const scenarios = scenariosFor(pool);
  const star = pool.find(p => p.position === 'QB' && p.team === 'AAA')!;
  const boosted = new Map(scenarios.samples);
  for (const set of [boosted, scenarios.reporting!.samples]) set.set(star.id, Float64Array.from(set.get(star.id)!, v => v + 14));
  const result = buildProjectionPortfolio(pool, { ...scenarios, samples: boosted }, { count: 30, maxExposure: 0.9 });
  const used = result.exposure.find(row => row.id === star.id)?.lineups ?? 0;
  const otherQbMax = Math.max(...result.exposure.filter(r => r.position === 'QB' && r.id !== star.id).map(r => r.lineups), 0);
  assert.ok(used > otherQbMax, `star QB in ${used} lineups vs best other QB ${otherQbMax}`);
});

test('a single QB candidate is allowed to exceed the exposure limit and is reported', () => {
  const pool = buildPool().filter(p => p.position !== 'QB' || p.team === 'AAA');
  const result = buildProjectionPortfolio(pool, scenariosFor(pool), { count: 20, maxExposure: 0.3 });
  assert.ok(result.lineups.length > 0);
  assert.ok(result.notes.some(n => /exposure/i.test(n)));
  assert.ok(result.lineups.every(l => l.players.filter(p => p.position === 'QB').length === 1));
});

test('infeasible or incomplete pools return no lineups with a reason, not invalid lineups', () => {
  const pool = buildPool();
  const noDst = buildProjectionPortfolio(pool.filter(p => p.position !== 'DST'), scenariosFor(pool.filter(p => p.position !== 'DST')), { count: 5 });
  assert.equal(noDst.lineups.length, 0);
  assert.ok(noDst.notes.length);
  const oneGame = pool.filter(p => p.gameId === 'g1');
  assert.equal(buildProjectionPortfolio(oneGame, scenariosFor(oneGame), { count: 5 }).lineups.length, 0);
});

test('invalid input is rejected', () => {
  const pool = buildPool();
  assert.throws(() => buildProjectionPortfolio(pool, scenariosFor(pool), { count: 151 }), /1–150/);
  assert.throws(() => buildProjectionPortfolio(pool, scenariosFor(pool), { count: 0 }), /1–150/);
  assert.throws(() => buildProjectionPortfolio(pool, scenariosFor(pool), { maxExposure: 0 }), /exposure/i);
  assert.throws(() => buildProjectionPortfolio([...pool, { ...pool[0]! }], scenariosFor(pool)), /duplicate/i);
  const missing = scenariosFor(pool);
  missing.samples.delete(pool[3]!.id);
  assert.throws(() => buildProjectionPortfolio(pool, missing), /no simulated outcomes/);
});

test('combineForecastSlates keeps the newest forecast per game across slates', () => {
  const forecast = (gameId: string, seed: number) => ({ gameId, seed }) as unknown as DKSlate['forecasts'][number];
  const slate = (id: string, savedAt: string, forecasts: DKSlate['forecasts']): DKSlate => ({ id, season: 2026, sunday: id, createdAt: savedAt, savedAt,
    timezone: 'America/Chicago', forecasts, failures: [] });
  const merged = combineForecastSlates([
    slate('old', '2026-11-20T00:00:00Z', [forecast('g1', 1), forecast('g2', 1)]),
    slate('new', '2026-11-23T00:00:00Z', [forecast('g1', 2)]),
    { ...slate('other-season', '2026-11-24T00:00:00Z', [forecast('g9', 9)]), season: 2025 },
  ], 2026);
  assert.deepEqual(merged.forecasts.map(f => `${f.gameId}:${f.seed}`).sort(), ['g1:2', 'g2:1']);
});
