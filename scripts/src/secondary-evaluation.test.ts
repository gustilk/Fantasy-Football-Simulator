import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { evaluateSecondary, secondaryForecast, secondaryFingerprint } from './secondary-evaluation';
import { observedPassing, observedFantasy } from './secondary-evaluation-evidence';
import { interval, covered, summarizeMetrics } from './secondary-evaluation-metrics';
import { newPassingCounters, recordPassingDepth, passingDepthReport } from '../../artifacts/api-server/src/lib/nfl-passing-depth';
import { simulateGame, type SimulationInput } from '../../artifacts/gridiron-sim/src/lib/simulator';
import { simulateEnsemble } from '../../artifacts/gridiron-sim/src/lib/ensemble';
import { scoringFields } from './market-evaluation';

const root = mkdtempSync(join(tmpdir(), 'secondary-evaluation-'));
const kickoff = '2026-10-11T17:00:00Z', freeze = '2026-10-11T16:00:00Z', id = '2026_05_GB_DET';
function plays(week: number, offense: string, defense: string) {
  return [9, 10, 19, 20, 35].map((air, i) => ({
    season: '2026', season_type: 'REG', week: String(week), game_id: `2026_${String(week).padStart(2, '0')}_GB_DET`,
    play_id: String(i + 1), posteam: offense, defteam: defense, play_type: 'pass', pass_attempt: '1',
    sack: '0', rush_attempt: '0', qb_scramble: '0', air_yards: String(air), complete_pass: String(i % 2),
    yards_gained: i % 2 ? String(air + 10) : '0', yards_after_catch: i % 2 ? '10' : 'NA', epa: '0.2',
  }));
}
function history(team: string, offense: string, defense: string) {
  return { team, season: 2026, matchupWeek: 5, complete: true, completedGames: [1, 2, 3, 4].map(week => ({
    id: `2026_${String(week).padStart(2, '0')}_GB_DET`, week, completedAt: `2026-09-${String(week * 6).padStart(2, '0')}T23:00:00Z`,
    offensePlays: plays(week, offense, defense), defensePlays: plays(week, defense, offense),
  })) };
}
const histories = [history('Green Bay Packers', 'GB', 'DET'), history('Detroit Lions', 'DET', 'GB')];
function team(name: string, side: string, h: typeof histories[number]) {
  const counter = newPassingCounters();
  h.completedGames.flatMap(g => g.offensePlays).forEach(p => recordPassingDepth(p, counter));
  const evidence = { season: 2026, weeks: [1, 2, 3, 4], current: passingDepthReport([counter]) };
  return { name, qb: `${side} QB`, rb: `${side} RB`, wr1: `${side} WR`, wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K',
    passRating: 60, rushRating: 55, defenseRating: 58, context: '',
    roster: ['QB', 'RB', 'WR'].map(position => ({ id: `${side}-${position}`, name: `${side} ${position}`, position })),
    footballEvidence: { version: 'football-v2', passDefenseRating: 58, rushDefenseRating: 58, passSamples: 0, rushSamples: 0,
      positionMatchups: {}, sources: [], warnings: [], matchedPlayers: 0, secondaryOffense: evidence, secondaryDefense: evidence } };
}
const input = { away: team('Green Bay Packers', 'A', histories[0]!), home: team('Detroit Lions', 'H', histories[1]!),
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, driveModel: 'possession-v1', secondaryModel: 'secondary-v1',
  showdownModel: 'showdown-v1' } as SimulationInput;
const roster = [input.away, input.home].flatMap(t => t.roster!.map(p => ({ team: t.name, playerId: p.id, name: p.name, position: p.position })));
const inputPayload = { historyThrough: '2026-09-24T23:00:00Z', input, secondaryHistory: histories };
const outcomes = { final: true, awayTeam: input.away.name, homeTeam: input.home.name, awayScore: 21, homeScore: 24,
  players: roster.map(p => ({ playerId: p.playerId, observed: true, stats: Object.fromEntries(scoringFields.map(k => [k, 0])) })),
  passing: { [input.away.name]: { complete: true, plays: plays(5, 'GB', 'DET') },
    [input.home.name]: { complete: true, plays: plays(5, 'DET', 'GB') } } };
let serial = 0;
function archive(kind: string, payload: unknown, capturedAt: string) {
  const path = `${++serial}.json`, bytes = JSON.stringify({ gameId: id, kind, payload, capturedAt,
    sourceUrl: 'https://source.example/fixture', archiveUrl: 'https://archive.example/fixture' });
  writeFileSync(join(root, path), bytes);
  return { path, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const base = { id, split: 'held-out', kickoff, sourceReview: 'approved',
  input: archive('input', inputPayload, freeze),
  eligibility: archive('eligibility', { complete: true, players: roster }, '2026-10-11T15:00:00Z'),
  outcome: archive('outcome', outcomes, '2026-10-11T23:00:00Z') };
const manifest = { version: 1, modelRevision: secondaryFingerprint(), registeredAt: '2026-10-06T00:00:00Z', seeds: [123], games: [base] };
try {
  const report = evaluateSecondary(manifest, root);
  assert.equal(report.heldOut.eligibleGames, 1, JSON.stringify(report.games));
  assert.equal(report.calibration.eligibleGames, 0);
  assert.equal(report.heldOut.fantasy!.observations, 6);
  assert.equal(report.heldOut.teamScoring!.observations, 2);
  assert.equal(report.heldOut.secondaryPassingDiagnostics.deepAttempts!.observations, 2);
  assert.equal(report.heldOut.pairedPassing.deepAttempts, null, 'Baseline depth is unknown, not synthetic.');
  assert.equal(report.heldOut.pairedPassing.yacMean, null);
  assert.equal(report.heldOut.pairedPassing.passing15PlusRate!.observations, 2);
  assert.deepEqual(evaluateSecondary(manifest, root), report, 'Replay is deterministic.');
  const frozen = JSON.stringify(input), pair = secondaryForecast(input, [123]);
  assert.equal(JSON.stringify(input), frozen, 'No input mutation.');
  const baselineInput = { ...input, seed: 123, secondaryModel: undefined };
  const production = simulateEnsemble(baselineInput, 200);
  assert.equal(Math.round(pair.baseline.scores.away.mean! * 100) / 100, production.ensemble!.scoring!.awayMean);
  assert.equal(Math.round(pair.baseline.scores.home.mean! * 100) / 100, production.ensemble!.scoring!.homeMean);
  const secondaryProduction = simulateEnsemble({ ...input, seed: 123 }, 200);
  assert.equal(Math.round(pair.secondary.scores.away.mean! * 100) / 100, secondaryProduction.ensemble!.scoring!.awayMean);
  assert.equal(pair.secondary.passing[input.away.name]!.simulatedGames, 200);
  assert.ok(pair.secondary.passing[input.away.name]!.rawDenominators.knownAirAttempts > 0);
  const first = simulateGame(baselineInput), captured: unknown[] = [];
  assert.deepEqual(simulateGame(baselineInput, (team, play) => { captured.push({ team, play }); assert.ok(Object.isFrozen(play)); }), first);
  assert.ok(captured.length > 0, 'Observer sees every play, not just drive highlights.');
  const exclude = (override: Record<string, unknown>) => evaluateSecondary({ ...manifest, games: [{ ...base, ...override }] }, root);
  assert.equal(exclude({ sourceReview: 'pending' }).heldOut.eligibleGames, 0);
  assert.equal(exclude({ eligibility: null }).heldOut.eligibleGames, 0);
  assert.equal(exclude({ input: archive('input', inputPayload, kickoff) }).heldOut.eligibleGames, 0);
  assert.equal(exclude({ eligibility: archive('eligibility', { complete: true, players: roster.slice(1) }, freeze) }).heldOut.eligibleGames, 0);
  const future = structuredClone(inputPayload);
  future.secondaryHistory[0]!.completedGames[3]!.completedAt = kickoff;
  assert.equal(exclude({ input: archive('input', future, freeze) }).heldOut.eligibleGames, 0);
  const wrongWeek = structuredClone(inputPayload); wrongWeek.input.away.footballEvidence!.secondaryOffense!.weeks = [1, 2, 3];
  assert.equal(exclude({ input: archive('input', wrongWeek, freeze) }).heldOut.eligibleGames, 0);
  const wrongSource = structuredClone(inputPayload); wrongSource.secondaryHistory[0]!.completedGames[0]!.offensePlays[0]!.week = '5';
  assert.equal(exclude({ input: archive('input', wrongSource, freeze) }).heldOut.eligibleGames, 0);
  const incomplete = { ...outcomes, players: outcomes.players.slice(1) };
  assert.equal(exclude({ outcome: archive('outcome', incomplete, '2026-10-11T23:00:00Z') }).heldOut.fantasy!.observations, 5);
  const partial = structuredClone(outcomes); delete (partial.players[0]!.stats as Record<string, unknown>).twoPointConversions;
  assert.equal(exclude({ outcome: archive('outcome', partial, '2026-10-11T23:00:00Z') }).heldOut.fantasy!.observations, 5);
  assert.equal(exclude({ outcome: archive('outcome', { ...outcomes, passing: undefined }, '2026-10-11T23:00:00Z') }).heldOut.teamScoring!.games, 1);
  assert.equal(exclude({ outcome: archive('outcome', { ...outcomes, passing: undefined }, '2026-10-11T23:00:00Z') }).heldOut.pairedPassing.attempts, null);
  const wrongTeam = { ...outcomes, awayTeam: input.home.name };
  assert.equal(exclude({ outcome: archive('outcome', wrongTeam, '2026-10-11T23:00:00Z') }).heldOut.eligibleGames, 0);
  assert.throws(() => evaluateSecondary({ ...manifest, modelRevision: 'changed' }, root), /fingerprint/);
  assert.throws(() => evaluateSecondary({ ...manifest, games: [base, base] }, root), /Duplicate/);
  assert.throws(() => evaluateSecondary({ ...manifest, seeds: [123, 123] }, root), /unique/);
  assert.throws(() => evaluateSecondary({ ...manifest, games: [base, { ...base, id: 'calibration', split: 'calibration' }] }, root), /precede/);
  const calibrationOnly = evaluateSecondary({ ...manifest, games: [{ ...base, split: 'calibration' }] }, root);
  assert.equal(calibrationOnly.calibration.eligibleGames, 1); assert.equal(calibrationOnly.heldOut.teamScoring, null);
  assert.equal(calibrationOnly.status, 'insufficient-evidence', 'Calibration is never claimed as held-out performance.');
  const empty = evaluateSecondary(JSON.parse(readFileSync(new URL('../../research/secondary-evaluation/manifest.json', import.meta.url), 'utf8')), root);
  assert.equal(empty.status, 'insufficient-evidence'); assert.equal(empty.heldOut.teamScoring, null);
  const actual = observedPassing(outcomes.passing[input.away.name]);
  assert.equal(actual.intermediateAttempts, 2); assert.equal(actual.deepAttempts, 2);
  assert.equal(actual.deepCompletionRate, 0.5); assert.equal(actual.yac10PlusFrequency, 1);
  const noYac = structuredClone(outcomes.passing[input.away.name]!); noYac.plays[1]!.yards_after_catch = 'NA';
  assert.equal(observedPassing(noYac).yacMean, null);
  const missingDepth = structuredClone(outcomes.passing[input.away.name]!); missingDepth.plays[3]!.air_yards = 'NA';
  assert.equal(observedPassing(missingDepth).deepAttempts, null);
  const duplicate = structuredClone(outcomes.passing[input.away.name]!); duplicate.plays.push(duplicate.plays[0]!);
  assert.throws(() => observedPassing(duplicate, { id, season: 2026, week: 5, team: input.away.name }), /Duplicate/);
  const excludedPlays = structuredClone(outcomes.passing[input.away.name]!);
  excludedPlays.plays.push({ ...excludedPlays.plays[0]!, sack: '1' },
    { ...excludedPlays.plays[0]!, play_type: 'run', qb_scramble: '1', rush_attempt: '1' });
  assert.equal(observedPassing(excludedPlays).attempts, 5, 'Sacks and scrambles are not air-depth throws.');
  assert.throws(() => observedFantasy({ observed: true, stats: { passYards: 0 } }), /number/i);
  assert.deepEqual(interval([1, 2, 3, 4, 5]), { mean: 3, p10: 1, p90: 4 });
  assert.ok(covered(interval([0, 0]), 0), 'Explicit observed zero is evaluated.');
  assert.equal(summarizeMetrics([]), null);
  const summary = summarizeMetrics([{ gameId: 'a', baseline: 4, secondary: 3, actual: 2 }, { gameId: 'b', baseline: 1, secondary: 2, actual: 2 }])!;
  assert.equal(summary.secondaryMinusBaselineMAE, -1); assert.equal(summary.games, 2);
  assert.ok(summary.descriptiveGameBootstrap95);
  console.log('Secondary evaluation: paired production parity, observer neutrality, frozen replay, cutoff/source/roster gates, separate splits, passing/YAC denominators, full DK targets, missing-data exclusions and null empirical evidence passed. All fixtures are synthetic.');
} finally { rmSync(root, { recursive: true, force: true }); }
