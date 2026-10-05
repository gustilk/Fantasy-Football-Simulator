import assert from 'node:assert/strict';
import { applyStandings, deleteStandings, findStandings, passingStrategyAdjustment, readStandings, saveStandings, standingPercentage, standingsNotes, validateStandings, STANDINGS_STORAGE_KEY, type StandingsSnapshot } from '../artifacts/gridiron-sim/src/lib/standings';
import { NFL_DIVISIONS, NFL_TEAM_NAMES } from '../artifacts/gridiron-sim/src/lib/nfl-divisions';
import { simulateEnsemble } from '../artifacts/gridiron-sim/src/lib/ensemble';
import type { TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { runWeeklySimulations } from '../artifacts/gridiron-sim/src/lib/weekly-simulations';

assert.equal(Object.keys(NFL_DIVISIONS).length, 8);
assert.equal(new Set(NFL_TEAM_NAMES).size, 32);
const snapshot: StandingsSnapshot = {
  season: 2026, week: 4, savedAt: '2026-10-01T00:00:00Z',
  entries: [
    { team: 'Buffalo Bills', record: { wins: 1, losses: 2, ties: 0 }, needsWin: true },
    { team: 'New England Patriots', record: { wins: 2, losses: 1, ties: 0 }, needsWin: false },
    { team: 'Kansas City Chiefs', needsWin: true },
  ],
};
const values = new Map<string, string>();
const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
assert.deepEqual(readStandings(storage), []);
saveStandings(storage, snapshot);
assert.deepEqual(findStandings(readStandings(storage), 2026, 4), snapshot);
assert.equal(findStandings(readStandings(storage), 2026, 3), undefined);
assert.equal(findStandings(readStandings(storage), 2025, 4), undefined);
saveStandings(storage, { ...snapshot, season: 2027 });
saveStandings(storage, { ...snapshot, entries: snapshot.entries.map(entry => ({ ...entry, needsWin: false })) });
assert.equal(readStandings(storage).length, 2, 'Editing replaces only the exact season/week');
const before = values.get(STANDINGS_STORAGE_KEY);
assert.throws(() => saveStandings({ getItem: storage.getItem, setItem: () => { throw Error('Quota'); } }, snapshot), /Previous saves are unchanged/);
assert.equal(values.get(STANDINGS_STORAGE_KEY), before);
assert.throws(() => readStandings({ getItem: () => '{"broken":true}' }), /not been replaced/);
assert.throws(() => saveStandings({ getItem: () => '{', setItem: () => assert.fail('Must not overwrite corruption') }, snapshot), /not been replaced/);
deleteStandings(storage, 2026, 4);
assert.equal(readStandings(storage).length, 1);
assert.equal(readStandings(storage)[0]!.season, 2027);
assert.throws(() => deleteStandings({ getItem: storage.getItem, setItem: () => { throw Error('Quota'); } }, 2027, 4), /unchanged/);

for (const record of [
  { wins: -1, losses: 2, ties: 0 }, { wins: 1.5, losses: 1, ties: 0 },
  { wins: 3, losses: 1, ties: 0 }, { wins: 1, losses: Number.NaN, ties: 0 },
]) assert.throws(() => validateStandings({ ...snapshot, entries: [{ ...snapshot.entries[0]!, record }] }));
assert.throws(() => validateStandings({ ...snapshot, entries: [...snapshot.entries, snapshot.entries[0]!] }), /duplicate/);
assert.throws(() => validateStandings({ ...snapshot, week: 1 }), /at most 0/);
assert.equal(standingPercentage({ team: 'Buffalo Bills', needsWin: false }), null);
assert.equal(standingPercentage({ team: 'Buffalo Bills', needsWin: false, record: { wins: 0, losses: 0, ties: 0 } }), null);
assert.equal(standingPercentage({ team: 'Buffalo Bills', needsWin: false, record: { wins: 1, losses: 0, ties: 1 } }), 0.75);

const makeSetup = (name: string): TeamSetup => ({
  name, qb: 'QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: 'WR3', te: 'TE', kicker: 'K',
  passRating: 55, rushRating: 55, defenseRating: 55, context: '',
  record: { wins: 0, losses: 3, ties: 0 },
});
const original = makeSetup('Buffalo Bills');
const unchanged = JSON.stringify(original);
const away = applyStandings(original, snapshot, 2026, 4);
const home = applyStandings(makeSetup('New England Patriots'), snapshot, 2026, 4);
const other = makeSetup('Kansas City Chiefs');
assert.equal(JSON.stringify(original), unchanged);
assert.equal(applyStandings(original, snapshot, 2026, 3), original, 'No future-week leakage');
assert.equal(applyStandings(original, snapshot, 2027, 4), original, 'No cross-season leakage');
assert.deepEqual(away.record, snapshot.entries[0]!.record, 'Manual record replaces, never adds to history');
assert.equal(passingStrategyAdjustment(away, home, 'regular'), 0.012);
assert.equal(passingStrategyAdjustment(home, away, 'regular'), 0, 'Unmarked opponent stays neutral');
assert.equal(passingStrategyAdjustment(away, other, 'regular'), 0, 'Non-division pressure stays neutral');
assert.equal(passingStrategyAdjustment(away, home, 'must-win'), 0.012, 'Pressure does not stack');
assert.equal(passingStrategyAdjustment(away, home, 'playoff'), 0.012);
assert.equal(passingStrategyAdjustment(original, home, 'playoff'), 0.008, 'Legacy behavior preserved');
assert.match(standingsNotes(away, home).join(' '), /unvalidated/);
assert.match(standingsNotes(away, other).join(' '), /inactive/);
assert.deepEqual(standingsNotes(original, other), []);
const input = { away, home, seed: 123, weather: { temperatureF: 68, windMph: 5, precipitation: 'none' as const } };
const frozen = structuredClone(input);
const first = simulateEnsemble(input, 4);
snapshot.entries[0]!.needsWin = false;
assert.deepEqual(simulateEnsemble(frozen, 4), first, 'Frozen replay never consults newer standings');
assert.ok(first.overview.some(note => note.includes('manually marked needs')));
const neutral = { ...input, away: { ...away, standings: undefined }, home: { ...home, standings: undefined } };
assert.deepEqual(simulateEnsemble(neutral, 4), simulateEnsemble(structuredClone(neutral), 4));

// Verify that the weekly runner freezes and saves the actual model inputs.
const teams: Parameters<typeof runWeeklySimulations>[0]['teams'] = ['Buffalo Bills', 'New England Patriots'].map((team, index) => ({
  season: 2026, team, version: 1, weeks: [],
  players: ['QB', 'RB', 'WR', 'TE'].map((position, n) => ({
    id: `${index}-${n}`, name: `Player ${index}-${n}`, position: position as 'QB' | 'RB' | 'WR' | 'TE', side: 'offense', active: true, depthRank: 1,
  })),
}));
snapshot.entries[0]!.needsWin = true;
const report = await runWeeklySimulations({
  season: 2026, week: 4, standings: snapshot, teams,
  games: [{ id: 'division-test', week: 4, awayTeam: teams[0]!.team, homeTeam: teams[1]!.team, date: '2026-10-04T17:00:00Z', timeConfirmed: true, seasonType: 'regular' }],
  fetchedAt: snapshot.savedAt, loadDepth: async () => { throw Error('Use saved ranks'); },
  save: entry => { assert.equal(entry.setup!.away.standings!.needsWin, true); assert.equal(entry.setup!.home.standings!.needsWin, false); },
  onProgress: () => {}, yieldUI: async () => { snapshot.entries[0]!.needsWin = false; },
  simulate: (received) => { assert.equal(received.away.standings!.needsWin, true); return first; },
});
assert.equal(report.saved.length, 1, JSON.stringify(report.failures));
console.log('Division standings: grouping, records, exact-week/season scope, team-specific pressure, non-division neutrality, frozen weekly inputs/replay, validation and storage safety passed.');
