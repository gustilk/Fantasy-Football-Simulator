import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getOffensiveLineTier, protectedSackProbability } from '../artifacts/gridiron-sim/src/lib/offensive-line.ts';
import { simulateGame, type SimulationInput } from '../artifacts/gridiron-sim/src/lib/simulator.ts';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model.ts';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble.ts';
import { SaveSeasonTeamBody } from '../lib/api-zod/src/generated/api.ts';
import { mergeNflImport } from '../artifacts/gridiron-sim/src/lib/nfl-import-merge.ts';
import type { NflImportPreview } from '../lib/api-client-react/src/generated/api.schemas.ts';

assert.equal(getOffensiveLineTier({ team: 'San Francisco 49ers' }), 1.5);
assert.equal(getOffensiveLineTier({ team: 'San Francisco 49ers', offensiveLineTier: 0 }), 0);
assert.equal(getOffensiveLineTier({ team: 'San Francisco 49ers', offensiveLineTier: null }), 1.5);
assert.equal(getOffensiveLineTier({ team: 'Arizona Cardinals' }), 0);
for (const p of [0.015, 0.047, 0.09, 0.13]) {
  assert.equal(protectedSackProbability(p), p);
  assert.equal(protectedSackProbability(p, 0), p);
  assert.equal(protectedSackProbability(p, 1.5), p * 0.7, 'Exactly 30% below the already-clamped matchup risk.');
  assert.ok(protectedSackProbability(p, 1.5) > 0);
}
assert.throws(() => protectedSackProbability(0.04, 2 as never), /Unsupported/);
assert.throws(() => protectedSackProbability(NaN), /Invalid/);
const body = { expectedVersion: 1, players: [], weeks: [] };
for (const offensiveLineTier of [0, 1.5, null]) assert.ok(SaveSeasonTeamBody.safeParse({ ...body, offensiveLineTier }).success);
for (const offensiveLineTier of [-1, 1, 2, '1.5']) assert.equal(SaveSeasonTeamBody.safeParse({ ...body, offensiveLineTier }).success, false);
assert.equal(SaveSeasonTeamBody.parse(body).offensiveLineTier, undefined, 'Omitted preference stays omitted for preserving updates.');
const record = { season: 2026, team: 'San Francisco 49ers', version: 1, players: [], weeks: [] };
assert.equal(setupFromHistory(record, 5, 'away').offensiveLineTier, 1.5);
assert.equal(setupFromHistory({ ...record, offensiveLineTier: 0 }, 5, 'away').offensiveLineTier, 0);
const draft = { players: [], weeks: [], offensiveLineTier: 1.5 as const };
const merged = mergeNflImport(draft, { players: [], weeks: [] } as unknown as NflImportPreview, { replaceStats: false, updateRoster: false });
assert.equal((merged.draft as typeof draft).offensiveLineTier, 1.5, 'Roster refresh retains the team preference.');

const team = { qb: 'QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K', passRating: 60, rushRating: 55, defenseRating: 58, context: '' };
const input: SimulationInput = { away: { ...team, name: 'Away' }, home: { ...team, name: 'Home' },
  weather: { temperatureF: 68, windMph: 5, precipitation: 'none' }, seed: 123, showdownModel: 'showdown-v1', driveModel: 'possession-v1' };
assert.equal(createHash('sha256').update(JSON.stringify(simulateGame(input))).digest('hex'),
  '61435d1bc02c7c3f0dd97da5fc94b334aa85d5349d8b41b9b02bcbcde20c3899', 'Missing protection tags preserve frozen possession replay.');
assert.deepEqual(simulateGame(input), simulateGame({ ...input, away: { ...input.away, offensiveLineTier: 0 } }));
assert.throws(() => simulateGame({ ...input, away: { ...input.away, offensiveLineTier: 2 as never } }), /Unsupported/);
const countSacks = (i: SimulationInput) => {
  let sacks = 0;
  for (let seed = 1; seed <= 500; seed++) sacks += simulateGame({ ...i, seed }).defenses![1]!.sacks;
  return sacks;
};
for (const driveModel of [undefined, 'possession-v1'] as const) {
  const base = { ...input, driveModel }, protectedInput = { ...base, away: { ...base.away, offensiveLineTier: 1.5 as const } };
  const unprotected = countSacks(base), protectedCount = countSacks(protectedInput);
  assert.ok(protectedCount < unprotected * 0.85, 'Both engines must reduce the correct opposing DST sack count.');
  assert.ok(protectedCount > 0, 'Tag does not prohibit sacks.');
  console.log(`${driveModel ?? 'legacy'}: tagged offense sacks ${unprotected} → ${protectedCount} over 500 fixed seeds.`);
}
const updated = { ...input, away: { ...input.away, offensiveLineTier: 1.5 as const } };
const ensemble = simulateEnsemble(updated, 200);
assert.deepEqual(ensemble, simulateEnsemble(JSON.parse(JSON.stringify(updated)), 200), 'Frozen tag survives export/replay.');
assert.ok(ensemble.overview.some(n => n.includes('O-line protection 1.5x') && n.includes('30%')));
console.log('O-line protection: exact conditional reduction, positive sack risk, defaults/None, validation, import retention, both engines, opposing DST accounting and frozen replay passed.');
