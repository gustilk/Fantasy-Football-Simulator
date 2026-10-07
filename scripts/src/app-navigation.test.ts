import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APP_SECTIONS, initialAppSection, appSectionUrl } from '../../artifacts/gridiron-sim/src/lib/app-navigation';

test('a refresh restores every section from its URL even without browser storage', () => {
  for (const section of APP_SECTIONS) {
    const url = appSectionUrl('https://example.test/?source=home', section);
    assert.equal(initialAppSection(new URL(url, 'https://example.test').search, () => { throw new Error('blocked'); }), section);
  }
});
test('reopening the base address restores the last section; explicit links win', () => {
  assert.equal(initialAppSection('', () => 'manual'), 'manual');
  assert.equal(initialAppSection('?view=library', () => 'manual'), 'library');
  assert.equal(initialAppSection('?view=draftkings', () => 'manual'), 'draftkings');
  assert.equal(initialAppSection('?view=invalid', () => 'manual'), 'draftkings');
});
test('absent, invalid and blocked browser preferences remain safe', () => {
  assert.equal(initialAppSection('', () => null), 'draftkings');
  assert.equal(initialAppSection('', () => 'not-a-section'), 'draftkings');
  assert.equal(initialAppSection('', () => { throw new Error('blocked'); }), 'draftkings');
});
test('switching sections keeps nested preview paths, other query parameters and hashes', () => {
  assert.equal(appSectionUrl('https://example.test/gridiron-sim/?source=phone&view=draftkings#details', 'manual'),
    '/gridiron-sim/?source=phone&view=manual#details');
});
