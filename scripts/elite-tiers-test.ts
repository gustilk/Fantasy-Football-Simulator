import assert from 'node:assert/strict';
import { getEliteTier, savedEliteTier, eliteOpportunityWeight } from '../artifacts/gridiron-sim/src/lib/elite-players';
import { simulateGame, type SimulationInput, type TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import { gameForecast } from '../artifacts/gridiron-sim/src/lib/draftkings-board';
import { readDKArchive, writeDKArchive } from '../artifacts/gridiron-sim/src/lib/draftkings-archive';
import { mergeNflImport } from '../artifacts/gridiron-sim/src/lib/nfl-import-merge';
import { SaveSeasonTeamBody, ListSeasonTeamsResponse } from '../lib/api-zod/src/generated/api';
import { calculateDraftKings } from '../artifacts/gridiron-sim/src/lib/draftkings';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';

const assignments = [
  ['Lamar Jackson', 'QB', 2], ['Trey McBride', 'TE', 2], ["Ja'Marr Chase", 'WR', 2],
  ['Amon-Ra St. Brown', 'WR', 2], ['Puka Nacua', 'WR', 2], ['CeeDee Lamb', 'WR', 2],
  ['Jahmyr Gibbs', 'RB', 3], ['Brock Bowers', 'TE', 3], ['Bijan Robinson', 'RB', 3],
  ['Jaxon Smith-Njigba', 'WR', 3], ['Josh Allen', 'QB', 3],
  ['Nico Collins', 'WR', 1], ['Zay Flowers', 'WR', 1], ['Parker Washington', 'WR', 1], ['Ashton Jeanty', 'RB', 1],
] as const;
for (const [name, position, tier] of assignments) assert.equal(getEliteTier({ name, position }), tier, name);
assert.equal(getEliteTier({ name: 'Jamar Chase', position: 'WR' }), 2);
assert.equal(getEliteTier({ name: 'Amon Ra St Brown', position: 'WR' }), 2);
assert.equal(getEliteTier({ name: 'James Cook', position: 'RB' }), 1, 'Unlisted original default is retained');
assert.equal(getEliteTier({ name: 'Unknown', position: 'WR' }), 0);
assert.equal(getEliteTier({ name: 'Josh Allen', position: 'QB', eliteTier: 0, elite1x: true }), 0);
assert.equal(getEliteTier({ name: 'Josh Allen', position: 'QB', eliteTier: 2, elite1x: false }), 2);
assert.equal(getEliteTier({ name: 'Josh Allen', position: 'QB', elite1x: false }), 0);
assert.equal(getEliteTier({ name: 'Josh Allen', position: 'EDGE', eliteTier: 3 }), 0);
assert.equal(getEliteTier({ name: 'Josh Allen', position: 'QB', side: 'defense', eliteTier: 3 }), 0);
assert.equal(savedEliteTier({ elite1x: true }), 1, 'Old results remain 1x regardless of updated defaults');
assert.equal(savedEliteTier({}), 0);
assert.equal(savedEliteTier({ eliteTier: 3, elite1x: true }), 3);
assert.deepEqual(([0, 1, 2, 3] as const).map(t => eliteOpportunityWeight(10, t)), [10, 12, 14, 16]);

const players = [
  { id: 'qb', name: 'Test passer', position: 'QB' as const, eliteTier: 0 as const, recentStats: { passAttempts: 34, passCompletions: 22, passYards: 250, rushAttempts: 7, rushYards: 35 } },
  { id: 'rb', name: 'Test runner', position: 'RB' as const, eliteTier: 0 as const, recentStats: { rushAttempts: 20, rushYards: 100 } },
  { id: 'wr', name: 'Test receiver', position: 'WR' as const, eliteTier: 0 as const },
  { id: 'wr2', name: 'Other receiver', position: 'WR' as const, eliteTier: 0 as const },
  { id: 'te', name: 'Test tight end', position: 'TE' as const, eliteTier: 0 as const },
];
const team: TeamSetup = { name: 'Buffalo Bills', qb: 'Test passer', rb: 'Test runner', wr1: 'Test receiver', wr2: 'Other receiver', wr3: '', te: 'Test tight end', kicker: '', passRating: 60, rushRating: 60, defenseRating: 60, context: '', roster: players };
const input: SimulationInput = { away: team, home: { ...team, name: 'Detroit Lions' }, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' } };
const usage: { tier: number; catches: number; qbRush: number }[] = [];
for (const tier of [0, 1, 2, 3] as const) {
  const boosted = structuredClone(input);
  boosted.away.roster![0]!.eliteTier = tier;
  boosted.away.roster![2]!.eliteTier = tier;
  let catches = 0, qbRush = 0;
  for (let seed = 1; seed <= 600; seed++) {
    const result = simulateGame({ ...boosted, seed });
    const qb = result.players.find(p => p.team === team.name && p.id === 'qb')!;
    const wr = result.players.find(p => p.team === team.name && p.id === 'wr')!;
    assert.equal(qb.eliteTier, tier);
    catches += wr.receptions; qbRush += qb.rushYards;
    for (const player of result.players) assert.equal(player.draftKings, calculateDraftKings(player), 'No fantasy-point multiplier');
  }
  usage.push({ tier, catches, qbRush });
}
for (let i = 1; i < usage.length; i++) {
  assert.ok(usage[i]!.catches > usage[i - 1]!.catches, 'Receiving opportunities rise with tier');
  assert.ok(usage[i]!.qbRush > usage[i - 1]!.qbRush, 'QB rushing opportunities rise with tier');
}
const manual: TeamSetup = { ...team, roster: undefined, qb: 'Josh Allen', eliteTiers: { qb: 0, wr1: 3 } };
const manualResult = simulateGame({ ...input, away: manual, seed: 5 });
assert.equal(manualResult.players.find(p => p.team === team.name && p.position === 'QB')!.eliteTier, 0);
assert.equal(manualResult.players.find(p => p.team === team.name && p.name === 'Test receiver')!.eliteTier, 3);
const weeks = [1, 2, 3].map(week => ({ week, status: 'played' as const, opponent: 'Detroit Lions', venue: 'away' as const, result: 'W' as const, teamScore: 24, opponentScore: 20, teamDefense: {}, playerStats: Object.fromEntries(players.map(p => [p.id, p.recentStats ?? {}])) }));
const roster = players.map(p => ({ ...p, side: 'offense' as const, active: true }));
for (const tier of [0, 1, 2, 3] as const) {
  const body = SaveSeasonTeamBody.parse({ players: roster.map(p => ({ ...p, eliteTier: tier })), weeks, expectedVersion: 1 });
  const [record] = ListSeasonTeamsResponse.parse([{ ...body, season: 2026, team: team.name, version: 1, updatedAt: new Date() }]);
  assert.equal(record!.players[0]!.eliteTier, tier);
  const merged = mergeNflImport({ players: body.players, weeks }, { players: roster.map(p => ({ ...p, eliteTier: 3 })), weeks: [] } as Parameters<typeof mergeNflImport>[1], { updateRoster: true, replaceStats: false });
  assert.equal(merged.draft.players[0]!.eliteTier, tier, 'NFL refresh preserves explicit tier, including None');
  record!.players[0]!.active = false;
  record!.players[2]!.availabilityOverride = { week: 4, status: 'out', updatedAt: '2026-10-03T12:00:00Z' };
  record!.players.push({ id: 'backup', name: 'Backup', position: 'QB', side: 'offense', active: true, eliteTier: 0 });
  const eligible = setupFromHistory(record!, 4, 'away', 'Detroit Lions').roster!;
  assert.ok(!eligible.some(p => p.id === 'qb' || p.id === 'wr'));
  assert.equal(eligible.find(p => p.id === 'rb')!.eliteTier, tier);
}
for (const invalid of [-1, 4, 1.5, '3']) assert.equal(SaveSeasonTeamBody.safeParse({ players: [{ ...roster[0], eliteTier: invalid }], weeks: [], expectedVersion: 0 }).success, false);
const projected = structuredClone(input); projected.away.roster![0]!.eliteTier = 3; projected.away.roster![2]!.eliteTier = 2;
const game = { id: 'game', week: 4, date: '2026-10-04T17:00:00Z', awayTeam: team.name, homeTeam: 'Detroit Lions' } as Parameters<typeof gameForecast>[0];
const forecast = gameForecast(game, projected, simulateEnsemble(projected, 50));
assert.equal(forecast.players.find(p => p.playerId === 'qb' && p.team === team.name)!.eliteTier, 3);
assert.equal(forecast.players.find(p => p.playerId === 'wr' && p.team === team.name)!.eliteTier, 2);
const storage = { value: '', getItem() { return this.value; }, setItem(_key: string, value: string) { this.value = value; } };
writeDKArchive(storage, { version: 1, official: [], slates: [{ id: 'slate', season: 2026, sunday: '2026-10-04', createdAt: '2026-10-03T12:00:00Z', timezone: 'America/Chicago', forecasts: [forecast], failures: [] }] });
assert.deepEqual(readDKArchive(storage).slates[0]!.forecasts[0]!.players, forecast.players, 'Reload retains exact tier badges and projections');
console.log('All 15 assignments, 20/40/60 weights, aliases, None overrides, legacy snapshots, import preservation, injury filtering, API contracts, monotonic QB/receiving usage and DK archive tiers passed.', usage);