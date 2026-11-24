import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  availabilityAdjustedDistribution, BUST_FLOOR_POINTS, historicalPlayProbability, pairCorrelations, summarizeDistribution, weightedCorrelation,
} from '../../artifacts/gridiron-sim/src/lib/projection-distribution';
import { AVAILABILITY_COUNTS } from '../../artifacts/gridiron-sim/src/lib/availability-rates';
import { simulateEnsemble } from '../../artifacts/gridiron-sim/src/lib/ensemble';
import type { SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';
import { gameForecast, type DKSlate } from '../../artifacts/gridiron-sim/src/lib/draftkings-board';
import { readDKArchive, writeDKArchive } from '../../artifacts/gridiron-sim/src/lib/draftkings-archive';

const oneToHundred = Array.from({ length: 100 }, (_, i) => i + 1);

test('summary reports mean, median, P10, P75, P90, P95 and bust probability for a known sample', () => {
  const s = summarizeDistribution([...oneToHundred].reverse(), undefined, 10);
  assert.equal(s.mean, 50.5);
  assert.equal(s.median, 50);
  assert.equal(s.p10, 10);
  assert.equal(s.p75, 75);
  assert.equal(s.p90, 90);
  assert.equal(s.p95, 95);
  assert.equal(s.samples, 100);
  assert.equal(s.bustThreshold, 10);
  assert.equal(s.bustProbability, 0.09, 'strictly below 10 is 1..9');
  assert.ok(s.meanStdError > 2.8 && s.meanStdError < 3, `standard error ${s.meanStdError}`);
  assert.equal(summarizeDistribution([5, 5, 5]).bustProbability, undefined, 'no threshold means no bust claim');
});

test('outcome weights shift the quantiles, mean and bust probability; zero-weight outcomes are ignored', () => {
  const weights = oneToHundred.map(v => (v <= 10 ? 9 : 1));
  const s = summarizeDistribution(oneToHundred, weights, 12);
  assert.ok(s.median < 50 && s.mean < 50.5);
  assert.ok(s.bustProbability! > 0.5);
  const dropped = summarizeDistribution([1, 2, 3, 100], [1, 1, 1, 0]);
  assert.equal(dropped.p95, 3);
  assert.equal(dropped.mean, 2);
});

test('invalid distributions are rejected instead of guessed', () => {
  assert.throws(() => summarizeDistribution([]), /at least one/);
  assert.throws(() => summarizeDistribution([1, Number.NaN]), /finite/);
  assert.throws(() => summarizeDistribution([1, 2], [1]), /match/);
  assert.throws(() => summarizeDistribution([1, 2], [1, -1]), /non-negative/);
  assert.throws(() => summarizeDistribution([1, 2], [0, 0]), /positive/);
});

test('availability mixture adds the chance of a 0-point no-show without changing "if active" values', () => {
  const sample = Array(200).fill(10);
  const half = availabilityAdjustedDistribution(sample, undefined, 0.5, 6);
  assert.equal(half.mean, 5);
  assert.equal(half.median, 0);
  assert.equal(half.p75, 10);
  assert.equal(half.bustProbability, 0.5);
  const sure = availabilityAdjustedDistribution(sample, undefined, 1, 6);
  assert.deepEqual(sure, summarizeDistribution(sample, undefined, 6));
  const never = availabilityAdjustedDistribution(sample, undefined, 0, 6);
  assert.equal(never.mean, 0);
  assert.equal(never.bustProbability, 1);
  assert.throws(() => availabilityAdjustedDistribution(sample, undefined, 1.2), /between 0 and 1/);
});

test('historical play rates come straight from the nflverse-derived table and are undefined without enough sample', () => {
  const wr = historicalPlayProbability('questionable', 'WR')!;
  const row = AVAILABILITY_COUNTS.questionable.WR;
  assert.equal(wr.probability, row.played / row.n);
  assert.ok(wr.n >= 500 && wr.probability > 0.6 && wr.probability < 0.8);
  assert.ok(historicalPlayProbability('questionable', 'QB')!.probability < historicalPlayProbability('questionable', 'WR')!.probability);
  assert.ok(historicalPlayProbability('out', 'RB')!.probability < 0.01);
  assert.match(wr.source, /nflverse/);
  for (const [designation, position] of [['unknown', 'WR'], ['questionable', 'K'], ['available', 'WR'], ['questionable', 'DST']] as const) {
    assert.equal(historicalPlayProbability(designation, position), undefined);
  }
});

test('weighted correlation handles perfect, inverse, constant and too-short series', () => {
  assert.ok(Math.abs(weightedCorrelation([1, 2, 3, 4], [2, 4, 6, 8])! - 1) < 1e-12);
  assert.ok(Math.abs(weightedCorrelation([1, 2, 3, 4], [8, 6, 4, 2])! + 1) < 1e-12);
  assert.equal(weightedCorrelation([1, 1, 1, 1], [1, 2, 3, 4]), undefined);
  assert.equal(weightedCorrelation([1, 2], [1, 2]), undefined);
  // down-weighting the outlier changes the answer
  const x = [1, 2, 3, 4, 50], y = [1, 2, 3, 4, -50];
  assert.ok(weightedCorrelation(x, y)! < weightedCorrelation(x, y, [1, 1, 1, 1, 0.001])!);
});

test('pair correlations cover QB stacks, backs vs receivers and opposing players, and skip meaningless pairs', () => {
  const up = [1, 2, 3, 4, 5, 6];
  const players = [
    { team: 'A', position: 'QB' }, { team: 'A', position: 'WR' }, { team: 'A', position: 'RB' },
    { team: 'B', position: 'QB' }, { team: 'B', position: 'WR' }, { team: 'A', position: 'QB' }, { team: 'A', position: 'K' },
  ];
  const series = [up, up.map(v => v * 2), up.map(v => 7 - v), up, up.map(v => v + 1), up, up];
  const out = pairCorrelations(players, series);
  const find = (a: number, b: number) => out.find(c => c.a === a && c.b === b);
  assert.equal(find(0, 1)!.kind, 'qb-pass-catcher');
  assert.equal(find(0, 2)!.kind, 'qb-rb');
  assert.equal(find(1, 2)!.kind, 'rb-pass-catcher');
  assert.ok(find(1, 2)!.r < 0, 'a back that scores more when the receiver scores less is negatively correlated');
  assert.equal(find(0, 3)!.kind, 'opposing');
  assert.equal(find(1, 4)!.kind, 'opposing');
  assert.equal(find(0, 5), undefined, 'two quarterbacks on one team are alternatives, not a stack');
  assert.equal(out.some(c => c.a === 6 || c.b === 6), false, 'kickers are not part of the skill-position correlations');
  assert.throws(() => pairCorrelations(players, series.slice(1)), /One outcome series/);
});

// ---- through the real simulation engine ----
const team = (name: string, qb: string, key: string) => ({
  name, qb, rb: `RB ${key}`, wr1: `WR1 ${key}`, wr2: `WR2 ${key}`, wr3: `WR3 ${key}`, te: `TE ${key}`, kicker: 'K',
  passRating: 60, rushRating: 60, defenseRating: 60, context: '',
  roster: [{ id: `${key}qb`, name: qb, position: 'QB' }, { id: `${key}rb`, name: `RB ${key}`, position: 'RB' },
    { id: `${key}w1`, name: `WR1 ${key}`, position: 'WR' }, { id: `${key}w2`, name: `WR2 ${key}`, position: 'WR' },
    { id: `${key}w3`, name: `WR3 ${key}`, position: 'WR' }, { id: `${key}te`, name: `TE ${key}`, position: 'TE' }],
});
const input = (patch: Partial<SimulationInput> = {}) => ({
  away: team('Buffalo Bills', 'QB A', 'a'), home: team('Detroit Lions', 'QB H', 'h'),
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 7, ...patch,
}) as unknown as SimulationInput;
const check = (id: string, status: string, included = true) => ({ id, name: id, position: 'WR', included, status, basis: 'saved roster', checkedAt: '2035-10-03T12:00:00Z' });

test('ensemble keeps the legacy mean/P10/P90 and adds an ordered, finite distribution for every player', () => {
  const result = simulateEnsemble(input(), 200);
  const e = result.ensemble!;
  assert.equal(e.distribution!.length, result.players.length);
  assert.equal(e.distribution!.length, e.fantasy.length);
  e.distribution!.forEach((d, i) => {
    assert.equal(d.basis, 'simulated');
    assert.ok(Math.abs(d.mean - e.fantasy[i]!.mean) < 0.011, 'same mean as the legacy field');
    assert.ok(d.p10 <= d.median && d.median <= d.p75 && d.p75 <= d.p90 && d.p90 <= d.p95);
    assert.equal(d.bustThreshold, BUST_FLOOR_POINTS[result.players[i]!.position as keyof typeof BUST_FLOOR_POINTS]);
    assert.ok(d.bustProbability! >= 0 && d.bustProbability! <= 1);
    assert.equal(d.samples, 200);
    assert.equal(d.availability, undefined, 'no designation means no availability adjustment is invented');
  });
});

test('quarterback and own-receiver outcomes are positively correlated in the simulated games', () => {
  const { correlations } = simulateEnsemble(input(), 200).ensemble!;
  const stack = correlations!.filter(c => c.kind === 'qb-pass-catcher');
  assert.ok(stack.length >= 6);
  assert.ok(stack.reduce((s, c) => s + c.r, 0) / stack.length > 0.15);
  assert.ok(correlations!.every(c => c.r >= -1 && c.r <= 1));
});

test('a verified Questionable designation adds an availability-adjusted distribution using historical rates only', () => {
  const base = simulateEnsemble(input(), 200);
  const away = { ...input().away, availabilityChecks: [check('aw1', 'questionable'), check('aw2', 'unknown'), check('aw3', 'out', false)] } as unknown as SimulationInput['away'];
  const result = simulateEnsemble(input({ away }), 200);
  const wr1 = result.players.findIndex(p => p.id === 'aw1');
  const d = result.ensemble!.distribution!;
  const adjusted = d[wr1]!.availability!;
  const rate = AVAILABILITY_COUNTS.questionable.WR;
  assert.ok(Math.abs(adjusted.playProbability - rate.played / rate.n) < 0.001);
  assert.deepEqual(adjusted.sample, { n: rate.n, played: rate.played });
  assert.match(adjusted.rateSource, /nflverse/);
  assert.equal(adjusted.statusBasis, 'saved roster');
  assert.ok(Math.abs(adjusted.adjusted.mean - d[wr1]!.mean * adjusted.playProbability) < 0.02);
  assert.ok(adjusted.adjusted.bustProbability! > d[wr1]!.bustProbability!);
  // the "if active" numbers and every other player are unchanged by an availability label
  assert.equal(d[wr1]!.mean, base.ensemble!.distribution![wr1]!.mean);
  assert.equal(d[result.players.findIndex(p => p.id === 'aw2')]!.availability, undefined, 'Unknown is never turned into a probability');
  assert.equal(d[result.players.findIndex(p => p.id === 'aw3')]!.availability, undefined, 'excluded players are not simulated or adjusted');
});

test('weighted (high-scoring) ensembles also report ordered distributions and are deterministic for a seed', () => {
  const a = simulateEnsemble(input({ highScoring: true }), 50).ensemble!;
  const b = simulateEnsemble(input({ highScoring: true }), 50).ensemble!;
  assert.deepEqual(a.distribution, b.distribution);
  assert.deepEqual(a.correlations, b.correlations);
  a.distribution!.forEach(d => assert.ok(d.p10 <= d.median && d.median <= d.p95 && Number.isFinite(d.meanStdError)));
});

test('saved forecasts carry the calculated distribution fields, round-trip through the archive, and older forecasts stay unchanged', () => {
  const away = { ...input().away, availabilityChecks: [check('aw1', 'questionable')] } as unknown as SimulationInput['away'];
  const withDetail = input({ away });
  const game = { id: 'g', week: 4, date: '2035-10-04T17:00:00Z', awayTeam: 'Buffalo Bills', homeTeam: 'Detroit Lions' } as Parameters<typeof gameForecast>[0];
  const forecast = gameForecast(game, withDetail, simulateEnsemble(withDetail, 100));
  const wr1 = forecast.players.find(p => p.playerId === 'aw1')!;
  assert.ok(wr1.median !== undefined && wr1.p75 !== undefined && wr1.p95 !== undefined && wr1.bustProbability !== undefined);
  assert.equal(wr1.availability!.status, 'questionable');
  assert.equal(forecast.players.find(p => p.playerId === 'aw2')!.availability, undefined);
  const slate: DKSlate = { id: 's', season: 2035, sunday: '2035-10-04', createdAt: '2035-10-03T12:00:00Z', timezone: 'America/Chicago', forecasts: [forecast], failures: [] };
  const storage = { raw: '', getItem() { return this.raw; }, setItem(_k: string, v: string) { this.raw = v; } };
  writeDKArchive(storage, { version: 1, official: [], slates: [slate] });
  assert.deepEqual(readDKArchive(storage).slates[0]!.forecasts[0]!.players, forecast.players);
  // a forecast saved before these fields existed still loads and gains nothing
  const legacy = structuredClone(slate);
  for (const player of legacy.forecasts[0]!.players) {
    delete player.median; delete player.p75; delete player.p95; delete player.bustProbability; delete player.bustThreshold; delete player.availability;
  }
  writeDKArchive(storage, { version: 1, official: [], slates: [legacy] });
  const reloaded = readDKArchive(storage).slates[0]!.forecasts[0]!.players;
  assert.ok(reloaded.every(p => p.median === undefined && p.availability === undefined));
  assert.deepEqual(reloaded.map(p => [p.playerId, p.mean, p.p10, p.p90]), legacy.forecasts[0]!.players.map(p => [p.playerId, p.mean, p.p10, p.p90]));
});
