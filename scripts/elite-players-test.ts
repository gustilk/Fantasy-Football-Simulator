import assert from 'node:assert/strict';
import { ELITE_1X_CANDIDATES, isElite1x, eliteOpportunityWeight } from '../artifacts/gridiron-sim/src/lib/elite-players';
import { simulateGame, type SimulationInput, type TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { mergeNflImport } from '../artifacts/gridiron-sim/src/lib/nfl-import-merge';
import { SaveSeasonTeamBody, ListSeasonTeamsResponse } from '../lib/api-zod/src/generated/api';
import { calculateDraftKings } from '../artifacts/gridiron-sim/src/lib/draftkings';

assert.equal(ELITE_1X_CANDIDATES.length, 20);
for (const [name, position] of ELITE_1X_CANDIDATES) assert.equal(isElite1x({ name, position }), true);
assert.equal(isElite1x({ name: 'James Cook', position: 'RB' }), true);
assert.equal(isElite1x({ name: 'Amon Ra St Brown', position: 'WR' }), true);
assert.equal(isElite1x({ name: 'Josh Allen', position: 'EDGE' }), false);
assert.equal(isElite1x({ name: 'Josh Allen', position: 'QB', side: 'defense', elite1x: true }), false);
assert.equal(isElite1x({ name: 'Josh Allen', position: 'QB', elite1x: false }), false);
assert.equal(isElite1x({ name: 'My player', position: 'WR', elite1x: true }), true);
assert.equal(eliteOpportunityWeight(10, true), 12);
assert.equal(eliteOpportunityWeight(0, true), 0);
assert.equal(eliteOpportunityWeight(10, false), 10);

const roster = [
  { id: 'qb', name: 'Quarterback', position: 'QB' as const, depthRank: 1, elite1x: false, historyObservations: 6, recentStats: { passAttempts: 34, passCompletions: 22, passYards: 250, passTD: 1.5, rushAttempts: 8, rushYards: 40 } },
  { id: 'rb', name: 'Runner', position: 'RB' as const, depthRank: 1, elite1x: false, historyObservations: 6, recentStats: { rushAttempts: 20, rushYards: 85, targets: 4, receptions: 3, receivingYards: 25 } },
  { id: 'wr1', name: 'Receiver', position: 'WR' as const, depthRank: 1, elite1x: false, historyObservations: 6, recentStats: { targets: 10, receptions: 7, receivingYards: 80 } },
  { id: 'wr2', name: 'Other receiver', position: 'WR' as const, depthRank: 2, elite1x: false, historyObservations: 6, recentStats: { targets: 8, receptions: 5, receivingYards: 60 } },
  { id: 'te', name: 'Tight end', position: 'TE' as const, depthRank: 1, elite1x: false, historyObservations: 6, recentStats: { targets: 5, receptions: 3, receivingYards: 35 } },
];
const team: TeamSetup = { name: 'Buffalo Bills', qb: 'Quarterback', rb: 'Runner', wr1: 'Receiver', wr2: 'Other receiver', wr3: '', te: 'Tight end', kicker: 'Kicker', passRating: 60, rushRating: 60, defenseRating: 60, context: '', roster };
const input: SimulationInput = { away: team, home: { ...team, name: 'Detroit Lions' }, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' } };
const boosted = structuredClone(input);
boosted.away.roster![0]!.elite1x = true;
boosted.away.roster![2]!.elite1x = true;
let baseReceptions = 0, boostedReceptions = 0, baseQbRush = 0, boostedQbRush = 0;
for (let seed = 1; seed <= 800; seed++) {
  const base = simulateGame({ ...input, seed });
  const elite = simulateGame({ ...boosted, seed });
  const get = (result: typeof base, id: string) => result.players.find(p => p.team === team.name && p.id === id)!;
  baseReceptions += get(base, 'wr1').receptions;
  boostedReceptions += get(elite, 'wr1').receptions;
  baseQbRush += get(base, 'qb').rushYards;
  boostedQbRush += get(elite, 'qb').rushYards;
  for (const player of elite.players) assert.equal(player.draftKings, calculateDraftKings(player));
}
assert.ok(boostedReceptions > baseReceptions * 1.05, `${boostedReceptions} vs ${baseReceptions} receptions`);
assert.ok(boostedQbRush > baseQbRush * 1.05, `${boostedQbRush} vs ${baseQbRush} QB rushing yards`);

const players = roster.map(p => ({ id: p.id, name: p.name, position: p.position, side: 'offense' as const, active: true, depthRank: p.depthRank, elite1x: p.elite1x }));
players[0]!.name = 'Josh Allen';
players[0]!.elite1x = true;
const inactive = { id: 'inactive', name: 'CeeDee Lamb', position: 'WR' as const, side: 'offense' as const, active: false, elite1x: true };
const out = { id: 'out', name: 'Jayden Daniels', position: 'QB' as const, side: 'offense' as const, active: true, elite1x: true, availabilityOverride: { week: 4, status: 'out' as const, updatedAt: '2026-10-03T12:00:00Z' } };
const weeks = [1, 2, 3].map(week => ({ week, status: 'played' as const, opponent: 'Detroit Lions', venue: 'home' as const, result: 'W' as const, teamScore: 24, opponentScore: 20, teamDefense: {}, playerStats: Object.fromEntries(roster.map(p => [p.id, p.recentStats])) }));
const body = SaveSeasonTeamBody.parse({ players: [...players, inactive, out], weeks, expectedVersion: 1 });
assert.equal(body.players.find(p => p.id === 'wr1')!.elite1x, false);
assert.equal(body.players.find(p => p.id === 'qb')!.elite1x, true);
assert.equal(SaveSeasonTeamBody.safeParse({ ...body, players: [{ ...players[0], elite1x: 'false' }] }).success, false);
const record = { ...body, id: 1, season: 2026, team: 'Buffalo Bills', version: 1, updatedAt: new Date().toISOString() };
const [returned] = ListSeasonTeamsResponse.parse(JSON.parse(JSON.stringify([record])));
const setup = setupFromHistory(returned!, 4, 'away', 'Detroit Lions');
assert.ok(!setup.roster!.some(p => p.id === 'inactive' || p.id === 'out'));
assert.equal(setup.roster!.find(p => p.id === 'qb')!.elite1x, true);
assert.equal(setup.roster!.find(p => p.id === 'wr1')!.elite1x, false);
const merged = mergeNflImport({ players: body.players, weeks }, { players: [{ ...body.players.find(p => p.id === 'wr1')!, elite1x: true }], weeks: [] } as Parameters<typeof mergeNflImport>[1], { replaceStats: false, updateRoster: true });
assert.equal(merged.draft.players.find(p => p.id === 'wr1')!.elite1x, false);
const manual = { ...team, roster: undefined, qb: 'Josh Allen', elite1x: { qb: false, wr1: true } };
const manualResult = simulateGame({ ...input, away: manual, seed: 50 });
assert.equal(manualResult.players.find(p => p.team === team.name && p.position === 'QB')!.elite1x, false);
assert.equal(manualResult.players.find(p => p.team === team.name && p.name === 'Receiver')!.elite1x, true);
console.log('1x tests passed: 20 defaults, overrides, contracts, refresh retention, eligibility, QB rushing, receptions, manual inputs and unchanged scoring.');
console.log({ baseReceptions, boostedReceptions, baseQbRush, boostedQbRush });