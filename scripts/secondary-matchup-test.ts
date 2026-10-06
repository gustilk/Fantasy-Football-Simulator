import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { advancedReport, parseAdvancedSeason } from '../artifacts/api-server/src/lib/nfl-advanced-data.ts';
import { secondaryMatchup, secondaryNotes, type SecondaryEvidence } from '../artifacts/gridiron-sim/src/lib/secondary-matchup.ts';
import { simulatePossessionDrive, type DriveProfile } from '../artifacts/gridiron-sim/src/lib/possession-drive.ts';
import { simulateGame, type SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator.ts';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble.ts';
import { footballSetup, type FootballEvidence } from '../artifacts/gridiron-sim/src/lib/football-evidence.ts';

const columns = ['season', 'season_type', 'week', 'game_id', 'play_id', 'game_date', 'home_team', 'away_team', 'posteam', 'defteam',
  'play_type', 'qb_dropback', 'rush_attempt', 'pass_attempt', 'epa', 'air_yards', 'qb_hit', 'sack', 'receiver_player_id', 'rusher_player_id',
  'desc', 'complete_pass', 'yards_gained', 'yards_after_catch', 'qb_spike', 'qb_kneel', 'play_deleted', 'two_point_attempt', 'qb_scramble'];
const rows: Record<string, string>[] = [];
for (let week = 1; week <= 6; week++) {
  const base = { season: '2026', season_type: 'REG', week: String(week), game_id: `2026_${String(week).padStart(2, '0')}_GB_DET`,
    game_date: week === 6 ? '2026-10-07' : `2026-09-${String(week * 5).padStart(2, '0')}`, home_team: 'DET', away_team: 'GB',
    posteam: 'GB', defteam: 'DET', play_type: 'pass', qb_dropback: '1', rush_attempt: '0', pass_attempt: '1', qb_hit: '0', sack: '0',
    receiver_player_id: 'NA', rusher_player_id: 'NA', desc: 'PLAY' };
  const plays = [
    { air_yards: '9', complete_pass: '1', yards_gained: '19', yards_after_catch: '10', epa: '0.2' },
    { air_yards: '10', complete_pass: '0', yards_gained: '0', epa: '-0.4' },
    { air_yards: '19', complete_pass: '1', yards_gained: '22', yards_after_catch: '3', epa: '0.5' },
    { air_yards: '20', complete_pass: '1', yards_gained: '25', yards_after_catch: '5', epa: '1.1' },
    { air_yards: '35', complete_pass: '0', yards_gained: '0', epa: '-0.6' },
    { air_yards: 'NA', complete_pass: '1', yards_gained: '16', yards_after_catch: '16', epa: '0.1' },
    { air_yards: '50', complete_pass: '0', yards_gained: '-8', epa: '-0.8', sack: '1' },
    { air_yards: '25', complete_pass: '0', yards_gained: '22', epa: '0.3', play_type: 'run', rush_attempt: '1', qb_scramble: '1' },
    { air_yards: '25', complete_pass: '0', yards_gained: '0', epa: '0', qb_spike: '1' },
    { air_yards: '35', complete_pass: '1', yards_gained: '40', epa: '1', play_deleted: '1' },
    { air_yards: '35', complete_pass: '1', yards_gained: '40', epa: '1', two_point_attempt: '1' },
    { desc: 'END GAME', play_type: 'no_play', qb_dropback: '0', pass_attempt: '0' },
  ];
  for (const [i, play] of plays.entries()) rows.push({ ...base, play_id: String(i + 1), ...play } as Record<string, string>);
}
const csv = (fields = columns, items = rows) => [fields.join(','), ...items.map(row => fields.map(k => row[k] ?? '').join(','))].join('\n');
const now = Date.parse('2026-10-06T12:00:00Z'), season = parseAdvancedSeason(2026, csv());
const defenseReport = advancedReport(season, 'Detroit Lions', 5, [], now, 4);
const offenseReport = advancedReport(season, 'Green Bay Packers', 5, [], now, 4);
const coverage = defenseReport.defense.passingDepth!;
assert.deepEqual(defenseReport.sampleWeeks, [1, 2, 3, 4]);
assert.equal(coverage.shortAttempts, 4, '9 air yards belongs to short passes even with a 19-yard gain.');
assert.equal(coverage.intermediateAttempts, 8, '10 and 19 air yards are intermediate.');
assert.equal(coverage.deepAttempts, 8, '20 air yards is deep.');
assert.equal(coverage.deepCompletionRate, 0.5);
assert.equal(coverage.deepEpa, 0.25);
assert.equal(coverage.deepEpaSamples, 8);
assert.equal(coverage.unknownDepthAttempts, 4);
assert.equal(coverage.passExplosiveSamples, 24, 'Sacks, scrambles, spikes, deleted and conversion plays are excluded.');
assert.equal(coverage.passExplosiveRate, 0.6667);
assert.equal(coverage.yacSamples, 16);
assert.equal(coverage.yacPerCompletion, 8.5);
assert.deepEqual(offenseReport.offense!.passingDepth, coverage);
assert.deepEqual(advancedReport(season, 'Detroit Lions', 7, [], now, 4).sampleWeeks, [2, 3, 4, 5], 'Only the last four completed games, never the future game.');
const missing = parseAdvancedSeason(2026, csv(columns.filter(k => !['complete_pass', 'yards_after_catch', 'yards_gained'].includes(k)), rows.map(row => ({ ...row, air_yards: 'NA' }))));
const unknown = advancedReport(missing, 'Detroit Lions', 5, [], now, 4).defense.passingDepth!;
assert.equal(unknown.deepCompletionRate, null); assert.equal(unknown.yacPerCompletion, null); assert.equal(unknown.passExplosiveRate, null);
const setup = footballSetup({ season: 2026, team: 'Detroit Lions', version: 1, players: [], weeks: [] }, 5, 'home', 'Green Bay Packers', { current: defenseReport, issues: [] });
assert.deepEqual(setup.footballEvidence!.secondaryDefense!.weeks, [1, 2, 3, 4]);
assert.deepEqual(setup.footballEvidence!.secondaryDefense!.current, coverage);
const ineligible = footballSetup({ season: 2026, team: 'Detroit Lions', version: 1, players: [], weeks: [] }, 4, 'home', 'Green Bay Packers', { current: defenseReport, issues: [] });
assert.equal(ineligible.footballEvidence!.secondaryDefense!.current, undefined);

const evidence = (stats: SecondaryEvidence['current']): SecondaryEvidence => ({ current: stats, season: 2026, weeks: [1, 2, 3, 4] });
const strong = secondaryMatchup(undefined, evidence({ deepCompletionRate: 0.15, deepAttempts: 80, deepEpa: -1, deepEpaSamples: 80, passExplosiveRate: 0.03, passExplosiveSamples: 120, yacPerCompletion: 2, yacSamples: 80 }));
const weak = secondaryMatchup(undefined, evidence({ deepCompletionRate: 0.85, deepAttempts: 80, deepEpa: 1, deepEpaSamples: 80, passExplosiveRate: 0.3, passExplosiveSamples: 120, yacPerCompletion: 8, yacSamples: 80 }));
function rng(seed: number) { let n = seed; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
function contexts(matchup: ReturnType<typeof secondaryMatchup>) {
  const random = rng(123), result = Array.from({ length: 5000 }, () => matchup.sample(random, 75, 0.645, 16)!);
  const deep = result.filter(c => c.band === 'deep');
  return { deepCount: deep.length, completion: deep[0]!.completionRate, yac: result[0]!.yacMean };
}
const good = contexts(strong), bad = contexts(weak);
assert.ok(bad.deepCount > good.deepCount + 200, 'Passing explosive/EPA evidence changes downfield opportunity, not points directly.');
assert.ok(bad.completion > good.completion + 0.2, 'Weak coverage raises completion probability on deep throws.');
assert.ok(bad.yac > good.yac + 2, 'YAC is separately measured.');
const tiny = secondaryMatchup(undefined, evidence({ deepCompletionRate: 0.85, deepAttempts: 1 }));
const big = secondaryMatchup(undefined, evidence({ deepCompletionRate: 0.85, deepAttempts: 80 }));
const deepCompletion = (m: ReturnType<typeof secondaryMatchup>) => {
  const random = rng(99);
  for (let i = 0; i < 100; i++) { const c = m.sample(random, 75, 0.645, 16)!; if (c.band === 'deep') return c.completionRate; }
  throw new Error('Deep context not sampled.');
};
assert.ok(deepCompletion(tiny) < deepCompletion(big), 'One attempt cannot act like four games of targets.');
assert.equal(secondaryMatchup().active, false);
assert.equal(secondaryMatchup().sample(() => { throw new Error('Missing evidence must not consume random calls.'); }, 75, 0.645), undefined);
assert.ok(secondaryNotes('Any team', undefined, secondaryMatchup()).includes('neutral'));
assert.throws(() => secondaryMatchup(undefined, evidence({ deepCompletionRate: 50, deepAttempts: 1 })), /between 0 and 1/);
const capped = secondaryMatchup(undefined, { season: 2026, weeks: [1, 2, 3, 4], current: { deepCompletionRate: 0.5, deepAttempts: 40 },
  prior: { deepCompletionRate: 1, deepAttempts: 1000 }, priorSeason: 2025 });
assert.equal(capped.data[2]!.defense.n, 70, 'Prior targets capped separately, not 1000 synthetic current targets.');
for (let distance = 1; distance < 20; distance++) assert.notEqual(weak.sample(rng(distance), distance, 0.645, 16)!.band, 'deep');

const profile: DriveProfile = { successRate: 0.43, explosivePlayRate: 0.08, redZoneTdRate: 0.55, passShare: 1, interceptionRate: 0, fumbleRate: 0, sackRate: 0, fieldGoalPenalty: 0, secondsPerPlay: 28 };
const options = (seed: number) => {
  const random = rng(seed);
  return { random, profile, startYardsToGoal: 75, secondsAvailable: 300, opportunity: (_kind: string, distance: number) => ({
    completionRate: 0.645, fumbleRate: 0, efficiency: 1, passing: weak.sample(random, distance, 0.645, 16),
  }) };
};
for (let seed = 1; seed <= 100; seed++) {
  const drive = simulatePossessionDrive(options(seed));
  for (const play of drive.plays) {
    if (play.completed) assert.equal(play.airYards! + play.yardsAfterCatch!, play.gain);
    assert.equal(play.explosive, play.gain >= 15);
  }
}
const runProfile = { ...profile, passShare: 0 };
const runOld = simulatePossessionDrive({ random: rng(17), profile: runProfile, secondsAvailable: 300 });
const runNew = simulatePossessionDrive({ random: rng(17), profile: runProfile, secondsAvailable: 300,
  opportunity: () => ({ completionRate: 0.645, fumbleRate: 0, efficiency: 1 }) });
assert.deepEqual(runNew, runOld, 'No secondary-specific rushing bonus.');
const team = { qb: 'QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 60, rushRating: 55, defenseRating: 58, context: '' };
const input: SimulationInput = { away: { ...team, name: 'Away' }, home: { ...team, name: 'Home' },
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 123, showdownModel: 'showdown-v1', driveModel: 'possession-v1' };
const original = simulateGame(input);
assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'), '61435d1bc02c7c3f0dd97da5fc94b334aa85d5349d8b41b9b02bcbcde20c3899', 'Frozen possession-v1 results are byte-for-byte unchanged.');
const noEvidence = simulateGame({ ...input, secondaryModel: 'secondary-v1' });
const raw = ({ overview: _overview, ...r }: ReturnType<typeof simulateGame>) => r;
assert.deepEqual(raw(original), raw(noEvidence), 'All-missing secondary evidence is neutral.');
const football: FootballEvidence = { version: 'football-v2', passDefenseRating: 58, rushDefenseRating: 58, passSamples: 0, rushSamples: 0,
  positionMatchups: {}, sources: [], warnings: [], matchedPlayers: 0, secondaryDefense: evidence(coverage) };
const updated: SimulationInput = { ...input, secondaryModel: 'secondary-v1', home: { ...input.home, footballEvidence: football } };
const ensemble = simulateEnsemble(updated, 200);
assert.deepEqual(ensemble, simulateEnsemble(JSON.parse(JSON.stringify(updated)), 200));
assert.equal(ensemble.ensemble!.runs, 200);
assert.ok(ensemble.overview.some(n => n.includes('20+ air yards: recent 50.0%')));
assert.ok(ensemble.drives.some(d => d.plays.some(p => p.includes('air yards'))));
for (let seed = 1; seed <= 50; seed++) {
  const result = simulateGame({ ...updated, seed });
  for (const [i, name] of ['Away', 'Home'].entries()) {
    const players = result.players.filter(p => p.team === name), drives = result.drives.filter(d => d.team === name);
    const touchdowns = drives.filter(d => d.result === 'Touchdown').length, fg = drives.filter(d => d.result === 'Field goal').length;
    const defense = result.defenses![i]!, kicker = result.kickers![i]!;
    assert.equal(players.reduce((n, p) => n + p.receivingTD + p.rushTD, 0), touchdowns);
    assert.equal(players.reduce((n, p) => n + p.passTD, 0), players.reduce((n, p) => n + p.receivingTD, 0));
    assert.equal(kicker.extraPoints, touchdowns + (defense.defensiveTD ?? 0));
    assert.equal(i === 0 ? result.awayScore : result.homeScore, 7 * kicker.extraPoints + 3 * fg);
  }
}
console.log('Secondary method: last-four cutoff, air-depth boundaries, missing fields, separate pass/YAC evidence, bounded sample effects, 200-run replay, frozen possession compatibility and scoring integrity passed.');
