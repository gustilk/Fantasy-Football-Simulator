import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { simulatePossessionDrive, matchupDriveRates, DRIVE_PRIORS, type DriveProfile } from '../artifacts/gridiron-sim/src/lib/possession-drive.ts';
import { simulateGame, type SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator.ts';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble.ts';

const profile: DriveProfile = { ...DRIVE_PRIORS, passShare: 0.575, interceptionRate: 0.022, fumbleRate: 0.012, sackRate: 0.047, fieldGoalPenalty: 0, secondsPerPlay: 28 };
const simple = { ...profile, successRate: 0, explosivePlayRate: 0, redZoneTdRate: 0, passShare: 0, interceptionRate: 0, fumbleRate: 0, sackRate: 0 };
const drive = (p: DriveProfile, start = 75, value = 0.5) => simulatePossessionDrive({ profile: p, random: () => value, startYardsToGoal: start, secondsAvailable: 600 });
assert.equal(drive(simple).outcome, 'Punt');
assert.equal(drive(simple, 20).outcome, 'FG');
assert.equal(drive({ ...simple, redZoneTdRate: 1 }, 20).outcome, 'TD');
assert.equal(drive({ ...simple, passShare: 1, interceptionRate: 1 }).turnover, 'interception');
assert.equal(drive({ ...simple, fumbleRate: 1 }).turnover, 'fumble');
assert.equal(drive(simple, 20, 0.999).turnover, 'missed-fg');
assert.equal(simulatePossessionDrive({ profile: simple, random: () => 0.5, secondsAvailable: 0.1 }).outcome, 'End');
assert.deepEqual(matchupDriveRates(), DRIVE_PRIORS);
assert.deepEqual(matchupDriveRates({ successRate: 0, successSamples: 0 }), DRIVE_PRIORS);
assert.throws(() => matchupDriveRates({ explosivePlayRate: 15, explosiveSamples: 30 }), /Invalid possession metric/);
assert.throws(() => drive({ ...profile, successRate: NaN }), /Invalid drive probability/);
assert.throws(() => simulatePossessionDrive({ profile, random: () => 0.5, secondsAvailable: -1 }), /clock/);
function rng(seed: number) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
function sample(p: DriveProfile, start = 75) {
  let touchdowns = 0, punts = 0, explosives = 0, plays = 0, yards = 0;
  for (let seed = 1; seed <= 1500; seed++) {
    const d = simulatePossessionDrive({ profile: p, random: rng(seed), startYardsToGoal: start, secondsAvailable: 600 });
    touchdowns += Number(d.outcome === 'TD'); punts += Number(d.outcome === 'Punt');
    explosives += d.plays.filter(play => play.explosive).length; plays += d.plays.length;
    yards += d.plays.reduce((n, play) => n + play.gain, 0);
    assert.equal(d.endYardsToGoal, d.startYardsToGoal - d.plays.reduce((n, play) => n + play.gain, 0));
    assert.ok(d.elapsedSeconds > 0 && d.elapsedSeconds <= 600);
    for (const play of d.plays) assert.equal(play.explosive, play.gain >= 15);
  }
  return { touchdowns, punts, explosiveRate: explosives / plays, meanYards: yards / 1500 };
}
const weak = sample({ ...profile, successRate: 0.2 }), strong = sample({ ...profile, successRate: 0.65 });
assert.ok(strong.punts < weak.punts, 'Success rate reduces stalled drives.');
assert.ok(strong.touchdowns > weak.touchdowns, 'Success rate creates more scoring opportunities.');
const poorFinish = sample({ ...profile, redZoneTdRate: 0.2 }, 20), strongFinish = sample({ ...profile, redZoneTdRate: 0.8 }, 20);
assert.ok(strongFinish.touchdowns > poorFinish.touchdowns + 300, 'Separate red-zone conversion input affects finishing.');
const lowTail = sample({ ...profile, explosivePlayRate: 0.01 }), highTail = sample({ ...profile, explosivePlayRate: 0.2 });
assert.ok(highTail.explosiveRate > lowTail.explosiveRate + 0.07, 'Explosiveness separately controls 15+ yard plays.');
assert.ok(highTail.meanYards > lowTail.meanYards);

const team = { qb: 'QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 60, rushRating: 55, defenseRating: 58, context: '' };
const input: SimulationInput = { away: { ...team, name: 'Away' }, home: { ...team, name: 'Home' }, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 123, showdownModel: 'showdown-v1' };
const hashes = new Map([[123, 'cd75358ef56aca7e7d4d66abca64a03272665485dbebab7ceef83ca79b41d2f5'], [456, 'ed3ac8d6bed8a03db312a4682f5093b8ba0fc86d7c961284d12986efff8ceeaa']]);
for (const [seed, expected] of hashes) assert.equal(createHash('sha256').update(JSON.stringify(simulateGame({ ...input, seed }))).digest('hex'), expected, 'Unversioned frozen forecasts retain their exact original outcomes.');
const updated: SimulationInput = { ...input, driveModel: 'possession-v1' };
const ensemble = simulateEnsemble(updated, 200);
assert.deepEqual(ensemble, simulateEnsemble(JSON.parse(JSON.stringify(updated)), 200), 'Frozen possession inputs replay deterministically.');
assert.equal(ensemble.ensemble?.runs, 200);
assert.ok(ensemble.overview.some(note => note.includes('model prior; no observed sample')));
assert.ok(ensemble.ensemble?.scoring && ensemble.ensemble.scoring.totalMean > 0);
for (let seed = 1; seed <= 100; seed++) {
  const result = simulateGame({ ...updated, seed });
  for (let i = 1; i < result.drives.length; i++) assert.notEqual(result.drives[i]!.team, result.drives[i - 1]!.team, 'Actual possessions alternate.');
  for (const [i, name] of ['Away', 'Home'].entries()) {
    const players = result.players.filter(player => player.team === name), opponent = result.players.filter(player => player.team !== name);
    const drives = result.drives.filter(d => d.team === name);
    const defense = result.defenses![i]!, kicker = result.kickers![i]!;
    const touchdowns = drives.filter(d => d.result === 'Touchdown').length;
    const fieldGoals = drives.filter(d => d.result === 'Field goal').length;
    assert.equal(result.totalPlays[i === 0 ? 'away' : 'home'], drives.reduce((n, d) => n + d.snapCount, 0));
    assert.equal(players.reduce((n, p) => n + p.rushTD + p.receivingTD, 0), touchdowns);
    assert.equal(players.reduce((n, p) => n + p.passTD, 0), players.reduce((n, p) => n + p.receivingTD, 0));
    assert.equal(kicker.fieldGoals039 + kicker.fieldGoals4049 + kicker.fieldGoals50Plus, fieldGoals);
    assert.equal(kicker.extraPoints, touchdowns + (defense.defensiveTD ?? 0));
    assert.equal(i === 0 ? result.awayScore : result.homeScore, 7 * (touchdowns + (defense.defensiveTD ?? 0)) + 3 * fieldGoals);
    assert.equal(defense.interceptions, opponent.reduce((n, p) => n + p.interceptions, 0));
    assert.equal(defense.fumblesRecovered, opponent.reduce((n, p) => n + p.fumblesLost, 0));
  }
}
console.log('Possession outcomes, independent rates, 200-run replay, legacy golden hashes, and player/kicker/DST accounting passed.');
