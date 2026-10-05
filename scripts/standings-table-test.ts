import assert from 'node:assert/strict';
import { applyStandings, findStandings, parseStandingTableStats, readStandings, saveStandings, validateStandings, type StandingsSnapshot } from '../artifacts/gridiron-sim/src/lib/standings';
import type { TeamSetup } from '../artifacts/gridiron-sim/src/lib/simulator';
import { simulateGame } from '../artifacts/gridiron-sim/src/lib/simulator';

const blank = { pointsFor: '', pointsAgainst: '', home: '', away: '', streak: '' };
const record = { wins: 3, losses: 1, ties: 0 };
assert.equal(parseStandingTableStats(blank, 4), undefined, 'Unknown columns must not become zeros');
const stats = parseStandingTableStats({ pointsFor: '127', pointsAgainst: '107', home: '2-1', away: '1-0', streak: 'l1' }, 4, record)!;
assert.deepEqual(stats, { pointsFor: 127, pointsAgainst: 107, home: '2-1', away: '1-0', streak: 'L1' });
assert.equal(parseStandingTableStats({ ...blank, pointsFor: '0' }, 4)!.pointsFor, 0, 'Explicit zero remains valid');
assert.deepEqual(parseStandingTableStats({ ...blank, home: '0-0-1', away: '1-0', streak: 'T1' }, 2, { wins: 1, losses: 0, ties: 1 }), { home: '0-0-1', away: '1-0', streak: 'T1' });
for (const patch of [
  { pointsFor: '-1' }, { pointsAgainst: '1.5' }, { pointsFor: '10000' },
  { home: '2' }, { home: '3-2' }, { home: '1-0', away: '3-1' },
  { home: '1-0', away: '1-0' }, { home: '0-0-1' }, { streak: 'X1' }, { streak: 'W0' }, { streak: 'L2' },
]) assert.throws(() => parseStandingTableStats({ ...blank, ...patch }, 4, record));
assert.throws(() => parseStandingTableStats({ ...blank, pointsFor: '1' }, 0), /PF/);
const snapshot: StandingsSnapshot = {
  season: 2026, week: 5, savedAt: '2026-10-05T18:00:00Z',
  entries: [
    { team: 'Buffalo Bills', record, needsWin: true, backupQb: true, tableStats: stats },
    { team: 'Chicago Bears', record: { wins: 2, losses: 2, ties: 0 }, needsWin: false, tableStats: { pointsFor: 85, home: '1-1', away: '1-1', streak: 'W1' } },
  ],
};
let value = '';
const storage = { getItem: () => value || null, setItem: (_key: string, json: string) => { value = json; } };
saveStandings(storage, snapshot);
assert.deepEqual(findStandings(readStandings(storage), 2026, 5), snapshot, 'All conferences and optional columns survive reload');
const edited = structuredClone(snapshot);
edited.entries[0]!.needsWin = false;
saveStandings(storage, edited);
assert.deepEqual(findStandings(readStandings(storage), 2026, 5)!.entries.map(e => e.tableStats), snapshot.entries.map(e => e.tableStats), 'Unrelated flag changes must preserve optional columns and hidden-conference data');
const before = value;
const invalid = structuredClone(snapshot);
invalid.entries[0]!.tableStats!.streak = 'L4';
assert.throws(() => saveStandings(storage, invalid));
assert.equal(value, before, 'Validation failure must preserve all saved data');
assert.throws(() => validateStandings({ ...snapshot, entries: [{ ...snapshot.entries[0]!, tableStats: { pointsFor: '127' as unknown as number } }] }));
assert.throws(() => validateStandings({ ...snapshot, entries: [{ ...snapshot.entries[0]!, tableStats: null as unknown as typeof stats }] }));
const setup: TeamSetup = { name: 'Buffalo Bills', qb: 'QB', rb: 'RB', wr1: 'WR1', wr2: 'WR2', wr3: '', te: 'TE', kicker: 'K', passRating: 55, rushRating: 55, defenseRating: 55, context: '' };
const withStats = applyStandings(setup, snapshot, 2026, 5);
const without = structuredClone(snapshot);
delete without.entries[0]!.tableStats;
const withoutStats = applyStandings(setup, without, 2026, 5);
const input = { home: { ...setup, name: 'Miami Dolphins' }, weather: { temperatureF: 68, windMph: 0, precipitation: 'none' as const }, seed: 42 };
assert.deepEqual(simulateGame({ ...input, away: withStats }), simulateGame({ ...input, away: withoutStats }), 'Display statistics must not add scoring or strength adjustments');
console.log('Standings table columns: unknowns, zeros, splits, ties, streaks, validation, save/reload, both-conference preservation and simulation neutrality passed.');
