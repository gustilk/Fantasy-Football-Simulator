import assert from 'node:assert/strict';
import test from 'node:test';
import { gameProjections } from '../src/lib/game-projections.ts';
import type { PlayerProjection, SimulationResult } from '../src/lib/simulator';

const player = (name: string, draftKings: number, played = true): PlayerProjection => ({
  id: name, name, team: 'Team', position: 'QB', draftKings, played,
  passYards: 0, passTD: 0, interceptions: 0, rushYards: 0, rushTD: 0,
  receptions: 0, receivingYards: 0, receivingTD: 0, fumblesLost: 0,
});
const fixture = (): SimulationResult => ({
  seed: 1, awayScore: 0, homeScore: 0, totalPlays: { away: 0, home: 0 }, overview: [], drives: [],
  players: [player('A', 40), player('B', 0, false), player('C', 20), player('D', -4)],
  ensemble: { runs: 200, awayWinPct: 50, homeWinPct: 50, tiePct: 0,
    fantasy: [10, 25, 0, -1].map(mean => ({ mean, p10: mean, p90: mean })) },
});

test('uses ensemble means, keeps identity when sorting and never filters on one-game participation', () => {
  const result = fixture();
  const original = structuredClone(result);
  assert.deepEqual(gameProjections(result)?.map(p => [p.id, p.mean]),
    [['B', 25], ['A', 10], ['C', 0], ['D', -1]]);
  assert.deepEqual(result, original);
});

test('older or incomplete saves never fall back to single-game points', () => {
  const result = fixture();
  result.ensemble = undefined;
  assert.equal(gameProjections(result), null);
  result.ensemble = fixture().ensemble;
  result.ensemble!.fantasy.pop();
  assert.equal(gameProjections(result), null);
  result.ensemble = fixture().ensemble;
  result.players[0].draftKings = undefined as unknown as number;
  assert.equal(gameProjections(result), null);
});

test('invalid means fail explicitly and non-Classic positions are omitted', () => {
  const result = fixture();
  result.ensemble!.fantasy[0].mean = NaN;
  assert.equal(gameProjections(result), null);
  result.ensemble!.fantasy[0].mean = 10;
  result.players[0].position = 'K';
  assert.equal(gameProjections(result)?.some(p => p.position === 'K'), false);
});