import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateEnsemble } from '../../artifacts/gridiron-sim/src/lib/ensemble';
import type { SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';

const team = (name: string, qb: string, key: string) => ({
  name, qb, rb: `RB ${key}`, wr1: `WR1 ${key}`, wr2: `WR2 ${key}`, wr3: `WR3 ${key}`, te: `TE ${key}`, kicker: 'K',
  passRating: 70, rushRating: 70, defenseRating: 60, context: '',
  roster: [{ id: `${key}qb`, name: qb, position: 'QB' }, { id: `${key}rb`, name: `RB ${key}`, position: 'RB' },
    { id: `${key}w1`, name: `WR1 ${key}`, position: 'WR' }, { id: `${key}w2`, name: `WR2 ${key}`, position: 'WR' },
    { id: `${key}w3`, name: `WR3 ${key}`, position: 'WR' }, { id: `${key}te`, name: `TE ${key}`, position: 'TE' }],
});
const input = (weather: SimulationInput['weather']) => ({
  away: team('Kansas City Chiefs', 'QB A', 'a'), home: team('Buffalo Bills', 'QB H', 'h'), weather, seed: 21,
}) as unknown as SimulationInput;
/** Average simulated DraftKings points by position from the ensemble (aligned with result.players). */
const mean = (r: ReturnType<typeof simulateEnsemble>, position: string) => {
  const idx = r.players.map((p, i) => (p.position === position ? i : -1)).filter(i => i >= 0);
  return idx.reduce((sum, i) => sum + r.ensemble!.fantasy[i]!.mean, 0) / idx.length;
};

test('rain and wind lower passing production, and the running game is not hurt', () => {
  const calm = simulateEnsemble(input({ temperatureF: 68, windMph: 5, precipitation: 'none' }), 400);
  const bad = simulateEnsemble(input({ temperatureF: 38, windMph: 22, precipitation: 'heavy' }), 400);
  assert.ok(mean(bad, 'QB') < mean(calm, 'QB'), `QB ${mean(bad, 'QB')} vs ${mean(calm, 'QB')}`);
  assert.ok(mean(bad, 'WR') < mean(calm, 'WR'), `WR ${mean(bad, 'WR')} vs ${mean(calm, 'WR')}`);
  assert.ok(mean(bad, 'TE') < mean(calm, 'TE'), `TE ${mean(bad, 'TE')} vs ${mean(calm, 'TE')}`);
  assert.ok(mean(bad, 'RB') >= mean(calm, 'RB') * 0.97, `RB ${mean(bad, 'RB')} vs ${mean(calm, 'RB')}`);
});
