import assert from 'node:assert/strict';
import { calculateDraftKings, getDraftKingsDetails } from '../artifacts/gridiron-sim/src/lib/draftkings';
import { simulateGame, type SimulationInput, type TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';

assert.equal(calculateDraftKings({ passYards: 300 }), 15);
assert.equal(calculateDraftKings({ rushYards: 100 }), 13);
assert.equal(calculateDraftKings({ receivingYards: 100 }), 13);
assert.equal(calculateDraftKings({ passYards: 299, rushYards: 99, receivingYards: 99 }), 31.76);
assert.equal(calculateDraftKings({ passYards: 300, rushYards: 100, receivingYards: 100 }), 41);
assert.equal(calculateDraftKings({ passYards: 300, passTD: 2, interceptions: 1, rushYards: 25, rushTD: 1, receptions: 2, receivingYards: 100, receivingTD: 1, fumblesLost: 1 }), 50.5);
assert.equal(calculateDraftKings({ passYards: -5, rushYards: -3, receivingYards: -4, interceptions: 1, fumblesLost: 1 }), -2.9);
assert.equal(calculateDraftKings({ kickReturnTD: 1, puntReturnTD: 1, fieldGoalReturnTD: 1, offensiveFumbleRecoveryTD: 1, twoPointConversions: 2 }), 28);
assert.equal(calculateDraftKings({}), 0);
const row = { receptions: 5, receivingYards: 71 };
assert.equal(calculateDraftKings(row), 12.1);
assert.deepEqual(row, { receptions: 5, receivingYards: 71 }, 'Scoring must not fill missing stats with zeros');
assert.equal(getDraftKingsDetails({ position: 'WR', side: 'offense' }, row).partial, true);
for (const position of ['K', 'OL', 'LB', 'CB', 'S']) {
  assert.equal(getDraftKingsDetails({ position, side: position === 'K' || position === 'OL' ? 'offense' : 'defense' }, { sacks: 2, interceptions: 1 }).points, null);
}
const team: TeamSetup = { name: 'Test', qb: 'Starter', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 65, rushRating: 65, defenseRating: 60, context: '' };
const input: SimulationInput = {
  away: { ...team, roster: [
    { id: 'qb1', name: 'Starter', position: 'QB' }, { id: 'qb2', name: 'Unused backup', position: 'QB' },
    { id: 'rb', name: 'RB', position: 'RB' }, { id: 'wr', name: 'WR', position: 'WR' }, { id: 'te', name: 'TE', position: 'TE' },
  ] }, home: { ...team, name: 'Home' }, weather: { temperatureF: 68, windMph: 7, precipitation: 'none' }, seed: 42,
};
const game = simulateGame(input);
assert.equal(game.players.find(p => p.name === 'Unused backup')!.played, false);
assert.equal(game.players.find(p => p.name === 'Starter')!.played, true);
const points = (p: typeof game.players[number]) => calculateDraftKings({
  passYards: p.passYards, passTD: p.passTD, interceptions: p.interceptions, rushYards: p.rushYards, rushTD: p.rushTD,
  receptions: p.receptions, receivingYards: p.receivingYards, receivingTD: p.receivingTD, fumblesLost: p.fumblesLost,
});
game.players.forEach(p => assert.equal(p.draftKings, points(p)));
const runs = 30;
const ensemble = simulateEnsemble(input, runs);
ensemble.players.forEach((p, index) => {
  const totals = Array.from({ length: runs }, (_, i) => {
    const result = i === 0 ? game : simulateGame({ ...input, seed: (game.seed + Math.imul(i, 2654435761)) >>> 0 });
    return points(result.players[index]!);
  }).sort((a, b) => a - b);
  const mean = Math.round(totals.reduce((a, b) => a + b, 0) / runs * 100) / 100;
  assert.equal(ensemble.ensemble!.fantasy[index]!.mean, mean, 'Mean must average individually scored games and their bonuses');
  assert.equal(ensemble.ensemble!.fantasy[index]!.p10, totals[Math.floor((runs - 1) * .1)]);
  assert.equal(ensemble.ensemble!.fantasy[index]!.p90, totals[Math.floor((runs - 1) * .9)]);
});
console.log('DraftKings scoring, bonus thresholds, deductions, eligibility, participation and ensemble regressions passed.');