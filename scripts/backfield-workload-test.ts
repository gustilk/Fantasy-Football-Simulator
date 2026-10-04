import assert from 'node:assert/strict';
import { backfieldOpportunityWeight, backfieldReceivingPrior, backfieldEfficiency } from '../artifacts/gridiron-sim/src/lib/backfield-workload';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateGame, type SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { gameForecast } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import { readDKArchive, writeDKArchive } from '../artifacts/gridiron-sim/src/lib/draftkings-archive';
import type { TeamSeasonRecord } from '../lib/api-client-react/src/generated/api';

assert.equal(backfieldReceivingPrior(1), backfieldReceivingPrior(2), 'RB1 is not automatically the receiving back');
assert.equal(backfieldOpportunityWeight(20, 0, 5), 20 / 6, 'Reported zero can pull below the old 65% role floor');
assert.equal(backfieldOpportunityWeight(20, undefined, 5), 20, 'Unknown workload is not zero');
assert.equal(backfieldOpportunityWeight(20, 1, 0), 20, 'No eligible observations uses prior');
assert.ok(backfieldOpportunityWeight(1, 25, 5) <= 1.75, 'Old starter stint still cannot promote a deep backup');
assert.ok(backfieldOpportunityWeight(2, 1, 1) < backfieldOpportunityWeight(2, 7 / 3, 3), 'Receiving involvement favors the observed receiving back');
assert.equal(backfieldEfficiency(undefined, false), 1);
assert.equal(backfieldEfficiency(undefined, true), 8 / 12);
assert.ok(backfieldEfficiency({ rushAttempts: 32, rushYards: 109, receivingCatches: 0, receivingYards: 0 }, false) < 1, 'Observed inefficient rushing lowers yards per run');
assert.equal(backfieldEfficiency({ rushAttempts: 0, rushYards: 0, receivingCatches: 0, receivingYards: 0 }, false), 1, 'No paired attempts is not zero efficiency');

const record: TeamSeasonRecord = {
  team: 'Test Team', season: 2035, version: 1,
  players: [
    { id: 'qb', name: 'QB', position: 'QB', side: 'offense', active: true, depthRank: 1 },
    { id: 'lead', name: 'Lead', position: 'RB', side: 'offense', active: true, depthRank: 1 },
    { id: 'receiver', name: 'Receiving Back', position: 'RB', side: 'offense', active: true, depthRank: 2 },
    ...['WR', 'TE'].map(position => ({ id: position, name: position, position, side: 'offense', active: true, depthRank: 1 })),
  ] as TeamSeasonRecord['players'],
  weeks: [1, 2, 3].map((week, i) => ({
    week, status: 'played', opponent: 'Opponent', venue: 'home', result: 'W', teamScore: 21, opponentScore: 14, teamDefense: {},
    playerStats: {
      qb: { passAttempts: 30, passYards: 210, rushAttempts: 2, rushYards: 10 },
      lead: { rushAttempts: [2, 21, 9][i]!, rushYards: [3, 92, 14][i]!, rushTD: 0, ...(i === 1 ? { targets: 1, receptions: 0, receivingYards: 0 } : {}) },
      receiver: { rushAttempts: [8, 4, 3][i]!, rushYards: [29, 13, 10][i]!, targets: [1, 1, 5][i]!, receptions: [0, 1, 5][i]!, receivingYards: [0, 2, 48][i]! },
      WR: { targets: 10, receptions: 6, receivingYards: 75 }, TE: { targets: 5, receptions: 3, receivingYards: 30 },
    },
  })),
};
const untouched = structuredClone(record);
const setup = setupFromHistory(record, 4, 'home');
assert.deepEqual(record, untouched, 'No roster/history changes');
assert.equal(setup.backfieldModel, 'usage-v1');
assert.deepEqual(setup.roster!.find(p => p.id === 'lead')!.backfieldEvidence, { rushAttempts: 32, rushYards: 109, receivingCatches: 0, receivingYards: 0 });
assert.equal(setup.roster!.find(p => p.id === 'lead')!.usage!.targetGames, 1, 'Missing target reports must not become zeroes');
const partial = structuredClone(record);
partial.weeks[0]!.playerStats.lead = { rushYards: 999 };
assert.equal(setupFromHistory(partial, 4, 'home').roster!.find(p => p.id === 'lead')!.backfieldEvidence!.rushYards, 106, 'Unpaired yards excluded');
const future = structuredClone(record);
future.weeks.push({ ...record.weeks[0]!, week: 4, playerStats: { lead: { rushAttempts: 100, rushYards: 900 } } });
assert.deepEqual(setupFromHistory(future, 4, 'home').roster!.find(p => p.id === 'lead')!.backfieldEvidence, setup.roster!.find(p => p.id === 'lead')!.backfieldEvidence, 'No target-week leakage');
const excluded = structuredClone(record);
excluded.players.find(p => p.id === 'receiver')!.active = false;
assert.ok(!setupFromHistory(excluded, 4, 'home').roster!.some(p => p.id === 'receiver'), 'Availability still applies');
const input: SimulationInput = { home: setup, away: { ...setup, name: 'Opponent' }, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 123 };
const legacy = structuredClone(input);
delete legacy.home.backfieldModel; delete legacy.away.backfieldModel;
const noEvidence = structuredClone(legacy);
for (const team of [noEvidence.home, noEvidence.away]) for (const player of team.roster!) delete player.backfieldEvidence;
assert.deepEqual(simulateGame(legacy), simulateGame(noEvidence), 'Legacy snapshots ignore new metadata and retain behavior');
let oldPoints = 0, newPoints = 0, receivingBackCatches = 0, leadCatches = 0;
for (let seed = 1; seed <= 500; seed++) {
  const oldResult = simulateGame({ ...legacy, seed }), newResult = simulateGame({ ...input, seed });
  oldPoints += oldResult.players.find(p => p.id === 'lead' && p.team === setup.name)!.draftKings;
  const lead = newResult.players.find(p => p.id === 'lead' && p.team === setup.name)!;
  newPoints += lead.draftKings; leadCatches += lead.receptions;
  receivingBackCatches += newResult.players.find(p => p.id === 'receiver' && p.team === setup.name)!.receptions;
}
assert.ok(newPoints < oldPoints, 'Weak rushing and receiving evidence reduces this synthetic lead-back projection, without a score cap');
assert.ok(receivingBackCatches > leadCatches, 'Observed receiving back catches more passes despite RB2 rank');
const result = simulateEnsemble(input, 50);
const forecast = gameForecast({ id: 'test', date: '2035-10-04T17:00:00Z', week: 4, awayTeam: 'Opponent', homeTeam: setup.name } as never, input, result);
const storage = { value: '', getItem() { return this.value; }, setItem(_k: string, value: string) { this.value = value; } };
writeDKArchive(storage, { version: 1, official: [], slates: [{ id: 'test', season: 2035, sunday: '2035-10-04', createdAt: '2035-10-03T17:00:00Z', timezone: 'America/Chicago', forecasts: [forecast], failures: [] }] });
const loaded = readDKArchive(storage).slates[0]!.forecasts[0]!;
assert.equal(loaded.input.home.backfieldModel, 'usage-v1');
assert.deepEqual(simulateEnsemble(loaded.input, 50).ensemble, result.ensemble, 'New version/evidence survives save and exact replay');
console.log('Backfield workload, paired efficiency, shared receiving, unknown/zero evidence, injuries, no leakage and versioned replay passed.', { legacyMean: oldPoints / 500, revisedMean: newPoints / 500 });