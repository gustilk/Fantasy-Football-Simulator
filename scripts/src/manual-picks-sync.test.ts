import assert from 'node:assert/strict';
import { test } from 'node:test';
import { legacyDraft, pickEntries, picksRecord, readRecovery, removeRecovery, samePicks, validateSharedPicks, writeRecovery } from '../../artifacts/gridiron-sim/src/lib/manual-picks-sync';
import { manualContestSignature, MANUAL_PICKS_KEY, saveManualPicks, type ManualPicks } from '../../artifacts/gridiron-sim/src/lib/manual-lineups';
import { contestKey, contestSignature, picksState } from '../../artifacts/api-server/src/lib/manual-picks';
import type { SalaryPlayer } from '../../artifacts/gridiron-sim/src/lib/lineups';

const players: SalaryPlayer[] = [
  { id: '12', name: 'Test QB', position: 'QB', team: 'PHI', salary: 6000, rosterPosition: 'QB', gameInfo: 'PHI@DAL 10/11/2026 01:00PM ET' },
  { id: '10', name: 'Test RB', position: 'RB', team: 'DAL', salary: 5000, rosterPosition: 'RB/FLEX', gameInfo: 'PHI@DAL 10/11/2026 01:00PM ET' },
];
const signature = manualContestSignature(players);
const picks: ManualPicks = { '12': { selected: true, points: '0' }, '10': { selected: false, points: '-2.50' } };
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
}

test('browser and server fingerprint exactly the same contest, regardless of CSV ordering', () => {
  assert.equal(signature, contestSignature([...players].reverse()));
  assert.notEqual(signature, manualContestSignature(players.map(p => ({ ...p, salary: p.salary + 100 }))));
  assert.notEqual(signature, manualContestSignature(players.map(p => ({ ...p, gameInfo: p.gameInfo.replace('10/11', '10/18') }))));
  assert.equal(contestKey(signature).ids.size, 2);
  assert.throws(() => contestKey(JSON.stringify([JSON.parse(signature)[0], JSON.parse(signature)[0]])));
});
test('shared payload keeps zeros, negative strings, unset values, and deselections exactly', () => {
  const withBlank = { ...picks, '10': { selected: false, points: '' } };
  for (const list of [picks, withBlank, {}]) {
    const state = validateSharedPicks({ signature, revision: 1, picks: pickEntries(list) }, signature);
    assert.deepEqual(picksRecord(state), list);
    assert.ok(samePicks(list, picksRecord(state)));
  }
  assert.throws(() => validateSharedPicks({ signature, revision: 1, picks: [{ id: 'unknown', selected: true, points: '4' }] }, signature));
  assert.throws(() => validateSharedPicks({ signature: '[]', revision: 1, picks: [] }, signature));
});
test('failed-save recovery survives reload, season and contest switches without rebasing the revision', () => {
  const local = storage();
  writeRecovery(local, 2026, { signature, expectedRevision: 3, picks });
  const other = manualContestSignature(players.map(p => ({ ...p, salary: p.salary + 100 })));
  writeRecovery(local, 2026, { signature: other, expectedRevision: 0, picks: {} });
  assert.deepEqual(readRecovery(local, 2026, signature), { signature, expectedRevision: 3, picks });
  assert.equal(readRecovery(local, 2027, signature), undefined);
  assert.deepEqual(readRecovery(local, 2026, other)?.picks, {});
  removeRecovery(local, 2026, other);
  assert.deepEqual(readRecovery(local, 2026, signature)?.picks, picks);
});
test('legacy drafts remain byte-for-byte intact on migration and contest mismatch', () => {
  const local = storage();
  saveManualPicks(local, signature, picks);
  const original = local.getItem(MANUAL_PICKS_KEY);
  assert.deepEqual(legacyDraft(local, signature), picks);
  assert.equal(legacyDraft(local, '[]'), undefined);
  writeRecovery(local, 2026, { signature, expectedRevision: 0, picks });
  removeRecovery(local, 2026, signature);
  assert.equal(local.getItem(MANUAL_PICKS_KEY), original);
});
test('malformed browser data is never overwritten or deleted', () => {
  const local = storage();
  local.setItem('gridiron-manual-picks-recovery-v2:2026', '{"version":2,"drafts":"broken"}');
  const original = local.getItem('gridiron-manual-picks-recovery-v2:2026');
  assert.throws(() => writeRecovery(local, 2026, { signature, expectedRevision: 0, picks }));
  assert.throws(() => removeRecovery(local, 2026, signature));
  assert.equal(local.getItem('gridiron-manual-picks-recovery-v2:2026'), original);
  local.setItem(MANUAL_PICKS_KEY, '{"version":1,"signature":"different","picks":{"12":{"selected":true,"points":null}}}');
  assert.throws(() => legacyDraft(local, signature));
  assert.equal(local.getItem('gridiron-manual-picks-recovery-v2:2026'), original);
});
test('server validates persisted picks before a write and retains cleared revision markers', () => {
  assert.deepEqual(picksState(signature), { signature, revision: 0, picks: [] });
  const row = { season: 2026, contestHash: contestKey(signature).contestHash, signature, revision: 3, updatedAt: new Date(), picks: [] };
  assert.equal(picksState(signature, row).revision, 3);
  assert.throws(() => picksState(signature, { ...row, picks: [{ id: '12', points: 0, selected: true }] }));
  assert.throws(() => picksState(signature, { ...row, picks: [{ id: 'invalid', points: '0', selected: true }] }));
  assert.throws(() => picksState(signature, { ...row, signature: '[]' }));
});
