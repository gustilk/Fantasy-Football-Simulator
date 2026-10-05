import test from 'node:test';
import assert from 'node:assert/strict';
const { selectFeaturedClassic, validateFeaturedCsv, FeaturedClassicUnavailable } = await import('./featured-classic' + '.ts');

const group = { DraftGroupId: 100, Sport: 'NFL', GameTypeId: 1, DraftGroupTag: 'Featured',
  StartDate: '2026-10-11T17:00:00Z', GameCount: 2 };
const now = Date.parse('2026-10-05T12:00:00Z');
const lobby = (...groups: typeof group[]) => ({ SelectedSport: 'NFL', DraftGroups: groups });
const header = 'Position,Name,ID,Salary,Roster Position,Game Info,TeamAbbrev';
const csv = `${header}\r\nQB,Quarterback A,1,6000,QB,CHI@GB 10/11/2026 01:00PM ET,CHI\r\nWR,Receiver B,2,5000,WR/FLEX,NYG@WAS 10/11/2026 01:00PM ET,NYG\r\n`;

test('selects official Featured NFL Classic, not Showdown, Madden or unfeatured Classic', () => {
  assert.equal(selectFeaturedClassic(lobby({ ...group, GameTypeId: 96 },
    { ...group, GameTypeId: 158 }, { ...group, DraftGroupTag: '' }, group), 2026, now).DraftGroupId, 100);
});
test('rejects already-started and wrong-season groups instead of using stale data', () => {
  assert.throws(() => selectFeaturedClassic(lobby(group), 2025, now), FeaturedClassicUnavailable);
  assert.throws(() => selectFeaturedClassic(lobby(group), 2026, Date.parse(group.StartDate)), FeaturedClassicUnavailable);
});
test('selects the nearest upcoming featured slate, independent of lobby ordering', () => {
  assert.equal(selectFeaturedClassic(lobby({ ...group, DraftGroupId: 101, StartDate: '2026-10-18T17:00:00Z' }, group), 2026, now).DraftGroupId, 100);
});
test('January belongs to the preceding football season', () => {
  assert.equal(selectFeaturedClassic(lobby({ ...group, StartDate: '2027-01-10T18:00:00Z' }), 2026, now).DraftGroupId, 100);
});
test('validates Classic CSV, BOM, CRLF and quoted player names', () => {
  assert.doesNotThrow(() => validateFeaturedCsv('\uFEFF' + csv.replace('Quarterback A', '"Quarterback, A"'), group));
});
test('rejects mismatched game dates and game counts', () => {
  assert.throws(() => validateFeaturedCsv(csv.replaceAll('10/11/2026', '10/18/2026'), group));
  assert.throws(() => validateFeaturedCsv(csv, { ...group, GameCount: 3 }));
});
test('rejects Captain rows, duplicate IDs, malformed CSV and HTML', () => {
  assert.throws(() => validateFeaturedCsv(csv.replace('WR/FLEX', 'CPT'), group));
  assert.throws(() => validateFeaturedCsv(csv.replace(',2,5000,', ',1,5000,'), group));
  assert.throws(() => validateFeaturedCsv(csv.replace('Quarterback A', '"Unclosed'), group));
  assert.throws(() => validateFeaturedCsv('<html>Sign in</html>', group));
});
