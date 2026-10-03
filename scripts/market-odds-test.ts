import assert from 'node:assert/strict';
import { impliedMarketScores, validateMarketOdds, marketOutcomeWeights, weightedFantasySummary, type MarketOdds } from '../artifacts/gridiron-sim/src/lib/market-odds';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import type { SimulationInput, TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { parseScheduleOdds } from '../artifacts/api-server/src/lib/nfl-schedule';
import { calculateDraftKings } from '../artifacts/gridiron-sim/src/lib/draftkings';

const now = Date.parse('2026-10-03T18:00:00Z');
const line: MarketOdds = {
  enabled: true, homeSpread: -6, total: 48, awayTeam: 'Away', homeTeam: 'Home',
  source: 'manual', provider: 'Test sportsbook', recordedAt: '2026-10-03T17:00:00Z',
};
assert.deepEqual(impliedMarketScores(-6, 48), { home: 27, away: 21 });
assert.deepEqual(impliedMarketScores(6, 48), { home: 21, away: 27 });
assert.deepEqual(impliedMarketScores(0, 48), { home: 24, away: 24 });
for (const [spread, total] of [[NaN, 48], [41, 48], [-6, Infinity], [-20, 15], [0, 0], [0, 101]]) {
  assert.throws(() => impliedMarketScores(spread, total));
}
assert.equal(validateMarketOdds({ ...line, enabled: false, total: undefined }, 'Wrong', 'Wrong', now), undefined);
assert.throws(() => validateMarketOdds(line, 'Other', 'Home', now), /different matchup/);
assert.throws(() => validateMarketOdds({ ...line, total: undefined }, 'Away', 'Home', now), /both/);
assert.throws(() => validateMarketOdds({ ...line, recordedAt: undefined }, 'Away', 'Home', now), /recorded-at/);
assert.throws(() => validateMarketOdds({ ...line, recordedAt: '2026-10-04T17:00:00Z' }, 'Away', 'Home', now), /future/);
assert.throws(() => validateMarketOdds({ ...line, kickoff: '2026-10-03T16:00:00Z' }, 'Away', 'Home', now), /before kickoff/);
const scores = Array.from({ length: 40 }, (_, index) => ({ away: 10 + index, home: 10 + index }));
const valid = validateMarketOdds(line, 'Away', 'Home', now)!;
const result = marketOutcomeWeights(scores, valid, now);
assert.ok(Math.abs(result.weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-10);
assert.ok(result.weights.every(weight => weight >= 0.65 / scores.length));
assert.equal(result.evidence.baseline.away, 29.5);
assert.ok(result.evidence.effectiveRuns <= 40 && result.evidence.effectiveRuns >= 1);
assert.throws(() => marketOutcomeWeights(scores.slice(0, 1), valid, now), /at least 20/);
assert.ok(marketOutcomeWeights(scores, valid, now + 2 * 86_400_000).evidence.warnings.some(warning => warning.includes('24 hours')));
const high = marketOutcomeWeights(scores, validateMarketOdds({ ...line, total: 80 }, 'Away', 'Home', now)!, now);
const low = marketOutcomeWeights(scores, validateMarketOdds({ ...line, total: 20 }, 'Away', 'Home', now)!, now);
assert.ok(high.evidence.weighted.home > low.evidence.weighted.home, 'Higher totals favor higher-scoring outcomes');
const favoredHome = marketOutcomeWeights(Array.from({ length: 40 }, (_, index) => ({ home: 10 + index, away: 50 - index })), valid, now);
assert.ok(favoredHome.evidence.weighted.home > favoredHome.evidence.weighted.away, 'Negative home spread favors home outcomes');
const summary = weightedFantasySummary([5, 10, 30], [0.1, 0.2, 0.7]);
assert.equal(summary.mean, 23.5);
assert.equal(summary.p10, 5);
assert.equal(summary.p90, 30);

const team = (name: string): TeamSetup => ({
  name, qb: `${name} QB`, rb: `${name} RB`, wr1: `${name} WR1`, wr2: `${name} WR2`, wr3: `${name} WR3`,
  te: `${name} TE`, kicker: `${name} K`, passRating: 55, rushRating: 55, defenseRating: 55, context: '',
});
const input: SimulationInput = {
  away: team('Away'), home: team('Home'), weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 123456,
};
const originalInput = JSON.stringify(input);
const baseline = simulateEnsemble(input, 200);
assert.deepEqual(simulateEnsemble({ ...input, market: { ...line, enabled: false } }, 200), baseline, 'Disabled odds must preserve the original model exactly');
const weighted = simulateEnsemble({ ...input, market: line }, 200);
assert.deepEqual(weighted.players, baseline.players, 'Market weighting must not fabricate example-game fantasy points or stats');
assert.deepEqual(weighted.drives, baseline.drives);
assert.equal(weighted.homeScore, baseline.homeScore);
assert.equal(weighted.awayScore, baseline.awayScore);
assert.equal(weighted.ensemble?.market?.implied.home, 27);
assert.notDeepEqual(weighted.ensemble?.fantasy, baseline.ensemble?.fantasy, 'Enabled odds must affect actual projections');
assert.ok(Math.abs(weighted.ensemble!.homeWinPct + weighted.ensemble!.awayWinPct + weighted.ensemble!.tiePct - 100) <= 0.02);
assert.deepEqual(simulateEnsemble({ ...input, market: line }, 200), weighted, 'Paired-seed market results must be deterministic');
assert.deepEqual(JSON.parse(JSON.stringify(weighted)).ensemble?.market, weighted.ensemble?.market, 'Saved runs retain market evidence');
assert.equal(JSON.stringify(input), originalInput, 'Inputs are not mutated');
for (const player of weighted.players) assert.equal(player.draftKings, calculateDraftKings(player));
assert.throws(() => simulateEnsemble({ ...input, market: line }, 1), /at least 20/);

assert.deepEqual(parseScheduleOdds([{ overUnder: 48, pointSpread: { home: { close: { line: '-6' } } }, provider: { name: 'Public book' } }]),
  { homeSpread: -6, total: 48, provider: 'Public book' });
assert.equal(parseScheduleOdds([{ overUnder: 48, spread: 6, homeTeamOdds: { favorite: false }, awayTeamOdds: { favorite: true } }])?.homeSpread, 6);
assert.equal(parseScheduleOdds([{ overUnder: 48, spread: 6, homeTeamOdds: { favorite: true }, awayTeamOdds: { favorite: false } }])?.homeSpread, -6);
assert.equal(parseScheduleOdds([{ overUnder: 48, spread: 6 }]), undefined, 'An ambiguous favorite must not silently flip the spread');
assert.equal(parseScheduleOdds([{ overUnder: 48, spread: 0 }])?.homeSpread, 0);
assert.equal(parseScheduleOdds(undefined), undefined);
assert.equal(parseScheduleOdds([{ overUnder: 0, spread: 6 }]), undefined);
console.log('Market odds validation, spread direction, weighting, unchanged baseline, scoring integrity, timestamps, snapshots and source parser tests passed.');