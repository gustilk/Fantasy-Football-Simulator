import assert from 'node:assert/strict';

const base = `https://${process.env.REPLIT_DEV_DOMAIN}/api/salary-files/2095`;
async function request(format, method = 'GET', body) {
  const response = await fetch(`${base}/${format}`, { method,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  return { status: response.status, data: await response.json() };
}
const players = [
  { id: '99101', name: 'API Test QB', position: 'QB', team: 'BUF', salary: 5000, gameInfo: 'BUF@MIA 10/11/2095 01:00PM ET', rosterPosition: 'QB' },
  { id: '99102', name: 'API Test WR', position: 'WR', team: 'MIA', salary: 4000, gameInfo: 'BUF@MIA 10/11/2095 01:00PM ET', rosterPosition: 'WR/FLEX' },
];
// This script never overwrites existing test or user data.
for (const format of ['classic', 'showdown']) {
  const before = await request(format);
  assert.equal(before.status, 200);
  assert.equal(before.data.revision, 0, 'Reserved API-test season already used; do not overwrite it.');
}
const first = await request('classic', 'PUT', { expectedRevision: 0, filename: 'api-test.csv', players });
assert.equal(first.status, 200);
assert.equal(first.data.revision, 1);
assert.deepEqual(first.data.file.players, players);
assert.ok(Number.isFinite(Date.parse(first.data.file.importedAt)));
assert.equal((await request('classic')).data.file.filename, 'api-test.csv');
assert.equal((await request('showdown')).data.file, null);
const showdown = players.flatMap((p, i) => [
  { ...p, id: `${i}991`, rosterPosition: 'CPT', salary: p.salary * 1.5 },
  { ...p, id: `${i}992`, rosterPosition: 'FLEX' },
]);
assert.equal((await request('showdown', 'PUT', { expectedRevision: 0, filename: 'api-captain.csv', players: showdown })).status, 200);
assert.equal((await request('classic', 'PUT', { expectedRevision: 1, filename: 'wrong.csv', players: showdown })).status, 400);
assert.equal((await request('classic', 'PUT', { expectedRevision: 1, filename: 'duplicate.csv', players: [players[0], players[0]] })).status, 400);
const changes = await Promise.all(['device-a.csv', 'device-b.csv'].map(filename =>
  request('classic', 'PUT', { expectedRevision: 1, filename, players })));
assert.deepEqual(changes.map(r => r.status).sort(), [200, 409], 'Only one concurrent replacement may win');
assert.equal((await request('classic', 'DELETE', { expectedRevision: 1 })).status, 409, 'A stale mobile deletion cannot remove a newer upload');
const removed = await request('classic', 'DELETE', { expectedRevision: 2 });
assert.equal(removed.status, 200);
assert.deepEqual(removed.data, { revision: 3, file: null });
assert.equal((await request('classic', 'PUT', { expectedRevision: 0, filename: 'stale-browser.csv', players })).status, 409, 'Deleted files cannot resurrect through legacy migration');
assert.deepEqual((await request('showdown')).data.file.players, showdown, 'Removing Classic preserves Captain');
assert.equal((await request('showdown', 'DELETE', { expectedRevision: 1 })).status, 200);
assert.equal((await request('bad-format')).status, 400);
console.log('Shared salary API: persisted reload, format isolation, server timestamps, validation, concurrent-write/stale-delete protection and anti-resurrection tombstones passed.');
