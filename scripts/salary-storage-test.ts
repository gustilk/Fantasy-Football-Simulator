import assert from 'node:assert/strict';
import { LEGACY_SALARY_KEY, salaryStorageKey, loadSalaryFile, saveSalaryFile, removeSalaryFile, type SavedSalaries } from '../artifacts/gridiron-sim/src/lib/salary-storage';

const data = new Map<string, string>();
const storage = { getItem: (key: string) => data.get(key) ?? null,
  setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
const header = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev\n';
const classic: SavedSalaries = { version: 1, season: 2026, filename: 'classic.csv', importedAt: '2026-10-05',
  slateId: 'classic-slate', sunday: 'Sunday', csv: header + 'QB,Josh Allen,100,QB,10000,BUF@MIA 10/11/2026 01:00PM ET,BUF\n' };
const captain: SavedSalaries = { ...classic, format: 'showdown', filename: 'captain.csv', slateId: 'captain-run', gameId: 'buf-mia',
  csv: header + 'QB,Josh Allen,201,CPT,15000,BUF@MIA 10/11/2026 01:00PM ET,BUF\nQB,Josh Allen,202,FLEX,10000,BUF@MIA 10/11/2026 01:00PM ET,BUF\nWR,Test Receiver,203,CPT,7500,BUF@MIA 10/11/2026 01:00PM ET,MIA\nWR,Test Receiver,204,FLEX,5000,BUF@MIA 10/11/2026 01:00PM ET,MIA\n' };
storage.setItem(LEGACY_SALARY_KEY, JSON.stringify(classic));
assert.deepEqual(loadSalaryFile(storage, 2026, 'classic'), { status: 'ok', record: classic });
assert.deepEqual(loadSalaryFile(storage, 2026, 'showdown'), { status: 'none' });
saveSalaryFile(storage, captain, 'showdown');
const captainRaw = storage.getItem(salaryStorageKey('showdown'));
assert.deepEqual(loadSalaryFile(storage, 2026, 'showdown'), { status: 'ok', record: captain });
assert.equal(storage.getItem(LEGACY_SALARY_KEY), JSON.stringify(classic), 'Captain upload preserves legacy Classic byte-for-byte');
saveSalaryFile(storage, { ...classic, filename: 'classic-replaced.csv' }, 'classic');
assert.equal(storage.getItem(salaryStorageKey('showdown')), captainRaw);
assert.equal(loadSalaryFile(storage, 2025, 'showdown').status, 'other-season');
removeSalaryFile(storage, 'classic');
assert.equal(loadSalaryFile(storage, 2026, 'classic').status, 'none', 'Removed file cannot resurrect from legacy');
assert.equal(storage.getItem(salaryStorageKey('showdown')), captainRaw);
saveSalaryFile(storage, classic, 'classic');
const classicRaw = storage.getItem(salaryStorageKey('classic'));
removeSalaryFile(storage, 'showdown');
assert.equal(loadSalaryFile(storage, 2026, 'showdown').status, 'none');
assert.equal(storage.getItem(salaryStorageKey('classic')), classicRaw);
storage.setItem(LEGACY_SALARY_KEY, JSON.stringify(captain));
assert.deepEqual(loadSalaryFile(storage, 2026, 'showdown'), { status: 'ok', record: captain }, 'Legacy Captain retained in its own builder');
removeSalaryFile(storage, 'classic');
assert.equal(storage.getItem(LEGACY_SALARY_KEY), JSON.stringify(captain));
assert.throws(() => saveSalaryFile(storage, classic, 'showdown'), /format/);
assert.equal(storage.getItem(LEGACY_SALARY_KEY), JSON.stringify(captain));
storage.setItem(salaryStorageKey('classic'), 'invalid json');
assert.equal(loadSalaryFile(storage, 2026, 'classic').status, 'corrupt');
assert.equal(loadSalaryFile(storage, 2026, 'showdown').status, 'ok', 'Corrupt Classic cannot block Captain');
console.log('Separate salary storage: legacy format compatibility, independent uploads/replacements/removals, pairing/reload, seasons, corruption and wrong-format rejection passed.');
