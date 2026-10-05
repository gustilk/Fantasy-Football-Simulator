import assert from 'node:assert/strict';
import type { TeamSeasonRecord } from '@workspace/api-client-react';
import { setupFromHistory } from '../artifacts/gridiron-sim/src/lib/season-model';
import { simulateGame as simulate, type TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { captureQuarterbackStrategy, quarterbackPassShare, quarterbackStrategyNotes } from '../artifacts/gridiron-sim/src/lib/quarterback-strategy';
import { applyStandings, findStandings, readStandings, saveStandings, validateStandings, type StandingsSnapshot } from '../artifacts/gridiron-sim/src/lib/standings';

const team: TeamSeasonRecord = {
  team: 'Buffalo Bills', season: 2026, version: 1, updatedAt: '2026-10-05T18:00:00Z', weeks: [],
  players: [
    { id: 'qb1', name: 'Starter', position: 'QB', side: 'offense', active: true, depthRank: 1,
      availabilityOverride: { week: 4, status: 'out', updatedAt: '2026-10-05T18:00:00Z' } },
    { id: 'qb2', name: 'Replacement', position: 'QB', side: 'offense', active: true, depthRank: 2 },
    { id: 'rb', name: 'Runner', position: 'RB', side: 'offense', active: true, depthRank: 1 },
    { id: 'wr', name: 'Receiver', position: 'WR', side: 'offense', active: true, depthRank: 1 },
  ],
};
const replacement = setupFromHistory(team, 4);
assert.equal(replacement.qb, 'Replacement');
assert.equal(replacement.quarterbackStrategy?.backup, true);
assert.equal(replacement.quarterbackStrategy?.depthRank, 2);
assert.ok(!replacement.roster!.some(p => p.id === 'qb1'));
const restored = setupFromHistory(team, 5);
assert.equal(restored.qb, 'Starter', 'A week-specific absence does not permanently demote QB1');
assert.equal(restored.quarterbackStrategy?.backup, false);
const unknown = structuredClone(team);
for (const p of unknown.players) delete p.depthRank;
assert.equal(setupFromHistory(unknown, 4).quarterbackStrategy?.backup, false, 'Generated usage ranks cannot establish backup status');
assert.equal(captureQuarterbackStrategy([]).backup, false);
assert.equal(captureQuarterbackStrategy([{ id: 'q', name: 'QB3', position: 'QB', depthRank: 3, depthRankBasis: 'ESPN' }]).backup, true);
assert.equal(quarterbackPassShare(.575, replacement), .42);
assert.equal(quarterbackPassShare(.4, replacement), .28);
assert.equal(quarterbackPassShare(.68, replacement), .42, 'Pass-heavy history cannot cancel the backup run-heavy rule');
assert.equal(quarterbackPassShare(.59, restored), .59);
assert.equal(quarterbackPassShare(.59, { ...replacement, qb: 'Different QB' }), .59, 'Stale quarterback identity must not apply');
const legacy: TeamSetup = { ...replacement };
delete legacy.quarterbackStrategy;
assert.equal(quarterbackPassShare(.59, legacy), .59, 'Legacy forecasts must not infer from roster during replay');

const snapshot: StandingsSnapshot = { season: 2026, week: 4, savedAt: '2026-10-05T18:00:00Z',
  entries: [{ team: team.team, needsWin: true, backupQb: true }] };
const manual = applyStandings(restored, snapshot, 2026, 4);
assert.equal(manual.quarterbackStrategy?.basis, 'manual', 'Manual flags handle replacements now listed QB1');
assert.equal(quarterbackPassShare(.6, manual), .42);
assert.equal(applyStandings(restored, snapshot, 2026, 5), restored, 'Manual backup status never carries to another week');
assert.equal(applyStandings(restored, snapshot, 2025, 4), restored);
assert.equal(applyStandings(replacement, { ...snapshot, entries: [{ team: team.team, needsWin: false, backupQb: false }] }, 2026, 4).quarterbackStrategy?.backup, true, 'Unchecked means auto, not forcibly disabling a known backup');
assert.doesNotThrow(() => validateStandings({ ...snapshot, entries: [{ team: team.team, needsWin: false }] }), 'Existing snapshots without the new flag remain valid');
assert.throws(() => validateStandings({ ...snapshot, entries: [{ team: team.team, needsWin: false, backupQb: 'yes' as unknown as boolean }] }));
let data = '';
const storage = { getItem: () => data || null, setItem: (_key: string, value: string) => { data = value; } };
saveStandings(storage, snapshot);
assert.equal(findStandings(readStandings(storage), 2026, 4)!.entries[0]!.backupQb, true);
saveStandings(storage, { ...snapshot, entries: [{ team: team.team, needsWin: false, backupQb: false }] });
assert.equal(findStandings(readStandings(storage), 2026, 4)!.entries[0]!.backupQb, false);
assert.match(quarterbackStrategyNotes(manual)[0]!, /manually marked/);
assert.match(quarterbackStrategyNotes(replacement)[0]!, /listed QB2/);
assert.deepEqual(quarterbackStrategyNotes(legacy), []);

const weather = { temperatureF: 68, windMph: 0, precipitation: 'none' as const };
const home = { ...restored, name: 'Miami Dolphins' };
const baseInput = { away: legacy, home, weather, seed: 7 };
const original = simulate(baseInput);
assert.deepEqual(simulate({ ...baseInput, away: { ...legacy, quarterbackStrategy: { model: 'backup-run-v1', quarterback: legacy.qb, backup: false, basis: 'depth-chart', depthRank: 1 } } }), original, 'No change to play calls or output with a regular starter');
const frozen = JSON.parse(JSON.stringify({ ...baseInput, away: manual }));
const expected = simulate(frozen);
saveStandings(storage, { ...snapshot, entries: [{ team: team.team, needsWin: false }] });
assert.deepEqual(simulate(frozen), expected, 'Later edits cannot alter frozen backup-QB replay');
let basePassing = 0, backupPassing = 0, baseRushing = 0, backupRushing = 0;
for (let seed = 1; seed <= 80; seed++) {
  const baseline = simulate({ ...baseInput, seed });
  const adjusted = simulate({ ...baseInput, away: replacement, seed });
  for (const [result, backup] of [[baseline, false], [adjusted, true]] as const) {
    const players = result.players.filter(p => p.team === team.team);
    if (backup) {
      backupPassing += players.reduce((n, p) => n + p.passYards, 0);
      backupRushing += players.reduce((n, p) => n + p.rushYards, 0);
    } else {
      basePassing += players.reduce((n, p) => n + p.passYards, 0);
      baseRushing += players.reduce((n, p) => n + p.rushYards, 0);
    }
  }
}
assert.ok(backupPassing < basePassing, 'Backup strategy reduces aggregate passing production');
assert.ok(backupRushing > baseRushing, 'Backup strategy increases aggregate rushing production');
console.log('Backup QB detection, weekly overrides, unknown-role neutrality, run-heavy selection, storage compatibility, manual flags and frozen replay passed.');
