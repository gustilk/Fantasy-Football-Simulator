import assert from 'node:assert/strict';
import { readSalaryFile } from '../artifacts/gridiron-sim/src/lib/salary-file';

const csv = 'Position,Name,ID,Roster Position,Salary,Game Info,TeamAbbrev\nQB,Test QB,100,QB,5000,BUF@DET 10/04/2035 01:00PM ET,BUF\n';
const imported = await readSalaryFile({ size: csv.length, text: async () => csv });
assert.equal(imported.csv, csv);
assert.equal(imported.players.length, 1);
assert.equal(imported.players[0]!.salary, 5000);
await assert.rejects(readSalaryFile({ size: 2_000_001, text: async () => { throw new Error('Must not read oversized files'); } }), /too large/);
await assert.rejects(readSalaryFile({ size: 0, text: async () => '' }), /Missing DraftKings column/);
await assert.rejects(readSalaryFile({ size: 1, text: async () => { throw new Error('Device read failed'); } }), /Device read failed/);
await assert.rejects(readSalaryFile({ size: 1, text: () => new Promise<string>(() => {}) }, 5), /timed out/);
assert.equal((await readSalaryFile({ size: csv.length, text: async () => csv }, 50)).players.length, 1, 'A failed read must not prevent retries.');
console.log('Salary file reads, CSV validation, size guard, device errors, timeouts and retries passed.');