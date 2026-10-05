import assert from 'node:assert/strict';
import { salaryRowsCsv, sharedSalaryRecord } from '../artifacts/gridiron-sim/src/lib/salary-sync';
import { parseSalaryCsv, type SalaryPlayer } from '../artifacts/gridiron-sim/src/lib/lineups';
import type { SavedSalaries } from '../artifacts/gridiron-sim/src/lib/salary-storage';

const players: SalaryPlayer[] = [
  { id: '123', name: 'Test, "QB"', position: 'QB', team: 'BUF', salary: 10000, gameInfo: 'BUF@MIA 10/11/2026 01:00PM ET', rosterPosition: 'QB' },
  { id: '124', name: 'Test WR', position: 'WR', team: 'MIA', salary: 5000, gameInfo: 'BUF@MIA 10/11/2026 01:00PM ET', rosterPosition: 'WR/FLEX' },
];
const csv = salaryRowsCsv(players);
assert.deepEqual(parseSalaryCsv(csv), players, 'Structured sync preserves quoting, IDs, salaries, games and eligibility');
const local: SavedSalaries = { version: 1, format: 'classic', season: 2026, filename: 'desktop.csv', importedAt: 'old',
  slateId: 'desktop-forecast', sunday: 'Sunday', csv };
const file = { season: 2026, format: 'classic' as const, filename: 'desktop.csv', importedAt: '2026-10-05T00:00:00Z', players };
assert.equal(sharedSalaryRecord(file, local).slateId, 'desktop-forecast', 'Existing device pairing retained');
assert.equal(sharedSalaryRecord(file).slateId, '', 'Fresh mobile browser must not inherit an inaccessible desktop forecast');
assert.equal(sharedSalaryRecord({ ...file, players: players.map(p => ({ ...p, salary: p.salary + 100 })) }, local).slateId, '', 'Changed contest data invalidates old pairing');
assert.equal(sharedSalaryRecord(file, { ...local, season: 2025 }).slateId, '');
assert.equal(sharedSalaryRecord(file, { ...local, format: 'showdown' }).slateId, '');
assert.equal(sharedSalaryRecord(file, { ...local, csv: 'unreadable' }).slateId, '');
const showdown = players.flatMap((p, i) => [
  { ...p, id: `${i}11`, rosterPosition: 'CPT', salary: p.salary * 1.5 },
  { ...p, id: `${i}12`, rosterPosition: 'FLEX' },
]);
assert.deepEqual(parseSalaryCsv(salaryRowsCsv(showdown), 'showdown'), showdown);
const captain = sharedSalaryRecord({ ...file, format: 'showdown', players: showdown });
assert.equal(captain.gameId, '');
assert.equal(captain.format, 'showdown');
console.log('Cross-device salary conversion: canonical CSV/quoting, exact IDs/roles/prices, independent local pairings and safe changed-file invalidation passed.');
